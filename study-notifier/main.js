const { app, BrowserWindow, Notification, ipcMain, screen, nativeTheme } = require('electron')
const path    = require('path')
const fs      = require('fs')
const os      = require('os')
const crypto  = require('crypto')
const { spawn } = require('child_process')
const Anthropic = require('@anthropic-ai/sdk')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s.trim())
}
function newId() {
  return crypto.randomUUID()
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const RESEARCH_DIR       = path.join(os.homedir(), 'research')
const CARDS_FILE         = path.join(RESEARCH_DIR, 'study-cards', 'qa_cards.tsv')
const CONCEPT_FILE       = path.join(RESEARCH_DIR, 'study-cards', 'concept_cards.tsv')
const STATE_FILE         = path.join(RESEARCH_DIR, 'study-cards', '.card_state.json')
const SETTINGS_FILE      = path.join(RESEARCH_DIR, 'study-cards', '.settings.json')
const LOGS_DIR               = path.join(RESEARCH_DIR, 'problem-logs')
const KNOWLEDGE_MCP_DIR      = path.join(RESEARCH_DIR, 'knowledge-mcp')
const CARD_EMBEDDINGS_FILE   = path.join(RESEARCH_DIR, 'study-cards', '.card_embeddings.json')
const EVAL_LOG_FILE          = path.join(RESEARCH_DIR, 'study-cards', '.evaluation_log.json')
const ACTIVITY_FILE          = path.join(RESEARCH_DIR, 'study-cards', '.activity_log.json')

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  intervalMinutes: 20,
  annoyanceLevel: 2,
  cardsPerSession: 3,
  launchAtLogin: true,
  categoryClusterK: 8,
}

// ── State ─────────────────────────────────────────────────────────────────────
let win            = null
let cards          = []
let cardState      = {}
let settings       = { ...DEFAULTS }
let currentCard    = null
let notifyTimer    = null
let annoyTimer     = null
let isExpanded     = false
let sessionDone         = 0
let sessionQueue        = []
let chromaProc          = null
let notificationSession = false  // true only when session was fired by the notification timer

// First window from login-at-launch: show catalog in state for the renderer but keep the window hidden until activate
let suppressShowOnFirstReady = false

// The current desired view — renderer pulls this on load
let currentView    = { type: 'hidden' }

const PILL      = { w: 400, h: 84  }
const CARD      = { w: 460, h: 580 }
const CATALOG   = { w: 460, h: 660 }
const CHAT      = { w: 460, h: 580 }
const KNOWLEDGE = { w: 560, h: 700 }
const ANALYTICS = { w: 460, h: 620 }

function sizeForView(type) {
  return { pill: PILL, card: CARD, catalog: CATALOG, chat: CHAT, knowledge: KNOWLEDGE, analytics: ANALYTICS }[type] || CATALOG
}

// ── Anthropic client ──────────────────────────────────────────────────────────
function getAI() {
  const key = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('No API key — add it in ⚙ settings')
  return new Anthropic({ apiKey: key })
}

// ── ChromaDB auto-start ───────────────────────────────────────────────────────
async function isChromaRunning() {
  try {
    const res = await fetch('http://localhost:8000/api/v2/heartbeat', { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function startChroma() {
  const running = await isChromaRunning()
  if (running) return
  const chromaBin = path.join(KNOWLEDGE_MCP_DIR, '.venv', 'bin', 'chroma')
  const dbPath    = path.join(KNOWLEDGE_MCP_DIR, 'chroma_db')
  if (!fs.existsSync(chromaBin)) return
  chromaProc = spawn(chromaBin, ['run', '--path', dbPath], { detached: false, stdio: 'ignore' })
  chromaProc.on('error', () => { chromaProc = null })
  chromaProc.on('exit',  () => { chromaProc = null })
}

// ── File I/O ──────────────────────────────────────────────────────────────────
function migrateCardStateIfNeeded(mapOldToNew) {
  if (!mapOldToNew || !Object.keys(mapOldToNew).length) return
  for (const [oldId, newId] of Object.entries(mapOldToNew)) {
    if (cardState[oldId] !== undefined) {
      cardState[newId] = cardState[oldId]
      delete cardState[oldId]
    }
  }
  saveState()
}

function migrateQaTsv() {
  if (!fs.existsSync(CARDS_FILE)) return
  const lines = fs.readFileSync(CARDS_FILE, 'utf8').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return
  const mapOldToNew = {}
  let start = 0
  const h0 = lines[0].split('\t')[0]
  if (h0.toLowerCase() === 'front' || h0.toLowerCase() === 'id') start = 1
  const out = ['id\tfront\tback\ttags']
  let legacyIdx = 0
  let changed = false
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts.length >= 1 && isUuid(parts[0])) {
      out.push(lines[i])
      continue
    }
    changed = true
    const id = newId()
    mapOldToNew[`qa_${legacyIdx}`] = id
    legacyIdx++
    out.push([id, parts[0] || '', parts[1] || '', (parts[2] || '').trim()].join('\t'))
  }
  if (changed) {
    fs.writeFileSync(CARDS_FILE, out.join('\n') + '\n')
    migrateCardStateIfNeeded(mapOldToNew)
  }
}

function migrateConceptTsv() {
  if (!fs.existsSync(CONCEPT_FILE)) return
  const lines = fs.readFileSync(CONCEPT_FILE, 'utf8').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return
  const mapOldToNew = {}
  let start = 0
  const h0 = lines[0].split('\t')[0]
  if (h0.toLowerCase() === 'concept' || h0.toLowerCase() === 'id') start = 1
  const out = ['id\tconcept\twhen\thow\texample']
  let legacyIdx = 0
  let changed = false
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts.length >= 1 && isUuid(parts[0])) {
      out.push(lines[i])
      continue
    }
    changed = true
    const id = newId()
    mapOldToNew[`concept_${legacyIdx}`] = id
    legacyIdx++
    out.push([id, parts[0] || '', parts[1] || '', parts[2] || '', parts[3] || ''].join('\t'))
  }
  if (changed) {
    fs.writeFileSync(CONCEPT_FILE, out.join('\n') + '\n')
    migrateCardStateIfNeeded(mapOldToNew)
  }
}

