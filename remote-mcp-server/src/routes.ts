import { Hono } from 'hono'
import { getAnthropic, getOpenAI } from './ai.js'
import { CLAUDE_MODEL, EMBED_MODEL } from './config.js'
import { logKnowledge } from './tools/log-knowledge.js'
import { searchKnowledge } from './tools/search-knowledge.js'
import { generateStudyCards } from './tools/generate-cards.js'
import { reviewPr } from './tools/review-pr.js'
import * as db from './db.js'

export const api = new Hono()

api.get('/health', async (c) => {
  const dbOk = await db.healthCheck()
  return c.json({ ok: dbOk, ts: Date.now() })
})

// ── Bootstrap (all startup data in one call) ────────────────────────────────

api.get('/bootstrap', async (c) => {
  const data = await db.getBootstrapData()
  return c.json(data)
})

api.post('/log', async (c) => {
  const { ticket_id, raw_notes, tags, repo } = await c.req.json()
  if (!ticket_id || !raw_notes) return c.json({ error: 'ticket_id and raw_notes required' }, 400)
  const result = await logKnowledge(ticket_id, raw_notes, tags || [], repo || null)
  return c.json({ result })
})

api.post('/search', async (c) => {
  const { query, n } = await c.req.json()
  if (!query) return c.json({ error: 'query required' }, 400)
  const result = await searchKnowledge(query, n || 3)
  return c.json({ result })
})

api.post('/generate-cards', async (c) => {
  const result = await generateStudyCards()
  return c.json({ result })
})

api.post('/review-pr', async (c) => {
  const { pr_number, owner, repo, github_token } = await c.req.json()
  if (!pr_number || !owner || !repo || !github_token) return c.json({ error: 'pr_number, owner, repo, and github_token required' }, 400)
  const result = await reviewPr(pr_number, owner, repo, github_token)
  return c.json({ result })
})

// ── AI proxy endpoints (so the Electron app doesn't need local API keys) ────

api.post('/chat', async (c) => {
  const { model, max_tokens, messages, system } = await c.req.json()
  const ai = getAnthropic()
  const msg = await ai.messages.create({
    model: model || CLAUDE_MODEL,
    max_tokens: max_tokens || 2000,
    messages,
    ...(system ? { system } : {}),
  })
  return c.json(msg)
})

api.post('/embed', async (c) => {
  const { texts } = await c.req.json()
  if (!texts?.length) return c.json({ error: 'texts array required' }, 400)
  const openai = getOpenAI()
  const resp = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts.map((t: string) => t.slice(0, 8000)),
  })
  const embeddings = resp.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
  return c.json({ embeddings })
})

// ── Cards CRUD ──────────────────────────────────────────────────────────────

api.get('/cards', async (c) => {
  const cards = await db.getAllCards()
  return c.json({ cards })
})

api.post('/cards', async (c) => {
  const card = await c.req.json()
  await db.insertCard(
    card.id, card.type || 'qa', card.front, card.back || '',
    card.tags || [], card.when || '', card.how || '', card.example || '',
    card.repo || null,
  )
  return c.json({ ok: true })
})

api.patch('/cards/:id', async (c) => {
  const fields = await c.req.json()
  await db.updateCard(c.req.param('id'), fields)
  return c.json({ ok: true })
})

api.delete('/cards/:id', async (c) => {
  const deleted = await db.deleteCard(c.req.param('id'))
  return c.json({ ok: true, deleted })
})

api.patch('/cards/:id/tags', async (c) => {
  const { tags } = await c.req.json()
  await db.updateCardTags(c.req.param('id'), tags)
  return c.json({ ok: true })
})

// ── Card State ──────────────────────────────────────────────────────────────

api.get('/card-state', async (c) => {
  const state = await db.getAllCardState()
  return c.json({ state })
})

api.put('/card-state/:cardId', async (c) => {
  const state = await c.req.json()
  await db.upsertCardState(c.req.param('cardId'), state)
  return c.json({ ok: true })
})

api.delete('/card-state/:cardId', async (c) => {
  await db.deleteCardState(c.req.param('cardId'))
  return c.json({ ok: true })
})

// ── Sessions & Messages ─────────────────────────────────────────────────────

