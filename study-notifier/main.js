const { app, BrowserWindow, Notification, ipcMain, screen, nativeTheme } = require('electron')
const path    = require('path')
const fs      = require('fs')
const os      = require('os')
const crypto  = require('crypto')
const { spawn } = require('child_process')
const Anthropic = require('@anthropic-ai/sdk')
const db      = require('./db')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s.trim())
}
function newId() {
  return crypto.randomUUID()
}

// ── Utilities ────────────────────────────────────────────────────────────────
function normalizeVector(v) {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const RESEARCH_DIR       = process.env.RESEARCH_DIR || path.join(os.homedir(), 'research')
const KNOWLEDGE_MCP_DIR  = path.join(RESEARCH_DIR, 'knowledge-mcp')
// Legacy file paths — used only for one-time migration to Postgres
const CARDS_FILE         = path.join(RESEARCH_DIR, 'study-cards', 'qa_cards.tsv')
const CONCEPT_FILE       = path.join(RESEARCH_DIR, 'study-cards', 'concept_cards.tsv')
const STATE_FILE         = path.join(RESEARCH_DIR, 'study-cards', '.card_state.json')
const SETTINGS_FILE      = path.join(RESEARCH_DIR, 'study-cards', '.settings.json')
const LOGS_DIR           = path.join(RESEARCH_DIR, 'problem-logs')
const CARD_EMBEDDINGS_FILE = path.join(RESEARCH_DIR, 'study-cards', '.card_embeddings.json')
const EVAL_LOG_FILE      = path.join(RESEARCH_DIR, 'study-cards', '.evaluation_log.json')
const ACTIVITY_FILE      = path.join(RESEARCH_DIR, 'study-cards', '.activity_log.json')
const CONVERSATIONS_FILE = path.join(RESEARCH_DIR, 'study-cards', '.card_conversations.json')

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  intervalMinutes: 20,
  annoyanceLevel: 2,
  cardsPerSession: 3,
  launchAtLogin: true,
  retireThreshold: 5,
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
// Docker manages Postgres (see docker-compose.yml)
let notificationSession = false  // true only when session was fired by the notification timer

// First window from login-at-launch: show catalog in state for the renderer but keep the window hidden until activate
let suppressShowOnFirstReady = false

// The current desired view — renderer pulls this on load
let currentView    = { type: 'hidden' }

// ── Caching ──────────────────────────────────────────────────────────────────
let catalogCache = null
let catalogDirty = true
let statsCache = null
let statsDirty = true

function invalidateCaches() {
  catalogDirty = true
  statsDirty = true
}

// ── Session advancement helper ───────────────────────────────────────────────
// Shared by delete-card and flag-card: advance to next card in session or show catalog/hide
function advanceSessionOrEnd() {
  if (currentView.type === 'card') {
    const nextIdx = sessionQueue.findIndex((c, i) => i >= sessionDone)
    if (nextIdx >= 0) {
      currentCard = sessionQueue[nextIdx]
      expandCard(currentCard)
    } else if (notificationSession) {
      hideWindow()
    } else {
      showCatalog()
    }
  }
}

// ── Catalog view refresh helper ──────────────────────────────────────────────
function refreshCatalogView() {
  invalidateCaches()
  if (currentView.type === 'catalog') {
    setView('catalog', { catalog: getCatalog(), stats: getStats() })
  }
}

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

// ── DB health check ──────────────────────────────────────────────────────────
async function isDbReady() {
  try {
    await db.pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

// ── Card loading (from Postgres) ─────────────────────────────────────────────
async function loadCards() {
  return db.getAllCards()
}

// ── DB-backed state (in-memory cache, persisted to Postgres) ─────────────────

// Sync wrappers that persist to db in background (fire-and-forget)
function persistCardState(cardId) {
  invalidateCaches()
  db.upsertCardState(cardId, cardState[cardId]).catch(e => console.error('[db] persist card state failed:', e))
}

function persistSettings() {
  db.saveAllSettings(settings).catch(e => console.error('[db] persist settings failed:', e))
}

// Session state: always go through db (async)
// No in-memory cache needed — sessions are loaded per-card on demand

async function saveCardEdit(card, newFront, newBack) {
  const isQA = card.type === 'qa'
  const fields = { front: newFront, back: newBack }
  if (!isQA) { fields.when = ''; fields.how = newBack; fields.example = '' }
  await db.updateCard(card.id, fields)
  const c = cards.find(x => x.id === card.id)
  if (c) {
    c.front = newFront
    c.back = newBack
    if (!isQA) { c.when = ''; c.how = newBack; c.example = '' }
  }
  invalidateCaches()
  return true
}

async function saveQaTagsForRow(cardId, tagsStr) {
  const tags = tagsStr.split(' ').filter(Boolean)
  await db.updateCardTags(cardId, tags)
  const c = cards.find(x => x.id === cardId)
  if (c) c.tags = tags
  invalidateCaches()
  return true
}

async function deleteCardById(cardId) {
  const card = cards.find(c => c.id === cardId)
  if (!card) return false
  await db.deleteCard(cardId)
  delete cardState[cardId]
  db.deleteCardState(cardId).catch(err => console.error('[db] delete card state failed:', err))
  cards = cards.filter(c => c.id !== cardId)
  if (currentCard?.id === cardId) currentCard = null
  sessionQueue = sessionQueue.filter(c => c.id !== cardId)
  invalidateCaches()
  return true
}

// ── Card logic ────────────────────────────────────────────────────────────────
// dutyOnly=true: returns null if no unseen/due cards (used for building notification sessions)
// dutyOnly=false: falls back to random (used for manual catalog browsing)
function pickCard(exclude = [], dutyOnly = false) {
  if (!cards.length) return null
  const now = Date.now()
  const pool = cards.filter(c => !exclude.includes(c.id) && !cardState[c.id]?.retired && !cardState[c.id]?.flagged)
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
  // Auto-retire cards that have been mastered
  const threshold = settings.retireThreshold || 5
  if (correct && s.streak >= threshold && s.interval >= 180) {
    s.retired = true
  }
  persistCardState(cardId)
  trackActivity()
}

function getStats() {
  if (!statsDirty && statsCache) return statsCache
  const now   = Date.now()
  const total = cards.length
  const seen  = Object.keys(cardState).length
  const active = cards.filter(c => !cardState[c.id]?.retired && !cardState[c.id]?.flagged)
  const due   = active.filter(c => !cardState[c.id] || cardState[c.id].nextReview <= now).length
  const streak = Object.values(cardState).reduce((max, s) => Math.max(max, s.streak || 0), 0)
  const totalGot  = Object.values(cardState).reduce((n, s) => n + (s.gotCount  || 0), 0)
  const totalMiss = Object.values(cardState).reduce((n, s) => n + (s.missCount || 0), 0)
  statsCache = { total, seen, due, streak, totalGot, totalMiss }
  statsDirty = false
  return statsCache
}

// ── Activity tracking ─────────────────────────────────────────────────────────
function trackActivity() {
  db.trackActivity().catch(e => console.error('[db] track activity failed:', e))
}

// ── Gap card generation ──────────────────────────────────────────────────────
let pendingGapCards = [] // queue of { id, front, back, tags, sourceCardFront, sessionId }
const MAX_PENDING_GAP_CARDS = 5

async function generateGapCards(cardIds) {
  try {
    if (pendingGapCards.length >= MAX_PENDING_GAP_CARDS) return

    const lowSessions = await db.getLowScoreSessions(cardIds)
    if (!lowSessions.length) return

    const ai = getAI()

    // Load recent denials to improve generation
    const denials = await db.getRecentDenials(5)
    let denialContext = ''
    if (denials.length) {
      denialContext = '\n\nThe user has previously rejected these suggested gap cards — learn from their feedback:\n' +
        denials.map(d => `- Rejected: "${d.card_front}" (for card: "${d.source_card_front}") — Reason: ${d.reason}`).join('\n') +
        '\n\nAvoid generating cards that would be rejected for similar reasons.\n'
    }

    for (const session of lowSessions) {
      if (pendingGapCards.length >= MAX_PENDING_GAP_CARDS) break
      const convo = session.messages.map(m => `${m.role}: ${m.content}`).join('\n')
      const prompt = `A student was quizzed on a flashcard and scored ${session.score}/2 (${session.score === 0 ? 'incorrect' : 'partial'}).

Card question: ${session.cardFront}
Correct answer: ${session.cardBack}

Conversation:
${convo}
${denialContext}
Based on this conversation, identify the specific knowledge gap — what did the student misunderstand, miss, or confuse?

If there is a clear, targetable gap, generate ONE flashcard that would help fill it. The card should test the specific misunderstanding, NOT just repeat the original question. It might test a prerequisite concept, a distinction the student conflated, or a detail they overlooked.

If there's not enough signal to generate a useful card (e.g. the student just didn't attempt an answer, or the gap is too vague), return {"skip": true}.

Return ONLY valid JSON:
{"skip": false, "front": "question targeting the gap", "back": "concise answer", "tags": ["gap-fill"]}`

      try {
        const msg = await ai.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }],
        })
        let raw = msg.content[0].text.trim()
        if (raw.startsWith('```')) raw = raw.split('\n').slice(1, -1).join('\n')
        const parsed = JSON.parse(raw)

        if (!parsed.skip && parsed.front) {
          const suggestion = {
            id: newId(),
            front: parsed.front,
            back: parsed.back || '',
            tags: [...(parsed.tags || []), 'gap-fill'],
            sourceCardFront: session.cardFront,
            sessionId: session.id,
          }
          pendingGapCards.push(suggestion)
          // Send to renderer
          if (win) win.webContents.send('gap-card-suggestion', suggestion)
          console.log(`[gap-cards] Suggested: ${parsed.front.slice(0, 60)}...`)
        } else {
          // No card generated — mark session as processed
          await db.markGapCardGenerated([session.id])
        }
      } catch (e) {
        console.error(`[gap-cards] Failed for session ${session.id}:`, e.message)
        await db.markGapCardGenerated([session.id])
      }
    }
  } catch (e) {
    console.error('[gap-cards] Error:', e.message)
  }
}