function runMigrations() {
  migrateQaTsv()
  migrateConceptTsv()
}

function loadCards() {
  runMigrations()
  const all = []

  if (fs.existsSync(CARDS_FILE)) {
    const lines = fs.readFileSync(CARDS_FILE, 'utf8').trim().split('\n').slice(1)
    lines.forEach((line) => {
      const parts = line.split('\t')
      if (parts.length < 4) return
      const id = parts[0]
      const front = parts[1]
      const back = parts[2]
      const tags = (parts[3] || '').split(' ').filter(Boolean)
      if (!front?.trim() || !isUuid(id)) return
      all.push({
        id, type: 'qa',
        front: front.trim(), back: (back || '').trim(),
        tags,
      })
    })
  }

  if (fs.existsSync(CONCEPT_FILE)) {
    const lines = fs.readFileSync(CONCEPT_FILE, 'utf8').trim().split('\n').slice(1)
    lines.forEach((line) => {
      const parts = line.split('\t')
      if (parts.length < 5) return
      const id = parts[0]
      const concept = parts[1]
      const when = (parts[2] || '').trim()
      const how = (parts[3] || '').trim()
      const example = (parts[4] || '').trim()
      if (!concept?.trim() || !isUuid(id)) return
      const backParts = [
        when && `**When:** ${when}`,
        how && `**How:** ${how}`,
        example && `**Example:** ${example}`,
      ].filter(Boolean)
      const back = backParts.length ? backParts.join('\n\n') : how
      all.push({
        id, type: 'concept',
        front: concept.trim(),
        when, how, example,
        back,
        tags: ['concept'],
      })
    })
  }

  return all
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(cardState, null, 2))
}

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) } }
  catch { return { ...DEFAULTS } }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function saveCardEdit(card, newFront, newBack) {
  const isQA = card.type === 'qa'
  const file  = isQA ? CARDS_FILE : CONCEPT_FILE
  if (!fs.existsSync(file)) return false

  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts[0] !== card.id) continue
    if (isQA) {
      lines[i] = [card.id, newFront, newBack, parts[3] || ''].join('\t')
    } else {
      lines[i] = [card.id, newFront, '', newBack, ''].join('\t')
    }
    fs.writeFileSync(file, lines.join('\n'))
    const c = cards.find(x => x.id === card.id)
    if (c) {
      c.front = newFront
      c.back = newBack
      if (!isQA) { c.when = ''; c.how = newBack; c.example = '' }
    }
    return true
  }
  return false
}

function saveQaTagsForRow(cardId, tagsStr) {
  if (!fs.existsSync(CARDS_FILE)) return false
  const lines = fs.readFileSync(CARDS_FILE, 'utf8').split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts[0] !== cardId) continue
    lines[i] = [parts[0], parts[1], parts[2], tagsStr].join('\t')
    fs.writeFileSync(CARDS_FILE, lines.join('\n'))
    const c = cards.find(x => x.id === cardId)
    if (c && c.type === 'qa') c.tags = tagsStr.split(' ').filter(Boolean)
    return true
  }
  return false
}

