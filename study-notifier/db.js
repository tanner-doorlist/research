const { Pool } = require('pg')
const crypto = require('crypto')

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/study_notifier'
const pool = new Pool({ connectionString: DATABASE_URL, max: 3 })

function newId() { return crypto.randomUUID() }

// ── Schema ───────────────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`)
  await pool.query(`
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

    CREATE TABLE IF NOT EXISTS card_embeddings (
      card_id    TEXT PRIMARY KEY,
      model      TEXT NOT NULL DEFAULT 'text-embedding-3-small',
      embedding  REAL[] NOT NULL,
      indexed_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL DEFAULT 'qa',
      front       TEXT NOT NULL,
      back        TEXT NOT NULL DEFAULT '',
      tags        TEXT[] NOT NULL DEFAULT '{}',
      when_to_use TEXT NOT NULL DEFAULT '',
      how_it_works TEXT NOT NULL DEFAULT '',
      example     TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
      embedding       vector(1536)
    );
  `)

  // Create indexes (idempotent)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_card_state_next_review ON card_state(next_review);
    CREATE INDEX IF NOT EXISTS idx_sessions_card_id ON sessions(card_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_card_id ON messages(card_id);
    CREATE INDEX IF NOT EXISTS idx_eval_log_card_id ON evaluation_log(card_id);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_date ON problem_logs(date);
    CREATE INDEX IF NOT EXISTS idx_problem_logs_merged ON problem_logs(merged_into);
  `)
  // Add embedding column if missing (migration from pre-pgvector schema)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE problem_logs ADD COLUMN embedding vector(1536);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `)
  // Add gap_card_generated column if missing
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE sessions ADD COLUMN gap_card_generated BOOLEAN NOT NULL DEFAULT false;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `)
  // pgvector HNSW index for cosine similarity search
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_problem_logs_embedding ON problem_logs
    USING hnsw (embedding vector_cosine_ops)
  `)
}