// Approve a suggested gap card
ipcMain.handle('gap-card:approve', async (_, { id }) => {
  const idx = pendingGapCards.findIndex(c => c.id === id)
  if (idx === -1) return { ok: false }
  const suggestion = pendingGapCards.splice(idx, 1)[0]

  await db.insertCard({ id: suggestion.id, type: 'qa', front: suggestion.front, back: suggestion.back, tags: suggestion.tags })
  cardState[suggestion.id] = { interval: 1, streak: 0, gotCount: 0, missCount: 0, nextReview: Date.now() }
  cards.push({ id: suggestion.id, type: 'qa', front: suggestion.front, back: suggestion.back, tags: suggestion.tags })
  invalidateCaches()
  persistCardState(suggestion.id)
  await db.markGapCardGenerated([suggestion.sessionId])
  await db.appendGapFeedback({
    cardFront: suggestion.front, cardBack: suggestion.back,
    sourceCardFront: suggestion.sourceCardFront, approved: true, ts: Date.now(),
  })

  // Send next suggestion if queued
  if (pendingGapCards.length && win) {
    win.webContents.send('gap-card-suggestion', pendingGapCards[0])
  }

  return { ok: true }
})

// Deny a suggested gap card
ipcMain.handle('gap-card:deny', async (_, { id, reason }) => {
  const idx = pendingGapCards.findIndex(c => c.id === id)
  if (idx === -1) return { ok: false }
  const suggestion = pendingGapCards.splice(idx, 1)[0]

  await db.markGapCardGenerated([suggestion.sessionId])
  await db.appendGapFeedback({
    cardFront: suggestion.front, cardBack: suggestion.back,
    sourceCardFront: suggestion.sourceCardFront, approved: false, reason: reason || null, ts: Date.now(),
  })

  // Send next suggestion if queued
  if (pendingGapCards.length && win) {
    win.webContents.send('gap-card-suggestion', pendingGapCards[0])
  }

  return { ok: true }
})