function deleteCardById(cardId) {
  const card = cards.find(c => c.id === cardId)
  if (!card) return false
  const file = card.type === 'qa' ? CARDS_FILE : CONCEPT_FILE
  if (!fs.existsSync(file)) return false
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const out = [lines[0]]
  let removed = false
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].split('\t')[0] === cardId) {
      removed = true
      continue
    }
    out.push(lines[i])
  }
  if (!removed) return false
  fs.writeFileSync(file, out.join('\n'))
  delete cardState[cardId]
  saveState()
  cards = loadCards()
  if (currentCard?.id === cardId) currentCard = null
  sessionQueue = sessionQueue.filter(c => c.id !== cardId)
  return true
}

// ── Card logic ────────────────────────────────────────────────────────────────
// dutyOnly=true: returns null if no unseen/due cards (used for building notification sessions)
// dutyOnly=false: falls back to random (used for manual catalog browsing)
function pickCard(exclude = [], dutyOnly = false) {
  if (!cards.length) return null
  const now = Date.now()
  const pool = cards.filter(c => !exclude.includes(c.id))
  if (!pool.length) return null

  const unseen = pool.filter(c => !cardState[c.id])
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)]

  const due = pool.filter(c => (cardState[c.id]?.nextReview ?? 0) <= now)
  if (due.length) {
    due.sort((a, b) => (cardState[a.id]?.nextReview ?? 0) - (cardState[b.id]?.nextReview ?? 0))
    return due[0]
  }

  if (dutyOnly) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

function buildSessionQueue() {
  const n = settings.cardsPerSession || 3
  const queue = []
  const seen  = []
  for (let i = 0; i < n; i++) {
    const card = pickCard(seen, true)  // only unseen/due cards
    if (!card) break
    queue.push(card)
    seen.push(card.id)
  }
  return queue
}

function recordAnswer(cardId, correct) {
  const s = cardState[cardId] || { interval: 1, streak: 0, gotCount: 0, missCount: 0 }
  s.gotCount  = (s.gotCount  || 0) + (correct ? 1 : 0)
  s.missCount = (s.missCount || 0) + (correct ? 0 : 1)
  if (correct) {
    s.streak   = (s.streak || 0) + 1
    s.interval = Math.min(Math.round((s.interval || 1) * 2.5), 180)
    s.nextReview = Date.now() + s.interval * 24 * 60 * 60 * 1000
  } else {
    s.streak   = 0
    s.interval = 1
    s.nextReview = Date.now() + 10 * 60 * 1000
  }
  s.lastSeen = Date.now()
  cardState[cardId] = s
  saveState()
  trackActivity()
}

function getStats() {
  const now   = Date.now()
  const total = cards.length
  const seen  = Object.keys(cardState).length
  const due   = cards.filter(c => !cardState[c.id] || cardState[c.id].nextReview <= now).length
  const streak = Object.values(cardState).reduce((max, s) => Math.max(max, s.streak || 0), 0)
  const totalGot  = Object.values(cardState).reduce((n, s) => n + (s.gotCount  || 0), 0)
  const totalMiss = Object.values(cardState).reduce((n, s) => n + (s.missCount || 0), 0)
  return { total, seen, due, streak, totalGot, totalMiss }
}

// ── Activity tracking ─────────────────────────────────────────────────────────
function trackActivity() {
  const today = new Date().toISOString().slice(0, 10)
  let data = {}
  try { data = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')) } catch {}
  data[today] = (data[today] || 0) + 1
  try {
    fs.mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true })
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data))
  } catch {}
}

// ── Card embeddings ───────────────────────────────────────────────────────────
function loadCardEmbeddings() {
  try { return JSON.parse(fs.readFileSync(CARD_EMBEDDINGS_FILE, 'utf8')) } catch { return { embeddings: {} } }
}

function saveCardEmbeddings(data) {
  fs.mkdirSync(path.dirname(CARD_EMBEDDINGS_FILE), { recursive: true })
  fs.writeFileSync(CARD_EMBEDDINGS_FILE, JSON.stringify(data))
}

function cosineSim(a, b) {
  // assumes pre-normalized unit vectors
  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return dot
}

// ── Eval log ──────────────────────────────────────────────────────────────────
function loadEvalLog() {
  try { return JSON.parse(fs.readFileSync(EVAL_LOG_FILE, 'utf8')) } catch { return [] }
}