// ── Migration from JSON files ────────────────────────────────────────────────
async function migrateFromFiles(files) {
  const fs = require('fs')
  const path = require('path')

  // Migrate cards from TSV if cards table is empty
  const { rows: cardCount } = await pool.query('SELECT COUNT(*) as n FROM cards')
  if (parseInt(cardCount[0].n) === 0) {
    await migrateCardsFromTsv(fs, files)
  }

  // Migrate problem logs from markdown if problem_logs table is empty
  const { rows: logCount } = await pool.query('SELECT COUNT(*) as n FROM problem_logs')
  if (parseInt(logCount[0].n) === 0 && files.logsDir) {
    await migrateLogsFromFiles(fs, path, files.logsDir)
  }

  // Only migrate JSON state if tables are empty
  const { rows } = await pool.query('SELECT COUNT(*) as n FROM card_state')
  if (parseInt(rows[0].n) > 0) return

  console.log('[db] Migrating from JSON files...')

  // Card state
  if (files.stateFile) {
    try {
      const data = JSON.parse(fs.readFileSync(files.stateFile, 'utf8'))
      for (const [cardId, s] of Object.entries(data)) {
        await pool.query(
          `INSERT INTO card_state (card_id, interval_days, streak, got_count, miss_count, next_review, last_seen, retired, flagged)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [cardId, s.interval || 1, s.streak || 0, s.gotCount || 0, s.missCount || 0,
           s.nextReview || null, s.lastSeen || null, !!s.retired, !!s.flagged]
        )
      }
      console.log(`[db] Migrated ${Object.keys(data).length} card states`)
    } catch {}
  }

  // Settings
  if (files.settingsFile) {
    try {
      const data = JSON.parse(fs.readFileSync(files.settingsFile, 'utf8'))
      for (const [key, value] of Object.entries(data)) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [key, JSON.stringify(value)]
        )
      }
      console.log(`[db] Migrated settings`)
    } catch {}
  }

  // Activity log
  if (files.activityFile) {
    try {
      const data = JSON.parse(fs.readFileSync(files.activityFile, 'utf8'))
      for (const [date, count] of Object.entries(data)) {
        await pool.query(
          `INSERT INTO activity_log (date, count) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [date, count]
        )
      }
      console.log(`[db] Migrated ${Object.keys(data).length} activity entries`)
    } catch {}
  }

  // Evaluation log
  if (files.evalLogFile) {
    try {
      const data = JSON.parse(fs.readFileSync(files.evalLogFile, 'utf8'))
      for (const e of data) {
        await pool.query(
          `INSERT INTO evaluation_log (card_id, front, answer, score, feedback, ts)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [e.cardId, e.front, e.answer, e.score, e.feedback || null, e.ts]
        )
      }
      console.log(`[db] Migrated ${data.length} eval log entries`)
    } catch {}
  }

  // Conversations
  if (files.conversationsFile) {
    try {
      let data = JSON.parse(fs.readFileSync(files.conversationsFile, 'utf8'))
      for (const [cardId, val] of Object.entries(data)) {
        // Handle flat array or sessions format
        const sessions = Array.isArray(val)
          ? [{ id: newId(), startedAt: val[0]?.ts || Date.now(), score: null, messages: val }]
          : (val.sessions || [])
        for (const session of sessions) {
          const sid = session.id || newId()
          await pool.query(
            `INSERT INTO sessions (id, card_id, started_at, score) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [sid, cardId, session.startedAt, session.score ?? null]
          )
          for (const msg of session.messages || []) {
            await pool.query(
              `INSERT INTO messages (session_id, card_id, role, content, ts, score) VALUES ($1,$2,$3,$4,$5,$6)`,
              [sid, cardId, msg.role, msg.content, msg.ts, msg.score ?? null]
            )
          }
        }
      }
      console.log(`[db] Migrated conversations`)
    } catch {}
  }

  // Card embeddings
  if (files.embeddingsFile) {
    try {
      const data = JSON.parse(fs.readFileSync(files.embeddingsFile, 'utf8'))
      const indexedAt = data.indexed_at || Date.now()
      const model = data.model || 'text-embedding-3-small'
      for (const [cardId, emb] of Object.entries(data.embeddings || {})) {
        await pool.query(
          `INSERT INTO card_embeddings (card_id, model, embedding, indexed_at)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [cardId, model, emb, indexedAt]
        )
      }
      console.log(`[db] Migrated ${Object.keys(data.embeddings || {}).length} embeddings`)
    } catch {}
  }

  console.log('[db] Migration complete')
}

// ── Card TSV migration ──────────────────────────────────────────────────────
async function migrateCardsFromTsv(fs, files) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // QA cards
  if (files.cardsFile && fs.existsSync(files.cardsFile)) {
    const lines = fs.readFileSync(files.cardsFile, 'utf8').trim().split('\n').slice(1)
    let count = 0
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 4) continue
      const id = parts[0]
      if (!UUID_RE.test(id)) continue
      const front = (parts[1] || '').trim()
      const back = (parts[2] || '').trim()
      const tags = (parts[3] || '').split(' ').filter(Boolean)
      if (!front) continue
      await pool.query(
        `INSERT INTO cards (id, type, front, back, tags) VALUES ($1,'qa',$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, front, back, tags]
      )
      count++
    }
    if (count) console.log(`[db] Migrated ${count} QA cards from TSV`)
  }

  // Concept cards
  if (files.conceptFile && fs.existsSync(files.conceptFile)) {
    const lines = fs.readFileSync(files.conceptFile, 'utf8').trim().split('\n').slice(1)
    let count = 0
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 5) continue
      const id = parts[0]
      if (!UUID_RE.test(id)) continue
      const concept = (parts[1] || '').trim()
      const when = (parts[2] || '').trim()
      const how = (parts[3] || '').trim()
      const example = (parts[4] || '').trim()
      if (!concept) continue
      const backParts = [
        when && `**When:** ${when}`,
        how && `**How:** ${how}`,
        example && `**Example:** ${example}`,
      ].filter(Boolean)
      const back = backParts.length ? backParts.join('\n\n') : how
      await pool.query(
        `INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example)
         VALUES ($1,'concept',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, concept, back, ['concept'], when, how, example]
      )
      count++
    }
    if (count) console.log(`[db] Migrated ${count} concept cards from TSV`)
  }
}

// ── Problem log file migration ──────────────────────────────────────────────
async function migrateLogsFromFiles(fs, path, logsDir) {
  if (!fs.existsSync(logsDir)) return
  const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.md') && !f.startsWith('_'))
  let count = 0
  for (const filename of files) {
    const content = fs.readFileSync(path.join(logsDir, filename), 'utf8')
    const fm = {}
    const m = content.match(/^---\n([\s\S]*?)\n---/)
    if (m) {
      for (const line of m[1].split('\n')) {
        const i = line.indexOf(': ')
        if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 2).trim()
      }
    }
    let tags = []
    try {
      const parsed = JSON.parse(fm.tags || '[]')
      if (Array.isArray(parsed)) tags = parsed
    } catch {}

    const isMerged = filename.startsWith('_merged-')
    await pool.query(
      `INSERT INTO problem_logs (filename, date, type, problem, tags, content, merged_into)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [filename, fm.date || null, fm.type || 'coding', fm.problem || filename,
       tags, content, isMerged ? 'self' : null]
    )
    count++
  }
  // Also migrate merged files (prefixed with _merged-)
  const mergedFiles = fs.readdirSync(logsDir).filter(f => f.startsWith('_merged-') && f.endsWith('.md'))
  for (const filename of mergedFiles) {
    const content = fs.readFileSync(path.join(logsDir, filename), 'utf8')
    await pool.query(
      `INSERT INTO problem_logs (filename, date, type, problem, tags, content, merged_into)
       VALUES ($1, null, 'coding', $2, '{}', $3, 'self') ON CONFLICT DO NOTHING`,
      [filename, filename, content]
    )
  }
  if (count) console.log(`[db] Migrated ${count} problem logs from files`)
}