// ── Card embeddings ───────────────────────────────────────────────────────────
async function loadCardEmbeddings() {
  return db.getCardEmbeddings()
}

async function saveCardEmbeddings(data) {
  await db.saveCardEmbeddings(data)
}

function cosineSim(a, b) {
  // assumes pre-normalized unit vectors
  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return dot
}

// ── Eval log ──────────────────────────────────────────────────────────────────
function appendEvalLog(entry) {
  db.appendEvalEntry(entry).catch(e => console.error('[db] eval log failed:', e))
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function getAnalytics() {
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
  try { activityData = await db.getActivityLog() } catch {}
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
  if (!catalogDirty && catalogCache) return catalogCache
  const now = Date.now()
  catalogCache = cards.map(card => {
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
      retired: !!s?.retired,
      flagged: !!s?.flagged,
    }
  })
  catalogDirty = false
  return catalogCache
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

async function showAnalytics() {
  if (!windowAlive()) { ensureWindow() }
  win.setAlwaysOnTop(false)
  resizeTo(ANALYTICS)
  app.dock?.show()
  win.show()
  win.focus()
  setView('analytics', { analytics: await getAnalytics() })
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

async function fireNotification() {
  // cardState is in-memory — no reload needed (db is write-through)
  cards     = await loadCards()
  invalidateCaches()
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
  // cardState is in-memory — no reload needed (db is write-through)
  sessionDone++

  const nextIdx = sessionQueue.findIndex(c => c.id === cardId) + 1
  if (nextIdx < sessionQueue.length) {
    currentCard = sessionQueue[nextIdx]
    if (isExpanded) expandCard(currentCard)
    else showPill(currentCard)
  } else {
    // Session ended — generate gap cards in background (fire-and-forget)
    const finishedCardIds = sessionQueue.map(c => c.id)
    generateGapCards(finishedCardIds)

    if (notificationSession) {
      hideWindow()
    } else {
      notificationSession = false
      showCatalog()
    }
  }
})

// Record AI score without advancing to next card
ipcMain.handle('answer:record', (_, { cardId, correct }) => {
  recordAnswer(cardId, correct)
  // cardState is in-memory — no reload needed (db is write-through)
  return { ok: true }
})

// Override a previous score: undo the last record, then re-record with new score
ipcMain.handle('answer:override', (_, { cardId, wasCorrect, nowCorrect }) => {
  // Reverse the previous recording
  const s = cardState[cardId]
  if (s) {
    if (wasCorrect) {
      s.gotCount = Math.max(0, (s.gotCount || 0) - 1)
    } else {
      s.missCount = Math.max(0, (s.missCount || 0) - 1)
    }
    cardState[cardId] = s
    persistCardState(cardId)
  }
  // Re-record with corrected score
  recordAnswer(cardId, nowCorrect)
  // cardState is in-memory — no reload needed (db is write-through)
  return { ok: true }
})

ipcMain.on('settings:save', (_, s) => {
  settings = { ...settings, ...s }
  persistSettings()
  scheduleNext()
  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true })
})

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('stats:get',    () => getStats())
ipcMain.handle('catalog:get',  () => getCatalog())