function appendEvalLog(entry) {
  const log = loadEvalLog()
  log.push(entry)
  try {
    fs.mkdirSync(path.dirname(EVAL_LOG_FILE), { recursive: true })
    fs.writeFileSync(EVAL_LOG_FILE, JSON.stringify(log, null, 2))
  } catch {}
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function getAnalytics() {
  const now = Date.now()
  const allStates = Object.entries(cardState)
  const totalReviews = allStates.reduce((n, [, s]) => n + (s.gotCount || 0) + (s.missCount || 0), 0)
  const totalGot    = allStates.reduce((n, [, s]) => n + (s.gotCount  || 0), 0)
  const overallAccuracy = totalReviews > 0 ? Math.round((totalGot / totalReviews) * 100) : 0
  const streak = allStates.reduce((max, [, s]) => Math.max(max, s.streak || 0), 0)

  const tagMap = {}
  for (const card of cards) {
    const s = cardState[card.id]
    if (!s) continue
    const got  = s.gotCount  || 0
    const miss = s.missCount || 0
    if (got + miss === 0) continue
    const tags = (card.tags || []).filter(t => t && t !== 'concept')
    const effectiveTags = tags.length ? tags : ['uncategorized']
    for (const tag of effectiveTags) {
      if (!tagMap[tag]) tagMap[tag] = { got: 0, miss: 0 }
      tagMap[tag].got  += got
      tagMap[tag].miss += miss
    }
  }
  const categoryStats = Object.entries(tagMap).map(([tag, d]) => ({
    tag, got: d.got, miss: d.miss, total: d.got + d.miss,
    accuracy: Math.round((d.got / (d.got + d.miss)) * 100),
  })).sort((a, b) => b.total - a.total)

  let activityData = {}
  try { activityData = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')) } catch {}
  const activityByDay = []
  for (let i = 29; i >= 0; i--) {
    const d   = new Date(now - i * 86400000)
    const key = d.toISOString().slice(0, 10)
    activityByDay.push({ date: key, count: activityData[key] || 0 })
  }
  const daysActive = Object.values(activityData).filter(v => v > 0).length

  return { totalReviews, overallAccuracy, streak, daysActive, categoryStats, activityByDay }
}

function getCatalog() {
  const now = Date.now()
  return cards.map(card => {
    const s = cardState[card.id]
    const got  = s?.gotCount  || 0
    const miss = s?.missCount || 0
    const accuracy = (got + miss) > 0 ? Math.round((got / (got + miss)) * 100) : null
    const nextReview = s?.nextReview
    let dueLabel = 'New'
    if (nextReview) {
      const diff = nextReview - now
      if (diff <= 0) dueLabel = 'Due now'
      else {
        const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
        dueLabel = days === 1 ? 'Tomorrow' : `${days}d`
      }
    }
    return {
      id: card.id, type: card.type, front: card.front, got, miss, accuracy, dueLabel, streak: s?.streak || 0,
      tags: card.tags || [],
    }
  })
}

// ── View state — set by main, pulled by renderer ─────────────────────────────
// Every show* function sets currentView AND tries an IPC push.
// The renderer also pulls currentView on load via invoke('get-view').
// This means it works regardless of timing.

function setView(type, data) {
  currentView = { type, ...data }
  try {
    if (windowAlive() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('view', currentView)
    }
  } catch (_) { /* renderer not ready yet — it will pull via get-view */ }
}

// ── Window management ─────────────────────────────────────────────────────────
function getAnchor(w, h) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { x: width - w - 20, y: height - h - 20 }
}

function windowAlive() {
  return win != null && !win.isDestroyed()
}

/** Recreate the BrowserWindow when it was closed or destroyed (e.g. dock click after close). */
function ensureWindow() {
  if (windowAlive()) return
  if (sessionQueue.length === 0) {
    currentView = { type: 'catalog', catalog: getCatalog(), stats: getStats() }
  }
  createWindow()
}

function resizeTo(dim) {
  if (!windowAlive()) return
  const { x, y } = getAnchor(dim.w, dim.h)
  win.setSize(dim.w, dim.h, true)
  win.setPosition(x, y, true)
}

function createWindow() {
  const { x, y } = getAnchor(CATALOG.w, CATALOG.h)
  const preloadPath = path.resolve(__dirname, 'preload.js')
  if (!fs.existsSync(preloadPath)) {
    console.error('Study Notifier: preload.js missing at', preloadPath)
  }
  win = new BrowserWindow({
    width: CATALOG.w, height: CATALOG.h, x, y,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'customButtonsOnHover',
    trafficLightPosition: { x: 12, y: 12 },
    frame: false,
    alwaysOnTop: false,
    resizable: true,
    hasShadow: true,
    show: false,       // don't show until ready-to-show
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })
  win.webContents.on('preload-error', (event, p, err) => {
    console.error('Study Notifier preload-error', p, err)
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'))
  nativeTheme.themeSource = 'dark'

  const createdWin = win
  win.on('closed', () => {
    if (win === createdWin) win = null
  })

  // When the page is fully loaded and painted, push the view again
  // (the renderer also pulls via getView, so this is belt-and-suspenders)
  win.once('ready-to-show', () => {
    if (!windowAlive()) return
    if (currentView.type === 'hidden') return
    resizeTo(sizeForView(currentView.type))
    if (suppressShowOnFirstReady) {
      suppressShowOnFirstReady = false
      app.dock?.hide()
      return
    }
    if (currentView.type === 'pill') {
      win.setAlwaysOnTop(true, 'floating')
      win.showInactive()
    } else {
      win.show()
      win.focus()
    }
    app.dock?.show()
  })
}

function showPill(card) {
  if (!card) return
  if (!windowAlive()) {
    currentCard = card
    isExpanded = false
    clearAnnoyTimer()
    setView('pill', { card, stats: getStats(), sessionDone, sessionTotal: sessionQueue.length })
    createWindow()
    scheduleAnnoyance()
    return
  }
  currentCard = card
  isExpanded  = false
  clearAnnoyTimer()
  resizeTo(PILL)
  win.setAlwaysOnTop(true, 'floating')
  win.showInactive()
  setView('pill', { card, stats: getStats(), sessionDone, sessionTotal: sessionQueue.length })
  scheduleAnnoyance()
}

function expandCard(card) {
  const c = card || currentCard
  if (!c) return
  if (!windowAlive()) {
    currentCard = c
    isExpanded = true
    clearAnnoyTimer()
    setView('card', { card: c, stats: getStats(), sessionDone, sessionTotal: sessionQueue.length })
    createWindow()
    return
  }
  isExpanded = true
  clearAnnoyTimer()
  resizeTo(CARD)
  app.dock?.show()
  win.show()
  win.focus()
  setView('card', { card: c, stats: getStats(), sessionDone, sessionTotal: sessionQueue.length })
}

function showCatalog() {
  if (!windowAlive()) {
    ensureWindow()
    return
  }
  win.setAlwaysOnTop(false)
  resizeTo(CATALOG)
  app.dock?.show()
  win.show()
  win.focus()
  setView('catalog', { catalog: getCatalog(), stats: getStats() })
}

function showKnowledge() {
  if (!windowAlive()) { ensureWindow() }
  win.setAlwaysOnTop(false)
  resizeTo(KNOWLEDGE)
  app.dock?.show()
  win.show()
  win.focus()
  setView('knowledge', {})
}

function showAnalytics() {
  if (!windowAlive()) { ensureWindow() }
  win.setAlwaysOnTop(false)
  resizeTo(ANALYTICS)
  app.dock?.show()
  win.show()
  win.focus()
  setView('analytics', { analytics: getAnalytics() })
}

function showChat(card) {
  if (!windowAlive()) return
  resizeTo(CHAT)
  app.dock?.show()
  win.show()
  win.focus()
  setView('chat', { card: card || currentCard })
}

function hideWindow() {
  clearAnnoyTimer()
  sessionDone  = 0
  sessionQueue = []
  currentView  = { type: 'hidden' }
  app.dock?.hide()
  if (windowAlive()) win.hide()
}

// ── Annoyance ─────────────────────────────────────────────────────────────────
function scheduleAnnoyance() {
  clearAnnoyTimer()
  if (settings.annoyanceLevel < 1) return
  const delays = [null, [5*60e3], [2*60e3, 60e3], [60e3, 30e3, 10e3]]
  const sequence = delays[Math.min(settings.annoyanceLevel, 3)] || []
  let i = 0
  const step = () => {
    if (i >= sequence.length || !win?.isVisible()) return
    annoyTimer = setTimeout(() => {
      win?.webContents.send('annoy')
      if (Notification.isSupported())
        new Notification({ title: '🧠 Still waiting…', body: currentCard?.front?.substring(0, 80) || '' }).show()
      i++; step()
    }, sequence[i])
  }
  step()
}

function clearAnnoyTimer() {
  if (annoyTimer) { clearTimeout(annoyTimer); annoyTimer = null }
}

// ── Notification scheduler ────────────────────────────────────────────────────
function scheduleNext(overrideMinutes) {
  if (notifyTimer) clearTimeout(notifyTimer)
  const ms = (overrideMinutes ?? settings.intervalMinutes) * 60 * 1000
  notifyTimer = setTimeout(fireNotification, ms)
}

function fireNotification() {
  cardState = loadState()
  cards     = loadCards()
  if (!cards.length) { scheduleNext(); return }

  sessionQueue = buildSessionQueue()
  sessionDone  = 0
  if (!sessionQueue.length) { scheduleNext(); return }

  notificationSession = true
  currentCard = sessionQueue[0]
  showPill(currentCard)

  if (Notification.isSupported()) {
    const n = new Notification({ title: `🧠 Study time (${sessionQueue.length} cards)`, body: currentCard.front.substring(0, 100) })
    n.on('click', () => expandCard(currentCard))
    n.show()
  }

  scheduleNext()
}

// ── IPC ───────────────────────────────────────────────────────────────────────
// Renderer pulls current view on load — this is the critical path
ipcMain.handle('get-view', () => currentView)

ipcMain.on('expand',  ()           => expandCard(currentCard))
ipcMain.on('dismiss', ()           => hideWindow())
ipcMain.on('catalog', ()           => showCatalog())
ipcMain.on('open-card-from-catalog', (_, cardId) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return
  currentCard = card
  const idx = sessionQueue.findIndex(c => c.id === cardId)
  if (sessionQueue.length > 0 && idx >= 0) {
    sessionDone = idx
    expandCard(card)
  } else {
    notificationSession = false
    sessionQueue = [card]
    sessionDone = 0
    expandCard(card)
  }
})
ipcMain.on('chat',    (_, card)    => showChat(card || currentCard))
ipcMain.on('back-to-card', ()      => expandCard(currentCard))

ipcMain.on('snooze', (_, minutes) => {
  hideWindow()
  setTimeout(() => { if (currentCard) showPill(currentCard) }, (minutes || 5) * 60 * 1000)
})

ipcMain.on('answer', (_, { cardId, correct }) => {
  recordAnswer(cardId, correct)
  cardState = loadState()
  sessionDone++

  const nextIdx = sessionQueue.findIndex(c => c.id === cardId) + 1
  if (nextIdx < sessionQueue.length) {
    currentCard = sessionQueue[nextIdx]
    if (isExpanded) expandCard(currentCard)
    else showPill(currentCard)
  } else {
    if (notificationSession) {
      hideWindow()
    } else {
      notificationSession = false
      showCatalog()
    }
  }
})

ipcMain.on('settings:save', (_, s) => {
  settings = { ...settings, ...s }
  saveSettings()
  scheduleNext()
  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true })
})

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('stats:get',    () => getStats())
ipcMain.handle('catalog:get',  () => getCatalog())

