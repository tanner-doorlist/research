const { app, BrowserWindow, Notification, ipcMain, screen, nativeTheme } = require('electron')
const path    = require('path')
const fs      = require('fs')
const os      = require('os')
const Anthropic = require('@anthropic-ai/sdk')

// ── Paths ─────────────────────────────────────────────────────────────────────
const RESEARCH_DIR  = path.join(os.homedir(), 'research')
const CARDS_FILE    = path.join(RESEARCH_DIR, 'study-cards', 'qa_cards.tsv')
const CONCEPT_FILE  = path.join(RESEARCH_DIR, 'study-cards', 'concept_cards.tsv')
const STATE_FILE    = path.join(RESEARCH_DIR, 'study-cards', '.card_state.json')
const SETTINGS_FILE = path.join(RESEARCH_DIR, 'study-cards', '.settings.json')

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = { intervalMinutes: 20, annoyanceLevel: 2, cardsPerSession: 3, launchAtLogin: true }

// ── State ─────────────────────────────────────────────────────────────────────
let win            = null
let cards          = []
let cardState      = {}
let settings       = { ...DEFAULTS }
let currentCard    = null
let notifyTimer    = null
let annoyTimer     = null
let isExpanded     = false
let sessionDone    = 0
let sessionQueue   = []

// The current desired view — renderer pulls this on load
let currentView    = { type: 'hidden' }

const PILL    = { w: 400, h: 84  }
const CARD    = { w: 460, h: 580 }
const CATALOG = { w: 460, h: 660 }
const CHAT    = { w: 460, h: 580 }

function sizeForView(type) {
  return { pill: PILL, card: CARD, catalog: CATALOG, chat: CHAT }[type] || CATALOG
}

// ── Anthropic client ──────────────────────────────────────────────────────────
function getAI() {
  const key = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('No API key — add it in ⚙ settings')
  return new Anthropic({ apiKey: key })
}

// ── File I/O ──────────────────────────────────────────────────────────────────
function loadCards() {
  const all = []

  if (fs.existsSync(CARDS_FILE)) {
    const lines = fs.readFileSync(CARDS_FILE, 'utf8').trim().split('\n').slice(1)
    lines.forEach((line, i) => {
      const [front, back, tags] = line.split('\t')
      if (front?.trim()) all.push({
        id: `qa_${i}`, type: 'qa',
        front: front.trim(), back: (back || '').trim(),
        tags: (tags || '').split(' ').filter(Boolean)
      })
    })
  }

  if (fs.existsSync(CONCEPT_FILE)) {
    const lines = fs.readFileSync(CONCEPT_FILE, 'utf8').trim().split('\n').slice(1)
    lines.forEach((line, i) => {
      const [concept, when, how, example] = line.split('\t')
      if (concept?.trim()) all.push({
        id: `concept_${i}`, type: 'concept',
        front: concept.trim(),
        back: [when && `**When:** ${when}`, how && `**How:** ${how}`, example && `**Example:** ${example}`]
          .filter(Boolean).join('\n\n'),
        tags: ['concept']
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

  const lines  = fs.readFileSync(file, 'utf8').split('\n')
  const rowIdx = parseInt(card.id.split('_')[1]) + 1
  if (rowIdx >= lines.length) return false

  const parts = lines[rowIdx].split('\t')
  parts[0] = newFront
  parts[1] = newBack
  lines[rowIdx] = parts.join('\t')
  fs.writeFileSync(file, lines.join('\n'))

  const c = cards.find(c => c.id === card.id)
  if (c) { c.front = newFront; c.back = newBack }
  return true
}

// ── Card logic ────────────────────────────────────────────────────────────────
function pickCard(exclude = []) {
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

  return pool[Math.floor(Math.random() * pool.length)]
}

function buildSessionQueue() {
  const n = settings.cardsPerSession || 3
  const queue = []
  const seen  = []
  for (let i = 0; i < n; i++) {
    const card = pickCard(seen)
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
    return { id: card.id, type: card.type, front: card.front, got, miss, accuracy, dueLabel, streak: s?.streak || 0 }
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  nativeTheme.themeSource = 'dark'

  const createdWin = win
  win.on('closed', () => {
    if (win === createdWin) win = null
  })

  // When the page is fully loaded and painted, push the view again
  // (the renderer also pulls via getView, so this is belt-and-suspenders)
  win.once('ready-to-show', () => {
    if (!windowAlive()) return
    if (currentView.type !== 'hidden') {
      resizeTo(sizeForView(currentView.type))
      if (currentView.type === 'pill') {
        win.setAlwaysOnTop(true, 'floating')
        win.showInactive()
      } else {
        win.show()
        win.focus()
      }
      app.dock?.show()
    }
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
  cards     = loadCards()
  cardState = loadState()
  if (!cards.length) { scheduleNext(); return }

  sessionQueue = buildSessionQueue()
  sessionDone  = 0
  if (!sessionQueue.length) { scheduleNext(); return }

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
    hideWindow()
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

// ── Edit card with AI ─────────────────────────────────────────────────────────
ipcMain.handle('edit-card', async (_, { card }) => {
  const ai = getAI()
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Improve this flashcard. Make the question more specific and testable, the answer more concise and memorable. Add a short concrete example in the answer if there isn't one. Return ONLY valid JSON, no markdown.

Current card:
Q: ${card.front}
A: ${card.back}

Return: {"front":"...", "back":"..."}`
    }]
  })
  let raw = msg.content[0].text.trim()
  if (raw.startsWith('```')) raw = raw.split('\n').slice(1, -1).join('\n')
  const improved = JSON.parse(raw)
  saveCardEdit(card, improved.front, improved.back)
  return improved
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
  cards     = loadCards()
  cardState = loadState()

  const openedAsLoginItem = app.getLoginItemSettings().wasOpenedAtLogin

  // Pre-set the desired view BEFORE creating the window.
  // createWindow's ready-to-show handler will show it.
  if (!openedAsLoginItem) {
    currentView = { type: 'catalog', catalog: getCatalog(), stats: getStats() }
  }

  createWindow()

  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, openAsHidden: true })
  scheduleNext()

  if (openedAsLoginItem) {
    app.dock?.hide()
  }

  app.on('activate', () => {
    cards     = loadCards()
    cardState = loadState()
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