// ── Knowledge IPC ─────────────────────────────────────────────────────────────
ipcMain.on('knowledge', () => showKnowledge())

ipcMain.handle('knowledge:get-logs', () => db.getAllProblemLogs())

ipcMain.handle('knowledge:get-log', (_, { filename }) => db.getProblemLog(filename))

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

ipcMain.handle('knowledge:chroma-status', () => isDbReady())

ipcMain.handle('knowledge:related', async (_, { filename }) => {
  const content = await db.getProblemLog(filename)
  if (!content) return { ok: false, error: 'Log not found' }
  const fm = {}
  const m = content.match(/^---\n([\s\S]*?)\n---/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(': ')
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 2).trim()
    }
  }
  const query = fm.problem || content.slice(0, 500)

  return new Promise(resolve => {
    const cliPath = path.join(KNOWLEDGE_MCP_DIR, 'cli.py')
    const env = {
      ...process.env,
      RESEARCH_DIR: RESEARCH_DIR,
      OPENAI_API_KEY: settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
      ANTHROPIC_API_KEY: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    }
    const proc = spawn('python3', [cliPath, 'search', '--query', query, '--n', '6'], { env })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { out += d })
    proc.on('close', () => {
      // Parse results into structured data — each result starts with "### filename"
      const related = []
      const blocks = out.split(/^### /m).filter(Boolean)
      for (const block of blocks) {
        const lines = block.split('\n')
        const header = lines[0] || ''
        const fnameMatch = header.match(/^(\S+\.md)\s+\(similarity\s+(\d+)%\)/)
        if (!fnameMatch) continue
        const fn = fnameMatch[1]
        if (fn === filename) continue // skip self
        const sim = parseInt(fnameMatch[2], 10)
        // Extract problem from the log list we already have
        related.push({ filename: fn, similarity: sim })
      }
      resolve({ ok: true, related: related.slice(0, 5) })
    })
    proc.on('error', () => resolve({ ok: false, error: 'Search failed' }))
  })
})