// ── Cards CRUD ──────────────────────────────────────────────────────────────
async function getAllCards() {
  const { rows } = await pool.query('SELECT * FROM cards ORDER BY created_at ASC')
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    front: r.front,
    back: r.back,
    tags: r.tags || [],
    ...(r.type === 'concept' ? {
      when: r.when_to_use,
      how: r.how_it_works,
      example: r.example,
    } : {}),
  }))
}

async function insertCard(card) {
  await pool.query(
    `INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [card.id, card.type || 'qa', card.front, card.back || '',
     card.tags || [], card.when || '', card.how || '', card.example || '']
  )
}

async function updateCard(cardId, fields) {
  const sets = []
  const vals = [cardId]
  let i = 2
  if (fields.front !== undefined) { sets.push(`front = $${i++}`); vals.push(fields.front) }
  if (fields.back !== undefined) { sets.push(`back = $${i++}`); vals.push(fields.back) }
  if (fields.tags !== undefined) { sets.push(`tags = $${i++}`); vals.push(fields.tags) }
  if (fields.when !== undefined) { sets.push(`when_to_use = $${i++}`); vals.push(fields.when) }
  if (fields.how !== undefined) { sets.push(`how_it_works = $${i++}`); vals.push(fields.how) }
  if (fields.example !== undefined) { sets.push(`example = $${i++}`); vals.push(fields.example) }
  if (!sets.length) return
  await pool.query(`UPDATE cards SET ${sets.join(', ')} WHERE id = $1`, vals)
}

async function deleteCard(cardId) {
  const { rowCount } = await pool.query('DELETE FROM cards WHERE id = $1', [cardId])
  return rowCount > 0
}

async function updateCardTags(cardId, tags) {
  await pool.query('UPDATE cards SET tags = $1 WHERE id = $2', [tags, cardId])
}

// ── Problem Logs CRUD ───────────────────────────────────────────────────────
async function getAllProblemLogs() {
  const { rows } = await pool.query(
    `SELECT id, filename, date, type, problem, tags
     FROM problem_logs
     WHERE merged_into IS NULL
     ORDER BY date DESC NULLS LAST, filename DESC`
  )
  return rows.map(r => ({
    id: r.id,
    filename: r.filename,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : (r.date || ''),
    problem: r.problem,
    tags: r.tags ? JSON.stringify(r.tags) : '[]',
  }))
}

async function getProblemLog(filename) {
  const { rows } = await pool.query(
    'SELECT content FROM problem_logs WHERE filename = $1', [filename]
  )
  return rows.length ? rows[0].content : null
}

async function upsertProblemLog(log) {
  await pool.query(
    `INSERT INTO problem_logs (filename, date, type, problem, tags, content)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (filename) DO UPDATE SET
       date = $2, type = $3, problem = $4, tags = $5, content = $6`,
    [log.filename, log.date || null, log.type || 'coding',
     log.problem || '', log.tags || [], log.content]
  )
}

async function markLogMerged(filename, mergedIntoId) {
  await pool.query(
    'UPDATE problem_logs SET merged_into = $1 WHERE filename = $2',
    [mergedIntoId, filename]
  )
}

async function getUnprocessedLogs() {
  const { rows } = await pool.query(
    `SELECT id, filename, content FROM problem_logs
     WHERE merged_into IS NULL AND cards_generated = false
     ORDER BY date ASC`
  )
  return rows
}

async function markLogProcessed(filename) {
  await pool.query(
    'UPDATE problem_logs SET cards_generated = true WHERE filename = $1',
    [filename]
  )
}

// ── Card State ───────────────────────────────────────────────────────────────
async function getAllCardState() {
  const { rows } = await pool.query('SELECT * FROM card_state')
  const state = {}
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

async function upsertCardState(cardId, s) {
  await pool.query(
    `INSERT INTO card_state (card_id, interval_days, streak, got_count, miss_count, next_review, last_seen, retired, flagged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (card_id) DO UPDATE SET
       interval_days = $2, streak = $3, got_count = $4, miss_count = $5,
       next_review = $6, last_seen = $7, retired = $8, flagged = $9`,
    [cardId, s.interval || 1, s.streak || 0, s.gotCount || 0, s.missCount || 0,
     s.nextReview || null, s.lastSeen || null, !!s.retired, !!s.flagged]
  )
}

async function deleteCardState(cardId) {
  await pool.query('DELETE FROM card_state WHERE card_id = $1', [cardId])
}

// ── Sessions & Messages ──────────────────────────────────────────────────────
async function getCardSessions(cardId) {
  const { rows } = await pool.query(
    `SELECT s.id as session_id, s.started_at, s.score as session_score,
            m.id as msg_id, m.role, m.content, m.ts, m.score as msg_score
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id
     WHERE s.card_id = $1
     ORDER BY s.started_at ASC, m.ts ASC`,
    [cardId]
  )
  const sessionsMap = new Map()
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
      sessionsMap.get(r.session_id).messages.push({
        role: r.role,
        content: r.content,
        ts: Number(r.ts),
        ...(r.msg_score !== null ? { score: r.msg_score } : {}),
      })
    }
  }
  return [...sessionsMap.values()]
}

async function getCurrentSession(cardId) {
  const { rows } = await pool.query(
    'SELECT * FROM sessions WHERE card_id = $1 ORDER BY started_at DESC LIMIT 1', [cardId]
  )
  if (!rows.length) return null
  const sr = rows[0]
  const { rows: msgRows } = await pool.query(
    'SELECT * FROM messages WHERE session_id = $1 ORDER BY ts ASC', [sr.id]
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

async function createSession(cardId) {
  const id = newId()
  const startedAt = Date.now()
  await pool.query(
    'INSERT INTO sessions (id, card_id, started_at) VALUES ($1,$2,$3)',
    [id, cardId, startedAt]
  )
  return { id, startedAt, score: null, messages: [] }
}

async function appendMessage(sessionId, cardId, role, content, meta = {}) {
  const ts = Date.now()
  await pool.query(
    'INSERT INTO messages (session_id, card_id, role, content, ts, score) VALUES ($1,$2,$3,$4,$5,$6)',
    [sessionId, cardId, role, content, ts, meta.score ?? null]
  )
}

async function setSessionScore(sessionId, score) {
  await pool.query('UPDATE sessions SET score = $1 WHERE id = $2', [score, sessionId])
}

async function deleteCardConversations(cardId) {
  // Cascade deletes messages
  await pool.query('DELETE FROM sessions WHERE card_id = $1', [cardId])
}

async function getLowScoreSessions(cardIds) {
  if (!cardIds.length) return []
  const { rows: sessionRows } = await pool.query(
    `SELECT s.*, c.front, c.back FROM sessions s
     JOIN cards c ON c.id = s.card_id
     WHERE s.card_id = ANY($1) AND s.score IS NOT NULL AND s.score <= 1
     AND s.gap_card_generated = false
     ORDER BY s.started_at DESC`,
    [cardIds]
  )
  const sessions = []
  for (const sr of sessionRows) {
    const { rows: msgRows } = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY ts ASC', [sr.id]
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

async function markGapCardGenerated(sessionIds) {
  if (!sessionIds.length) return
  await pool.query(
    'UPDATE sessions SET gap_card_generated = true WHERE id = ANY($1)',
    [sessionIds]
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function getSettings(defaults) {
  const { rows } = await pool.query('SELECT key, value FROM settings')
  const result = { ...defaults }
  for (const r of rows) {
    result[r.key] = r.value
  }
  return result
}

async function saveAllSettings(settings) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, JSON.stringify(value)]
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

// ── Activity ─────────────────────────────────────────────────────────────────
async function trackActivity() {
  const today = new Date().toISOString().slice(0, 10)
  await pool.query(
    `INSERT INTO activity_log (date, count) VALUES ($1, 1)
     ON CONFLICT (date) DO UPDATE SET count = activity_log.count + 1`,
    [today]
  )
}

async function getActivityLog() {
  const { rows } = await pool.query('SELECT date, count FROM activity_log')
  const data = {}
  for (const r of rows) {
    const key = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date)
    data[key] = r.count
  }
  return data
}

// ── Eval Log ─────────────────────────────────────────────────────────────────
async function appendEvalEntry(entry) {
  await pool.query(
    `INSERT INTO evaluation_log (card_id, front, answer, score, feedback, ts)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.cardId, entry.front, entry.answer, entry.score, entry.feedback || null, entry.ts]
  )
}

