import pg from 'pg'
import { DATABASE_URL } from './config.js'

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 })

export async function initSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL DEFAULT 'qa',
      front        TEXT NOT NULL,
      back         TEXT NOT NULL DEFAULT '',
      tags         TEXT[] NOT NULL DEFAULT '{}',
      when_to_use  TEXT NOT NULL DEFAULT '',
      how_it_works TEXT NOT NULL DEFAULT '',
      example      TEXT NOT NULL DEFAULT '',
      repo         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS card_state (
      card_id       TEXT PRIMARY KEY,
      interval_days INTEGER NOT NULL DEFAULT 1,
      streak        INTEGER NOT NULL DEFAULT 0,
      got_count     INTEGER NOT NULL DEFAULT 0,
      miss_count    INTEGER NOT NULL DEFAULT 0,
      next_review   BIGINT,
      last_seen     BIGINT,
      retired       BOOLEAN NOT NULL DEFAULT false,
      flagged       BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS card_embeddings (
      card_id    TEXT PRIMARY KEY,
      model      TEXT NOT NULL DEFAULT 'text-embedding-3-small',
      embedding  REAL[] NOT NULL,
      indexed_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS problem_logs (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      filename        TEXT UNIQUE NOT NULL,
      date            DATE,
      type            TEXT NOT NULL DEFAULT 'coding',
      problem         TEXT NOT NULL DEFAULT '',
      tags            TEXT[] NOT NULL DEFAULT '{}',
      content         TEXT NOT NULL,
      merged_into     TEXT REFERENCES problem_logs(id),
      cards_generated BOOLEAN NOT NULL DEFAULT false,
      embedding       vector(1536),
      repo            TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      card_id    TEXT NOT NULL,
      started_at BIGINT NOT NULL,
      score      INTEGER,
      gap_card_generated BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      card_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      ts         BIGINT NOT NULL,
      score      INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      date  DATE PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS evaluation_log (
      id       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      card_id  TEXT NOT NULL,
      front    TEXT NOT NULL,
      answer   TEXT NOT NULL,
      score    INTEGER NOT NULL,
      feedback TEXT,
      ts       BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gap_card_feedback (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      card_front TEXT NOT NULL,
      card_back  TEXT NOT NULL,
      source_card_front TEXT NOT NULL,
      approved   BOOLEAN NOT NULL,
      reason     TEXT,
      ts         BIGINT NOT NULL
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_card_state_next_review ON card_state(next_review);
    CREATE INDEX IF NOT EXISTS idx_sessions_card_id ON sessions(card_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_card_id ON messages(card_id);
    CREATE INDEX IF NOT EXISTS idx_eval_log_card_id ON evaluation_log(card_id);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_cards_repo ON cards(repo);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_date ON problem_logs(date);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_merged ON problem_logs(merged_into);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_repo ON problem_logs(repo);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_embedding ON problem_logs
      USING hnsw (embedding vector_cosine_ops);
  `)
  console.log('[db] schema initialized')
}

function vecToStr(embedding: number[]): string {
  return '[' + embedding.join(',') + ']'
}

export function parseFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {}
  const m = content.match(/^---\n([\s\S]*?)\n---/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(': ')
      if (idx > 0) {
        fm[line.slice(0, idx).trim()] = line.slice(idx + 2).trim()
      }
    }
  }
  return fm
}

export async function nearestLogs(embedding: number[], n = 1) {
  const vec = vecToStr(embedding)
  const { rows } = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM problem_logs
     WHERE embedding IS NOT NULL AND merged_into IS NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vec, n],
  )
  return rows.map(r => ({
    ...r,
    similarity: parseFloat(r.similarity),
  }))
}

export async function upsertLog(
  filename: string, date: string | null, logType: string,
  problem: string, tags: string[], content: string,
  embedding: number[] | null, repo: string | null,
) {
  if (embedding) {
    const vec = vecToStr(embedding)
    await pool.query(
      `INSERT INTO problem_logs (filename, date, type, problem, tags, content, embedding, repo)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)
       ON CONFLICT (filename) DO UPDATE SET
         date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
         tags = EXCLUDED.tags, content = EXCLUDED.content, embedding = EXCLUDED.embedding,
         repo = COALESCE(EXCLUDED.repo, problem_logs.repo)`,
      [filename, date, logType, problem, tags, content, vec, repo],
    )
  } else {
    await pool.query(
      `INSERT INTO problem_logs (filename, date, type, problem, tags, content, repo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (filename) DO UPDATE SET
         date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
         tags = EXCLUDED.tags, content = EXCLUDED.content,
         repo = COALESCE(EXCLUDED.repo, problem_logs.repo)`,
      [filename, date, logType, problem, tags, content, repo],
    )
  }
}

export async function getUnprocessedLogs() {
  const { rows } = await pool.query(
    `SELECT id, filename, content, repo FROM problem_logs
     WHERE merged_into IS NULL AND cards_generated = false
     ORDER BY date ASC`,
  )
  return rows
}

export async function markCardsGenerated(filename: string) {
  await pool.query(
    'UPDATE problem_logs SET cards_generated = true WHERE filename = $1',
    [filename],
  )
}

export async function insertCard(
  cardId: string, cardType: string, front: string, back: string,
  tags: string[], whenToUse = '', howItWorks = '', example = '',
  repo: string | null = null,
) {
  await pool.query(
    `INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example, repo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [cardId, cardType, front, back, tags, whenToUse, howItWorks, example, repo],
  )
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

// ── Cards CRUD ──────────────────────────────────────────────────────────────

export async function getAllCards() {
  const { rows } = await pool.query('SELECT * FROM cards ORDER BY created_at ASC')
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    front: r.front,
    back: r.back,
    tags: r.tags || [],
    repo: r.repo || null,
    ...(r.type === 'concept' ? {
      when: r.when_to_use,
      how: r.how_it_works,
      example: r.example,
    } : {}),
  }))
}

export async function updateCard(cardId: string, fields: Record<string, unknown>) {
  const sets: string[] = []
  const vals: unknown[] = [cardId]
  let i = 2
  if (fields.front !== undefined) { sets.push(`front = $${i++}`); vals.push(fields.front) }
  if (fields.back !== undefined) { sets.push(`back = $${i++}`); vals.push(fields.back) }
  if (fields.tags !== undefined) { sets.push(`tags = $${i++}`); vals.push(fields.tags) }
  if (fields.when !== undefined) { sets.push(`when_to_use = $${i++}`); vals.push(fields.when) }
  if (fields.how !== undefined) { sets.push(`how_it_works = $${i++}`); vals.push(fields.how) }
  if (fields.example !== undefined) { sets.push(`example = $${i++}`); vals.push(fields.example) }
  if (fields.repo !== undefined) { sets.push(`repo = $${i++}`); vals.push(fields.repo) }
  if (!sets.length) return
  await pool.query(`UPDATE cards SET ${sets.join(', ')} WHERE id = $1`, vals)
}

export async function deleteCard(cardId: string) {
  const { rowCount } = await pool.query('DELETE FROM cards WHERE id = $1', [cardId])
  return (rowCount ?? 0) > 0
}

export async function updateCardTags(cardId: string, tags: string[]) {
  await pool.query('UPDATE cards SET tags = $1 WHERE id = $2', [tags, cardId])
}

// ── Card State ──────────────────────────────────────────────────────────────

export async function getAllCardState() {
  const { rows } = await pool.query('SELECT * FROM card_state')
  const state: Record<string, unknown> = {}
  for (const r of rows) {
    state[r.card_id] = {
      interval: r.interval_days,
      streak: r.streak,
      gotCount: r.got_count,
      missCount: r.miss_count,
      nextReview: r.next_review ? Number(r.next_review) : undefined,
      lastSeen: r.last_seen ? Number(r.last_seen) : undefined,
      retired: r.retired,
      flagged: r.flagged,
    }
  }
  return state
}

export async function upsertCardState(cardId: string, s: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO card_state (card_id, interval_days, streak, got_count, miss_count, next_review, last_seen, retired, flagged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (card_id) DO UPDATE SET
       interval_days = $2, streak = $3, got_count = $4, miss_count = $5,
       next_review = $6, last_seen = $7, retired = $8, flagged = $9`,
    [cardId, s.interval || 1, s.streak || 0, s.gotCount || 0, s.missCount || 0,
     s.nextReview || null, s.lastSeen || null, !!s.retired, !!s.flagged],
  )
}

export async function deleteCardState(cardId: string) {
  await pool.query('DELETE FROM card_state WHERE card_id = $1', [cardId])
}

// ── Sessions & Messages ─────────────────────────────────────────────────────

export async function getCardSessions(cardId: string) {
  const { rows } = await pool.query(
    `SELECT s.id as session_id, s.started_at, s.score as session_score,
            m.id as msg_id, m.role, m.content, m.ts, m.score as msg_score
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id
     WHERE s.card_id = $1
     ORDER BY s.started_at ASC, m.ts ASC`,
    [cardId],
  )
  const sessionsMap = new Map<string, { id: string; startedAt: number; score: number | null; messages: unknown[] }>()
  for (const r of rows) {
    if (!sessionsMap.has(r.session_id)) {
      sessionsMap.set(r.session_id, {
        id: r.session_id,
        startedAt: Number(r.started_at),
        score: r.session_score,
        messages: [],
      })
    }
    if (r.msg_id) {
      sessionsMap.get(r.session_id)!.messages.push({
        role: r.role,
        content: r.content,
        ts: Number(r.ts),
        ...(r.msg_score !== null ? { score: r.msg_score } : {}),
      })
    }
  }
  return [...sessionsMap.values()]
}

export async function getCurrentSession(cardId: string) {
  const { rows } = await pool.query(
    'SELECT * FROM sessions WHERE card_id = $1 ORDER BY started_at DESC LIMIT 1', [cardId],
  )
  if (!rows.length) return null
  const sr = rows[0]
  const { rows: msgRows } = await pool.query(
    'SELECT * FROM messages WHERE session_id = $1 ORDER BY ts ASC', [sr.id],
  )
  return {
    id: sr.id,
    startedAt: Number(sr.started_at),
    score: sr.score,
    messages: msgRows.map(m => ({
      role: m.role,
      content: m.content,
      ts: Number(m.ts),
      ...(m.score !== null ? { score: m.score } : {}),
    })),
  }
}

export async function createSession(cardId: string) {
  const id = crypto.randomUUID()
  const startedAt = Date.now()
  await pool.query(
    'INSERT INTO sessions (id, card_id, started_at) VALUES ($1,$2,$3)',
    [id, cardId, startedAt],
  )
  return { id, startedAt, score: null, messages: [] }
}

export async function appendMessage(
  sessionId: string, cardId: string, role: string, content: string, score: number | null = null,
) {
  const ts = Date.now()
  await pool.query(
    'INSERT INTO messages (session_id, card_id, role, content, ts, score) VALUES ($1,$2,$3,$4,$5,$6)',
    [sessionId, cardId, role, content, ts, score],
  )
}

export async function setSessionScore(sessionId: string, score: number) {
  await pool.query('UPDATE sessions SET score = $1 WHERE id = $2', [score, sessionId])
}

export async function deleteCardConversations(cardId: string) {
  await pool.query('DELETE FROM sessions WHERE card_id = $1', [cardId])
}

export async function getLowScoreSessions(cardIds: string[]) {
  if (!cardIds.length) return []
  const { rows: sessionRows } = await pool.query(
    `SELECT s.*, c.front, c.back FROM sessions s
     JOIN cards c ON c.id = s.card_id
     WHERE s.card_id = ANY($1) AND s.score IS NOT NULL AND s.score <= 1
     AND s.gap_card_generated = false
     ORDER BY s.started_at DESC`,
    [cardIds],
  )
  const sessions = []
  for (const sr of sessionRows) {
    const { rows: msgRows } = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY ts ASC', [sr.id],
    )
    sessions.push({
      id: sr.id,
      cardId: sr.card_id,
      cardFront: sr.front,
      cardBack: sr.back,
      score: sr.score,
      messages: msgRows,
    })
  }
  return sessions
}

export async function markGapCardGenerated(sessionIds: string[]) {
  if (!sessionIds.length) return
  await pool.query(
    'UPDATE sessions SET gap_card_generated = true WHERE id = ANY($1)',
    [sessionIds],
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings')
  const result: Record<string, unknown> = {}
  for (const r of rows) {
    result[r.key] = r.value
  }
  return result
}

export async function saveAllSettings(settings: Record<string, unknown>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, JSON.stringify(value)],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ── Activity ────────────────────────────────────────────────────────────────

export async function trackActivity() {
  const today = new Date().toISOString().slice(0, 10)
  await pool.query(
    `INSERT INTO activity_log (date, count) VALUES ($1, 1)
     ON CONFLICT (date) DO UPDATE SET count = activity_log.count + 1`,
    [today],
  )
}

export async function getActivityLog() {
  const { rows } = await pool.query('SELECT date, count FROM activity_log')
  const data: Record<string, number> = {}
  for (const r of rows) {
    const key = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date)
    data[key] = r.count
  }
  return data
}

// ── Eval Log ────────────────────────────────────────────────────────────────

export async function appendEvalEntry(entry: {
  cardId: string; front: string; answer: string; score: number; feedback?: string; ts: number
}) {
  await pool.query(
    `INSERT INTO evaluation_log (card_id, front, answer, score, feedback, ts)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.cardId, entry.front, entry.answer, entry.score, entry.feedback || null, entry.ts],
  )
}

// ── Embeddings ──────────────────────────────────────────────────────────────

export async function getCardEmbeddings() {
  const { rows } = await pool.query('SELECT * FROM card_embeddings')
  if (!rows.length) return { model: 'text-embedding-3-small', indexed_at: 0, embeddings: {} }
  const embeddings: Record<string, number[]> = {}
  let model = 'text-embedding-3-small'
  let indexedAt = 0
  for (const r of rows) {
    embeddings[r.card_id] = r.embedding
    model = r.model
    indexedAt = Math.max(indexedAt, Number(r.indexed_at))
  }
  return { model, indexed_at: indexedAt, embeddings }
}

export async function saveCardEmbeddings(data: {
  model?: string; indexed_at?: number; embeddings: Record<string, number[]>
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM card_embeddings')
    const model = data.model || 'text-embedding-3-small'
    const indexedAt = data.indexed_at || Date.now()
    for (const [cardId, emb] of Object.entries(data.embeddings || {})) {
      await client.query(
        'INSERT INTO card_embeddings (card_id, model, embedding, indexed_at) VALUES ($1,$2,$3,$4)',
        [cardId, model, emb, indexedAt],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function upsertCardEmbedding(
  cardId: string, model: string, embedding: number[], indexedAt: number,
) {
  await pool.query(
    `INSERT INTO card_embeddings (card_id, model, embedding, indexed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (card_id) DO UPDATE SET
       model = EXCLUDED.model, embedding = EXCLUDED.embedding, indexed_at = EXCLUDED.indexed_at`,
    [cardId, model, embedding, indexedAt],
  )
}

// ── Problem Logs CRUD ───────────────────────────────────────────────────────

export async function getAllProblemLogs() {
  const { rows } = await pool.query(
    `SELECT id, filename, date, type, problem, tags, repo
     FROM problem_logs
     WHERE merged_into IS NULL
     ORDER BY date DESC NULLS LAST, filename DESC`,
  )
  return rows.map(r => ({
    id: r.id,
    filename: r.filename,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : (r.date || ''),
    problem: r.problem,
    tags: r.tags || [],
    repo: r.repo || null,
  }))
}

export async function getProblemLog(filename: string) {
  const { rows } = await pool.query(
    'SELECT content FROM problem_logs WHERE filename = $1', [filename],
  )
  return rows.length ? rows[0].content : null
}

export async function upsertProblemLog(log: {
  filename: string; date?: string | null; type?: string; problem?: string; tags?: string[]; content: string
}) {
  await pool.query(
    `INSERT INTO problem_logs (filename, date, type, problem, tags, content)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (filename) DO UPDATE SET
       date = $2, type = $3, problem = $4, tags = $5, content = $6`,
    [log.filename, log.date || null, log.type || 'coding',
     log.problem || '', log.tags || [], log.content],
  )
}

export async function markLogMerged(filename: string, mergedIntoFilename: string) {
  await pool.query(
    'UPDATE problem_logs SET merged_into = (SELECT id FROM problem_logs WHERE filename = $1) WHERE filename = $2',
    [mergedIntoFilename, filename],
  )
}

// ── Gap Card Feedback ───────────────────────────────────────────────────────

export async function appendGapFeedback(entry: {
  cardFront: string; cardBack: string; sourceCardFront: string; approved: boolean; reason?: string; ts: number
}) {
  await pool.query(
    `INSERT INTO gap_card_feedback (card_front, card_back, source_card_front, approved, reason, ts)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.cardFront, entry.cardBack, entry.sourceCardFront, entry.approved, entry.reason || null, entry.ts],
  )
}

export async function getRecentDenials(limit = 5) {
  const { rows } = await pool.query(
    `SELECT card_front, source_card_front, reason FROM gap_card_feedback
     WHERE approved = false AND reason IS NOT NULL
     ORDER BY ts DESC LIMIT $1`,
    [limit],
  )
  return rows
}

// ── Repos ───────────────────────────────────────────────────────────────────

export async function getDistinctRepos() {
  const { rows } = await pool.query(
    `SELECT DISTINCT repo FROM problem_logs WHERE repo IS NOT NULL AND merged_into IS NULL
     UNION
     SELECT DISTINCT repo FROM cards WHERE repo IS NOT NULL
     ORDER BY repo`,
  )
  return rows.map(r => r.repo)
}

// ── Bootstrap (all startup data in one call) ────────────────────────────────

export async function getBootstrapData() {
  const [cards, cardState, settings] = await Promise.all([
    getAllCards(),
    getAllCardState(),
    getSettings(),
  ])
  return { cards, cardState, settings }
}