ipcMain.handle('knowledge:combine', async (_, { filename1, filename2 }) => {
  const content1 = await db.getProblemLog(filename1)
  const content2 = await db.getProblemLog(filename2)
  if (!content1 || !content2) return { ok: false, error: 'Log not found' }

  try {
    const ai = getAI()
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Two knowledge logs cover overlapping material. Merge them into one comprehensive log that:
- Deduplicates repeated information (keep the clearest version)
- Preserves unique insights from both
- Maintains the same markdown template structure (frontmatter with date/type/problem/tags, then sections: Problem, Initial Observations, Approach, Key Insights, Solution, Pitfalls, Study Prompts)
- Use the earlier date in the frontmatter
- Combine tags from both

FIRST LOG:
${content1}

SECOND LOG:
${content2}

Output ONLY the merged markdown — no preamble, no explanation.`,
      }],
    })

    const merged = msg.content[0].text.trim()

    // Parse frontmatter from merged content
    const fm = {}
    const m = merged.match(/^---\n([\s\S]*?)\n---/)
    if (m) {
      for (const line of m[1].split('\n')) {
        const i = line.indexOf(': ')
        if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 2).trim()
      }
    }
    let tags = []
    try { tags = JSON.parse(fm.tags || '[]') } catch {}

    // Update first log with merged content
    await db.upsertProblemLog({
      filename: filename1, date: fm.date || null, type: fm.type || 'coding',
      problem: fm.problem || filename1, tags, content: merged,
    })

    // Mark second log as merged
    await db.markLogMerged(filename2, filename1)

    return { ok: true, resultFilename: filename1 }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

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
    await saveCardEmbeddings(data)
    return { ok: true, count: cards.length }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('cards:semantic-search', async (_, { query }) => {
  try {
    const key = getOpenAIKey()
    const embData = await loadCardEmbeddings()
    if (!Object.keys(embData.embeddings || {}).length) {
      return { ok: false, error: 'No embeddings — run Index Cards first' }
    }
    const vecs = await openaiEmbeddings([query], key)
    const qv = vecs[0]
    const scores = []
    for (const [cardId, emb] of Object.entries(embData.embeddings)) {
      const v = new Float32Array(emb)
      normalizeVector(v)
      scores.push({ cardId, score: cosineSim(qv, v) })
    }
    scores.sort((a, b) => b.score - a.score)
    return { ok: true, orderedIds: scores.map(s => s.cardId) }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('cards:set-tags', async (_, { cardId, tags }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card || card.type !== 'qa') return { ok: false }
  const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags)
  await saveQaTagsForRow(cardId, tagsStr)
  return { ok: true }
})

// ── Conversation IPC ──────────────────────────────────────────────────────────
ipcMain.handle('conversation:get-sessions', async (_, { cardId }) => {
  return db.getCardSessions(cardId)
})

ipcMain.handle('conversation:get-current', async (_, { cardId }) => {
  return db.getCurrentSession(cardId)
})

ipcMain.handle('conversation:start', async (_, { cardId }) => {
  return db.createSession(cardId)
})

ipcMain.handle('conversation:clear', async (_, { cardId }) => {
  await db.deleteCardConversations(cardId)
  return { ok: true }
})

ipcMain.handle('answer:evaluate', async (_, { cardId, answer, refCardIds, isFollowUp }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false, error: 'Card not found' }

  // Build context from referenced cards
  let refContext = ''
  if (refCardIds?.length) {
    const refs = refCardIds.map(id => cards.find(c => c.id === id)).filter(Boolean)
    if (refs.length) {
      refContext = '\n\nReferenced cards (student mentioned these for context):\n' +
        refs.map(c => `- Q: ${c.front}\n  A: ${c.back}`).join('\n')
    }
  }

  // Ensure a session exists, start one if not
  let session = await db.getCurrentSession(cardId)
  if (!session) session = await db.createSession(cardId)

  // Save user message to current session
  await db.appendMessage(session.id, cardId, 'user', answer)

  const cardContext = `Card question: ${card.front}\n\nCorrect answer: ${card.back}${refContext}`

  // Reload session messages for AI context
  session = await db.getCurrentSession(cardId)
  const history = session ? session.messages : []
  const aiMessages = []

  if (isFollowUp) {
    aiMessages.push({
      role: 'user',
      content: `You are a study assistant helping a student review a flashcard. Be concise (1-3 sentences).\n\n${cardContext}\n\nHere is the conversation so far. Continue naturally.`
    })
    aiMessages.push({ role: 'assistant', content: 'Understood. I have the card context.' })
    for (const m of history) {
      aiMessages.push({ role: m.role, content: m.content })
    }
  } else {
    aiMessages.push({
      role: 'user',
      content: `You are evaluating a flashcard answer. Score it and give brief one-sentence feedback. The student may reference other cards to show connections — reward this if the connections are meaningful.\n\n${cardContext}\n\nStudent's answer: ${answer}\n\nScore: 2 = fully correct, 1 = partially correct (key insight present but incomplete), 0 = incorrect.\n\nReturn ONLY valid JSON: {"score":0|1|2,"feedback":"one sentence feedback"}`
    })
  }

  try {
    const ai = getAI()
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: aiMessages,
    })
    const raw = msg.content[0].text.trim()

    if (!isFollowUp) {
      let cleaned = raw
      if (cleaned.startsWith('```')) cleaned = cleaned.split('\n').slice(1, -1).join('\n')
      try {
        const parsed = JSON.parse(cleaned)
        const aiContent = `**${['Incorrect', 'Partial', 'Correct'][parsed.score]}** — ${parsed.feedback}`
        await db.appendMessage(session.id, cardId, 'assistant', aiContent, { score: parsed.score })
        await db.setSessionScore(session.id, parsed.score)
        appendEvalLog({ cardId, front: card.front, answer, score: parsed.score, feedback: parsed.feedback, ts: Date.now() })
        return { ok: true, score: parsed.score, feedback: parsed.feedback }
      } catch {
        await db.appendMessage(session.id, cardId, 'assistant', raw)
        return { ok: true, score: -1, feedback: raw }
      }
    } else {
      await db.appendMessage(session.id, cardId, 'assistant', raw)
      return { ok: true, score: -1, feedback: raw }
    }
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
      for (let d = 0; d < e.length; d++) v[d] = e[d]
      normalizeVector(v)
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
      normalizeVector(centroids[c])
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
  const MAX_CLUSTERS = 7
  const MISC_THRESHOLD = 0.25  // cosine similarity below this = poor fit → misc

  const key = getOpenAIKey()
  const qa = cards.filter(c => c.type === 'qa')
  if (qa.length === 0) throw new Error('No Q&A cards to tag')
  let k = Math.min(MAX_CLUSTERS, qa.length)
  k = Math.max(2, k)
  const texts = qa.map(c => `${c.front}\n${c.back}`.slice(0, 12000))
  const vectors = await openaiEmbeddings(texts, key)
  const assignments = kmeansCosine(vectors, k)

  // Compute centroids to measure fit quality
  const dim = vectors[0].length
  const centroids = Array.from({ length: k }, () => new Float32Array(dim))
  const counts = new Array(k).fill(0)
  for (let i = 0; i < qa.length; i++) {
    const c = assignments[i]
    counts[c]++
    for (let d = 0; d < dim; d++) centroids[c][d] += vectors[i][d]
  }
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) continue
    for (let d = 0; d < dim; d++) centroids[c][d] /= counts[c]
    normalizeVector(centroids[c])
  }

  // Check each card's fit to its cluster — weak fits go to misc
  const isMisc = new Array(qa.length).fill(false)
  for (let i = 0; i < qa.length; i++) {
    const sim = cosineSim(vectors[i], centroids[assignments[i]])
    if (sim < MISC_THRESHOLD) isMisc[i] = true
  }

  // Only label non-empty clusters that have well-fitting cards
  const perCluster = Array.from({ length: k }, () => [])
  for (let i = 0; i < qa.length; i++) {
    if (!isMisc[i]) perCluster[assignments[i]].push(qa[i].front.slice(0, 200))
  }
  const samples = perCluster.map((fronts, i) => {
    const uniq = [...new Set(fronts)].slice(0, 6)
    return { cluster: i, samples: uniq.length ? uniq : [`(empty-cluster-${i})`] }
  })
  const tags = await labelClustersWithClaude(k, samples)

  for (let i = 0; i < qa.length; i++) {
    const tag = isMisc[i] ? 'misc' : (tags[assignments[i]] || 'misc')
    await saveQaTagsForRow(qa[i].id, tag)
  }
}