// ── Embeddings ───────────────────────────────────────────────────────────────
async function getCardEmbeddings() {
  const { rows } = await pool.query('SELECT * FROM card_embeddings')
  if (!rows.length) return { embeddings: {} }
  const embeddings = {}
  let model = 'text-embedding-3-small'
  let indexedAt = 0
  for (const r of rows) {
    embeddings[r.card_id] = r.embedding
    model = r.model
    indexedAt = Math.max(indexedAt, Number(r.indexed_at))
  }
  return { model, indexed_at: indexedAt, embeddings }
}

async function saveCardEmbeddings(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM card_embeddings')
    const model = data.model || 'text-embedding-3-small'
    const indexedAt = data.indexed_at || Date.now()
    for (const [cardId, emb] of Object.entries(data.embeddings || {})) {
      await client.query(
        `INSERT INTO card_embeddings (card_id, model, embedding, indexed_at) VALUES ($1,$2,$3,$4)`,
        [cardId, model, emb, indexedAt]
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

// ── Gap Card Feedback ────────────────────────────────────────────────────────
async function appendGapFeedback(entry) {
  await pool.query(
    `INSERT INTO gap_card_feedback (card_front, card_back, source_card_front, approved, reason, ts)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.cardFront, entry.cardBack, entry.sourceCardFront, entry.approved, entry.reason || null, entry.ts]
  )
}

async function getRecentDenials(limit = 5) {
  const { rows } = await pool.query(
    `SELECT card_front, source_card_front, reason FROM gap_card_feedback
     WHERE approved = false AND reason IS NOT NULL
     ORDER BY ts DESC LIMIT $1`,
    [limit]
  )
  return rows
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function close() {
  await pool.end()
}

module.exports = {
  pool, initSchema, migrateFromFiles, close,
  getAllCards, insertCard, updateCard, deleteCard, updateCardTags,
  getAllCardState, upsertCardState, deleteCardState,
  getCardSessions, getCurrentSession, createSession, appendMessage, setSessionScore, deleteCardConversations, getLowScoreSessions, markGapCardGenerated,
  getSettings, saveAllSettings,
  trackActivity, getActivityLog,
  appendEvalEntry,
  getCardEmbeddings, saveCardEmbeddings,
  getAllProblemLogs, getProblemLog, upsertProblemLog, markLogMerged,
  getUnprocessedLogs, markLogProcessed,
  appendGapFeedback, getRecentDenials,
}