api.get('/sessions', async (c) => {
  const cardId = c.req.query('cardId')
  if (!cardId) return c.json({ error: 'cardId query param required' }, 400)
  const sessions = await db.getCardSessions(cardId)
  return c.json({ sessions })
})

api.get('/sessions/current', async (c) => {
  const cardId = c.req.query('cardId')
  if (!cardId) return c.json({ error: 'cardId query param required' }, 400)
  const session = await db.getCurrentSession(cardId)
  return c.json({ session })
})

api.post('/sessions', async (c) => {
  const { cardId } = await c.req.json()
  if (!cardId) return c.json({ error: 'cardId required' }, 400)
  const session = await db.createSession(cardId)
  return c.json({ session })
})

api.delete('/sessions', async (c) => {
  const cardId = c.req.query('cardId')
  if (!cardId) return c.json({ error: 'cardId query param required' }, 400)
  await db.deleteCardConversations(cardId)
  return c.json({ ok: true })
})

api.post('/sessions/low-score', async (c) => {
  const { cardIds } = await c.req.json()
  const sessions = await db.getLowScoreSessions(cardIds || [])
  return c.json({ sessions })
})

api.post('/sessions/mark-gap-generated', async (c) => {
  const { sessionIds } = await c.req.json()
  await db.markGapCardGenerated(sessionIds || [])
  return c.json({ ok: true })
})

api.put('/sessions/:id/score', async (c) => {
  const { score } = await c.req.json()
  await db.setSessionScore(c.req.param('id'), score)
  return c.json({ ok: true })
})

api.post('/messages', async (c) => {
  const { sessionId, cardId, role, content, score } = await c.req.json()
  if (!sessionId || !cardId || !role || content === undefined) {
    return c.json({ error: 'sessionId, cardId, role, and content required' }, 400)
  }
  await db.appendMessage(sessionId, cardId, role, content, score ?? null)
  return c.json({ ok: true })
})

// ── Settings ────────────────────────────────────────────────────────────────

api.get('/settings', async (c) => {
  const settings = await db.getSettings()
  return c.json({ settings })
})

api.put('/settings', async (c) => {
  const { settings } = await c.req.json()
  await db.saveAllSettings(settings)
  return c.json({ ok: true })
})

// ── Activity ────────────────────────────────────────────────────────────────

api.post('/activity/track', async (c) => {
  await db.trackActivity()
  return c.json({ ok: true })
})

api.get('/activity', async (c) => {
  const activity = await db.getActivityLog()
  return c.json({ activity })
})

// ── Eval Log ────────────────────────────────────────────────────────────────

api.post('/eval-log', async (c) => {
  const entry = await c.req.json()
  await db.appendEvalEntry(entry)
  return c.json({ ok: true })
})

// ── Embeddings ──────────────────────────────────────────────────────────────

api.get('/card-embeddings', async (c) => {
  const data = await db.getCardEmbeddings()
  return c.json(data)
})

api.put('/card-embeddings', async (c) => {
  const data = await c.req.json()
  await db.saveCardEmbeddings(data)
  return c.json({ ok: true })
})

// ── Problem Logs ────────────────────────────────────────────────────────────

api.get('/problem-logs', async (c) => {
  const logs = await db.getAllProblemLogs()
  return c.json({ logs })
})

api.get('/problem-logs/:filename', async (c) => {
  const content = await db.getProblemLog(c.req.param('filename'))
  return c.json({ content })
})

api.put('/problem-logs', async (c) => {
  const log = await c.req.json()
  await db.upsertProblemLog(log)
  return c.json({ ok: true })
})

api.post('/problem-logs/mark-merged', async (c) => {
  const { filename, mergedIntoId } = await c.req.json()
  await db.markLogMerged(filename, mergedIntoId)
  return c.json({ ok: true })
})

// ── Gap Card Feedback ───────────────────────────────────────────────────────

api.post('/gap-feedback', async (c) => {
  const entry = await c.req.json()
  await db.appendGapFeedback(entry)
  return c.json({ ok: true })
})

api.get('/gap-feedback/recent-denials', async (c) => {
  const limit = parseInt(c.req.query('limit') || '5', 10)
  const denials = await db.getRecentDenials(limit)
  return c.json({ denials })
})

// ── Repos ───────────────────────────────────────────────────────────────────

api.get('/repos', async (c) => {
  const repos = await db.getDistinctRepos()
  return c.json({ repos })
})