ipcMain.handle('auto-tag-cards', async () => {
  try {
    await runAutoTagAll()
    cards = await loadCards()
    refreshCatalogView()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

// ── Undo registry for delete ───────────────────────────────────────────────
const undoRegistry = {}

ipcMain.handle('delete-card', async (_, { cardId }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false }

  // Stash card data for undo before deleting
  const stashedState = cardState[cardId] ? { ...cardState[cardId] } : null

  if (!(await deleteCardById(cardId))) return { ok: false }

  // Create undo token
  const undoToken = newId()
  undoRegistry[undoToken] = { card: { ...card }, cardState: stashedState }
  setTimeout(() => { delete undoRegistry[undoToken] }, 10000)

  // Advance session instead of hiding
  sessionQueue = sessionQueue.filter(c => c.id !== cardId)
  refreshCatalogView()
  advanceSessionOrEnd()
  return { ok: true, undoToken }
})

ipcMain.handle('undo-delete', async (_, { token }) => {
  const stash = undoRegistry[token]
  if (!stash) return { ok: false }
  delete undoRegistry[token]

  // Re-insert card into Postgres
  await db.insertCard(stash.card)
  // Restore card state
  if (stash.cardState) {
    cardState[stash.card.id] = stash.cardState
    persistCardState(stash.card.id)
  }
  cards = await loadCards()
  refreshCatalogView()
  return { ok: true }
})

ipcMain.handle('flag-card', (_, { cardId }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false }
  const s = cardState[cardId] || { interval: 1, streak: 0, gotCount: 0, missCount: 0 }
  s.flagged = true
  cardState[cardId] = s
  persistCardState(cardId)

  // Advance session
  sessionQueue = sessionQueue.filter(c => c.id !== cardId)
  refreshCatalogView()
  advanceSessionOrEnd()
  return { ok: true }
})

ipcMain.handle('unflag-card', (_, { cardId }) => {
  if (!cardState[cardId]) return { ok: false }
  delete cardState[cardId].flagged
  cardState[cardId].streak = 0
  persistCardState(cardId)
  refreshCatalogView()
  return { ok: true }
})

ipcMain.handle('unretire-card', (_, { cardId }) => {
  if (!cardState[cardId]) return { ok: false }
  delete cardState[cardId].retired
  cardState[cardId].streak = 0
  persistCardState(cardId)
  refreshCatalogView()
  return { ok: true }
})

// ── Bulk operations ──────────────────────────────────────────────────────────
ipcMain.handle('bulk-delete', async (_, { cardIds }) => {
  let deleted = 0
  for (const id of cardIds) {
    if (await deleteCardById(id)) deleted++
  }
  cards = await loadCards()
  refreshCatalogView()
  return { ok: true, deleted }
})

ipcMain.handle('bulk-set-tags', async (_, { cardIds, tags }) => {
  const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags)
  let updated = 0
  for (const id of cardIds) {
    if (await saveQaTagsForRow(id, tagsStr)) updated++
  }
  cards = await loadCards()
  refreshCatalogView()
  return { ok: true, updated }
})