// ── Knowledge IPC ─────────────────────────────────────────────────────────────
ipcMain.on('knowledge', () => showKnowledge())

ipcMain.handle('knowledge:get-logs', () => {
  if (!fs.existsSync(LOGS_DIR)) return []
  return fs.readdirSync(LOGS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .sort((a, b) => b.localeCompare(a))
    .map(filename => {
      const content = fs.readFileSync(path.join(LOGS_DIR, filename), 'utf8')
      const fm = {}
      const m = content.match(/^---\n([\s\S]*?)\n---/)
      if (m) {
        for (const line of m[1].split('\n')) {
          const i = line.indexOf(': ')
          if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 2).trim()
        }
      }
      return { filename, date: fm.date || '', problem: fm.problem || filename, tags: fm.tags || '' }
    })
})

ipcMain.handle('knowledge:get-log', (_, { filename }) => {
  const full = path.join(LOGS_DIR, path.basename(filename))
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
})

ipcMain.handle('knowledge:search', (_, { query }) => {
  return new Promise(resolve => {
    const cliPath = path.join(KNOWLEDGE_MCP_DIR, 'cli.py')
    const env = {
      ...process.env,
      OPENAI_API_KEY: settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
      ANTHROPIC_API_KEY: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    }
    const proc = spawn('python3', [cliPath, 'search', '--query', query, '--n', '5'], { env })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { out += d })
    proc.on('close', () => resolve(out.trim() || 'No results found.'))
    proc.on('error', e => resolve(`Error: ${e.message}`))
  })
})