ipcMain.handle('bulk-flag', (_, { cardIds }) => {
  for (const id of cardIds) {
    const s = cardState[id] || { interval: 1, streak: 0, gotCount: 0, missCount: 0 }
    s.flagged = true
    cardState[id] = s
    persistCardState(id)
  }
  refreshCatalogView()
  return { ok: true }
})

ipcMain.handle('bulk-merge', async (_, { cardIds }) => {
  const toMerge = cardIds.map(id => cards.find(c => c.id === id)).filter(Boolean)
  if (toMerge.length < 2) return { ok: false, error: 'Need at least 2 cards' }

  // Delete originals first (before inserting new card)
  for (const c of toMerge) await deleteCardById(c.id)

  const ai = getAI()
  const cardsText = toMerge.map((c, i) =>
    `Card ${i + 1} (${c.type}):\nQ: ${c.front}\nA: ${c.back}${c.tags?.length ? `\nTags: ${c.tags.join(', ')}` : ''}`
  ).join('\n\n')

  const resp = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: `You are a flashcard editor. Merge these flashcards into ONE clear Q&A card.

Rules:
- "front" = a single concise question (one sentence, no tables, no bullet lists)
- "back" = a concise answer (plain text, use bullet points with dashes if listing items, NO markdown tables, NO pipe characters)
- Combine key concepts, remove redundancy
- Keep it memorizable — short and direct

Output ONLY a JSON code block:
\`\`\`json
{"front":"...","back":"...","tags":"space separated tags"}
\`\`\``,
    messages: [{ role: 'user', content: `Merge these cards into one:\n\n${cardsText}` }],
  })
  const text = resp.content[0].text
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (!m) return { ok: false, error: 'AI did not return valid JSON' }

  let parsed
  try { parsed = JSON.parse(m[1].trim()) } catch { return { ok: false, error: 'Invalid JSON from AI' } }
  if (!parsed.front || !parsed.back) return { ok: false, error: 'Missing front or back' }

  // Insert new merged card into Postgres
  const mergedId = newId()
  const tagsArr = (parsed.tags || toMerge[0].tags?.join(' ') || '').split(' ').filter(Boolean)
  await db.insertCard({ id: mergedId, type: 'qa', front: parsed.front.trim(), back: parsed.back.trim(), tags: tagsArr })

  cards = await loadCards()
  refreshCatalogView()
  return { ok: true, newCardId: mergedId }
})

ipcMain.handle('apply-card-edit', async (_, { cardId, front, back }) => {
  const card = cards.find(c => c.id === cardId)
  if (!card) return { ok: false }
  await saveCardEdit(card, front, back)
  cards = await loadCards()
  invalidateCaches()
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
app.whenReady().then(async () => {
  // Initialize database
  await db.initSchema()
  await db.migrateFromFiles({
    stateFile: STATE_FILE,
    settingsFile: SETTINGS_FILE,
    activityFile: ACTIVITY_FILE,
    evalLogFile: EVAL_LOG_FILE,
    conversationsFile: CONVERSATIONS_FILE,
    embeddingsFile: CARD_EMBEDDINGS_FILE,
    cardsFile: CARDS_FILE,
    conceptFile: CONCEPT_FILE,
    logsDir: LOGS_DIR,
  })

  settings  = await db.getSettings(DEFAULTS)
  cardState = await db.getAllCardState()
  cards     = await loadCards()

  const openedAsLoginItem = app.getLoginItemSettings().wasOpenedAtLogin

  // Always set a real view before createWindow so ipc get-view never returns 'hidden' on first paint
  // (renderer defaults to pill + "Loading…" until handleView runs).
  suppressShowOnFirstReady = openedAsLoginItem
  currentView = { type: 'catalog', catalog: getCatalog(), stats: getStats() }

  createWindow()

  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true })
  scheduleNext()
  // ChromaDB + Postgres managed by docker-compose (scripts/dev)

  app.on('activate', async () => {
    // In-memory state is authoritative (write-through) — skip DB reload if cards are already loaded
    if (!cards.length) {
      cards = await loadCards()
    }
    invalidateCaches()
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
  // Docker services cleaned up by scripts/dev trap
  db.close().catch(err => console.error('[db] close failed:', err))
})