ipcMain.handle('knowledge:chroma-status', () => isChromaRunning())

// ── Analytics IPC ─────────────────────────────────────────────────────────────
ipcMain.on('analytics', () => showAnalytics())
ipcMain.handle('analytics:get', () => getAnalytics())

// ── Card embeddings IPC ───────────────────────────────────────────────────────
ipcMain.handle('cards:index-embeddings', async () => {
  try {
    const key = getOpenAIKey()
    const texts = cards.map(c => `${c.front}\n${c.back}`.slice(0, 8000))
    const vecs = await openaiEmbeddings(texts, key)
    const data = { model: 'text-embedding-3-small', indexed_at: Date.now(), embeddings: {} }
    for (let i = 0; i < cards.length; i++) {
      data.embeddings[cards[i].id] = Array.from(vecs[i])
    }
    saveCardEmbeddings(data)
    return { ok: true, count: cards.length }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('cards:semantic-search', async (_, { query }) => {
  try {
    const key = getOpenAIKey()
    const embData = loadCardEmbeddings()
    if (!Object.keys(embData.embeddings || {}).length) {
      return { ok: false, error: 'No embeddings — run Index Cards first' }
    }
    const vecs = await openaiEmbeddings([query], key)
    const qv = vecs[0]
    const scores = []
    for (const [cardId, emb] of Object.entries(embData.embeddings)) {
      const v = new Float32Array(emb)
      let norm = 0
      for (let d = 0; d < v.length; d++) norm += v[d] * v[d]
      norm = Math.sqrt(norm)
      if (norm > 0) for (let d = 0; d < v.length; d++) v[d] /= norm
      scores.push({ cardId, score: cosineSim(qv, v) })
    }
    scores.sort((a, b) => b.score - a.score)
    return { ok: true, orderedIds: scores.map(s => s.cardId) }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('cards:set-tags', (_, { cardId, tags }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card || card.type !== 'qa') return { ok: false }
  const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags)
  const ok = saveQaTagsForRow(cardId, tagsStr)
  return { ok: !!ok }
})

ipcMain.handle('answer:evaluate', async (_, { cardId, answer }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false, error: 'Card not found' }
  try {
    const ai = getAI()
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are evaluating a flashcard answer. Score it and give brief one-sentence feedback.

Card question: ${card.front}

Correct answer: ${card.back}

Student's answer: ${answer}

Score: 2 = fully correct, 1 = partially correct (key insight present but incomplete), 0 = incorrect.

Return ONLY valid JSON: {"score":0|1|2,"feedback":"one sentence feedback"}`,
      }],
    })
    let raw = msg.content[0].text.trim()
    if (raw.startsWith('```')) raw = raw.split('\n').slice(1, -1).join('\n')
    const parsed = JSON.parse(raw)
    appendEvalLog({ cardId, front: card.front, answer, score: parsed.score, feedback: parsed.feedback, ts: Date.now() })
    return { ok: true, score: parsed.score, feedback: parsed.feedback }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

// ── OpenAI embeddings + auto-tag ──────────────────────────────────────────────
function getOpenAIKey() {
  const key = settings.openaiApiKey || process.env.OPENAI_API_KEY
  if (!key) throw new Error('No OpenAI API key — add it in settings or OPENAI_API_KEY')
  return key
}

async function openaiEmbeddings(texts, key) {
  const out = []
  for (let i = 0; i < texts.length; i += 64) {
    const chunk = texts.slice(i, i + 64)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: chunk }),
    })
    if (!res.ok) throw new Error(`OpenAI embeddings: ${await res.text()}`)
    const j = await res.json()
    const sorted = j.data.slice().sort((a, b) => a.index - b.index)
    for (const row of sorted) {
      const e = row.embedding
      const v = new Float32Array(e.length)
      let s = 0
      for (let d = 0; d < e.length; d++) {
        v[d] = e[d]
        s += e[d] * e[d]
      }
      s = Math.sqrt(s)
      if (s > 0) for (let d = 0; d < e.length; d++) v[d] /= s
      out.push(v)
    }
  }
  return out
}

function kmeansCosine(points, k, maxIter = 40) {
  const n = points.length
  const dim = points[0].length
  if (n === 0) return []
  if (k <= 1 || n <= k) return new Array(n).fill(0)

  const centroids = []
  const picked = new Set()
  while (centroids.length < k && picked.size < n) {
    const j = Math.floor(Math.random() * n)
    if (picked.has(j)) continue
    picked.add(j)
    centroids.push(Float32Array.from(points[j]))
  }
  const assignments = new Array(n).fill(0)

  function assignStep() {
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestDot = -Infinity
      for (let c = 0; c < k; c++) {
        let dot = 0
        for (let d = 0; d < dim; d++) dot += points[i][d] * centroids[c][d]
        if (dot > bestDot) {
          bestDot = dot
          best = c
        }
      }
      assignments[i] = best
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    assignStep()
    const counts = new Array(k).fill(0)
    const sums = centroids.map(() => new Float32Array(dim))
    for (let i = 0; i < n; i++) {
      const c = assignments[i]
      counts[c]++
      for (let d = 0; d < dim; d++) sums[c][d] += points[i][d]
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue
      for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c]
      let norm = 0
      for (let d = 0; d < dim; d++) norm += centroids[c][d] * centroids[c][d]
      norm = Math.sqrt(norm)
      if (norm > 0) for (let d = 0; d < dim; d++) centroids[c][d] /= norm
    }
  }
  return assignments
}

async function labelClustersWithClaude(k, samples) {
  const ai = getAI()
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `Each cluster has sample flashcard fronts. Assign ONE short category tag per cluster: lowercase, a-z 0-9 hyphen only, max 24 characters, no spaces.

${JSON.stringify(samples, null, 2)}

Return ONLY valid JSON: {"tags":["tag0","tag1",...]} with exactly ${k} strings in cluster order 0..${k - 1}.`,
    }],
  })
  let raw = msg.content[0].text.trim()
  if (raw.startsWith('```')) raw = raw.split('\n').slice(1, -1).join('\n')
  const parsed = JSON.parse(raw)
  if (!parsed.tags || parsed.tags.length !== k) throw new Error('Unexpected tags from model')
  return parsed.tags
}

async function runAutoTagAll() {
  const key = getOpenAIKey()
  const qa = cards.filter(c => c.type === 'qa')
  if (qa.length === 0) throw new Error('No Q&A cards to tag')
  let k = Math.min(settings.categoryClusterK || 8, qa.length)
  k = Math.max(2, k)
  const texts = qa.map(c => `${c.front}\n${c.back}`.slice(0, 12000))
  const vectors = await openaiEmbeddings(texts, key)
  const assignments = kmeansCosine(vectors, k)
  const perCluster = Array.from({ length: k }, () => [])
  for (let i = 0; i < qa.length; i++) {
    perCluster[assignments[i]].push(qa[i].front.slice(0, 200))
  }
  const samples = perCluster.map((fronts, i) => {
    const uniq = [...new Set(fronts)].slice(0, 6)
    return { cluster: i, samples: uniq.length ? uniq : [`(empty-cluster-${i})`] }
  })
  const tags = await labelClustersWithClaude(k, samples)
  for (let i = 0; i < qa.length; i++) {
    const tag = tags[assignments[i]] || 'misc'
    saveQaTagsForRow(qa[i].id, tag)
  }
}

ipcMain.handle('auto-tag-cards', async () => {
  try {
    await runAutoTagAll()
    cards = loadCards()
    if (currentView.type === 'catalog') {
      setView('catalog', { catalog: getCatalog(), stats: getStats() })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('delete-card', (_, { cardId }) => {
  if (!deleteCardById(cardId)) return { ok: false }
  if (currentView.type === 'catalog') {
    setView('catalog', { catalog: getCatalog(), stats: getStats() })
  } else if (currentView.type === 'card' && currentCard?.id === cardId) {
    hideWindow()
  }
  return { ok: true }
})

ipcMain.handle('apply-card-edit', (_, { cardId, front, back }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false }
  if (!saveCardEdit(card, front, back)) return { ok: false }
  cards = loadCards()
  const c = cards.find(x => x.id === cardId)
  if (c && currentView.type === 'card') {
    currentCard = c
    setView('card', { card: c, stats: getStats(), sessionDone, sessionTotal: sessionQueue.length })
  }
  return { ok: true }
})

// ── Edit card with AI (chat) ──────────────────────────────────────────────────
ipcMain.handle('edit-card-chat', async (_, { card, messages }) => {
  const ai = getAI()
  const deck = cards.filter(c => c.id !== card.id).slice(0, 50)
  const ctx = deck.map(c => `- (${c.type}) ${String(c.front).slice(0, 140)}`).join('\n')
  const system = `You are a collaborative flashcard editor. Help the user improve this card: specific, testable questions; concise, memorable answers; optional short example in the answer when helpful.

When you propose final Q/A, include a JSON code block: \`\`\`json\n{"front":"...","back":"..."}\n\`\`\`

Other cards in the library (truncated):
${ctx || '(none)'}

Current card:
Q: ${card.front}
A: ${card.back}`
  const resp = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system,
    messages,
  })
  return resp.content[0].text
})

// ── Chat with AI about a card ─────────────────────────────────────────────────
ipcMain.handle('chat-send', async (_, { messages, card }) => {
  const ai = getAI()
  const resp = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `You are a Socratic tutor. The user is studying this flashcard:

Q: ${card.front}
A: ${card.back}

Help them build deep understanding of the underlying concept. Be conversational, concrete, and brief. Pose follow-up questions to check understanding. Never just re-read the card back to them.`,
    messages
  })
  return resp.content[0].text
})

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  settings  = loadSettings()
  cardState = loadState()
  cards     = loadCards()

  const openedAsLoginItem = app.getLoginItemSettings().wasOpenedAtLogin

  // Always set a real view before createWindow so ipc get-view never returns 'hidden' on first paint
  // (renderer defaults to pill + "Loading…" until handleView runs).
  suppressShowOnFirstReady = openedAsLoginItem
  currentView = { type: 'catalog', catalog: getCatalog(), stats: getStats() }

  createWindow()

  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true })
  scheduleNext()
  startChroma()

  app.on('activate', () => {
    cardState = loadState()
    cards     = loadCards()
    if (!windowAlive()) {
      ensureWindow()
      return
    }
    if (sessionQueue.length === 0) {
      showCatalog()
      return
    }
    const t = currentView?.type
    if (t === 'pill' && currentCard) showPill(currentCard)
    else if (t === 'card' && currentCard) expandCard(currentCard)
    else if (t === 'catalog') showCatalog()
    else if (t === 'chat' && currentCard) showChat(currentCard)
    else if (currentCard) showPill(currentCard)
    else showCatalog()
  })
})

app.on('window-all-closed', e => e.preventDefault())

app.on('before-quit', () => {
  if (chromaProc) { chromaProc.kill(); chromaProc = null }
})
