-- Seed data for local development.
-- Idempotent — uses IF NOT EXISTS / ON CONFLICT DO NOTHING so it's safe to run multiple times.

-- ── Schema (mirrors remote-mcp-server/src/db.ts initSchema) ──────────────────

CREATE EXTENSION IF NOT EXISTS vector;

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

-- ── Cards ────────────────────────────────────────────────────────────────────

INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example, repo) VALUES
  ('seed-001', 'qa',
   'What is the difference between `useQuery` and `useMutation` in React Query?',
   '`useQuery` is for **reading** data — it caches, deduplicates, and auto-refetches. `useMutation` is for **writing** data — it provides `isPending`, error states, and cache invalidation hooks.',
   ARRAY['react', 'react-query'],
   'When choosing how to fetch or modify server data in a React component.',
   'useQuery subscribes to a cache key and auto-manages loading/error/data states. useMutation wraps a single async operation and exposes lifecycle callbacks (onSuccess, onError, onSettled).',
   'const { data } = useQuery({ queryKey: [''todos''], queryFn: fetchTodos })',
   'wellington'),

  ('seed-002', 'qa',
   'How does pgvector cosine similarity search work?',
   'pgvector stores embeddings as `vector(N)` columns. Cosine distance uses the `<=>` operator. Lower distance = more similar. `1 - distance` gives a similarity score from 0 to 1.',
   ARRAY['postgres', 'embeddings'],
   'When implementing semantic search or deduplication against stored embeddings.',
   'An HNSW index on the vector column enables approximate nearest-neighbor search. The query sorts by `embedding <=> query_vector` and limits results.',
   'SELECT *, 1 - (embedding <=> $1::vector) AS similarity FROM problem_logs ORDER BY embedding <=> $1::vector LIMIT 5',
   'wellington'),

  ('seed-003', 'concept',
   'Explain the SM-2 spaced repetition algorithm.',
   'SM-2 adjusts review intervals based on performance. Correct answers multiply the interval (commonly by 2.5), wrong answers reset to 1 day. A "streak" of correct answers increases confidence, and cards are eventually retired after enough consecutive correct reviews at max interval.',
   ARRAY['learning', 'algorithms'],
   'When building any flashcard or spaced repetition system.',
   'Each card tracks interval_days and streak. On correct: interval *= 2.5 (capped at 180d), streak++. On wrong: interval = 1, streak = 0. After N consecutive correct at max interval, the card is retired.',
   '',
   NULL),

  ('seed-004', 'qa',
   'What is the Electron IPC bridge pattern?',
   'The main process exposes APIs via `ipcMain.handle()`. The preload script bridges them to the renderer via `contextBridge.exposeInMainWorld()`. The renderer calls `window.api.methodName()` which returns a Promise resolved by the main process.',
   ARRAY['electron', 'architecture'],
   'When building desktop apps with Electron that need secure communication between renderer and main process.',
   'The preload script runs in a privileged context with access to Node.js APIs. It selectively exposes safe async methods to the sandboxed renderer, preventing direct access to Node.js or filesystem.',
   'contextBridge.exposeInMainWorld(''api'', { getSettings: () => ipcRenderer.invoke(''settings:get'') })',
   'wellington'),

  ('seed-005', 'qa',
   'How do you invalidate React Query caches after a mutation?',
   'Call `queryClient.invalidateQueries({ queryKey: [''key''] })` in the mutation''s `onSuccess` callback. This marks matching queries as stale and triggers a refetch if they are currently mounted.',
   ARRAY['react', 'react-query'],
   'After any mutation that changes server data that other queries depend on.',
   'invalidateQueries matches query keys by prefix. Invalidating [''todos''] also invalidates [''todos'', 1]. Queries that are not currently rendered will be marked stale but won''t refetch until next mount.',
   'useMutation({ mutationFn: updateTodo, onSuccess: () => queryClient.invalidateQueries({ queryKey: [''todos''] }) })',
   'wellington'),

  ('seed-006', 'qa',
   'What is the purpose of Terraform state?',
   'Terraform state maps your configuration to real-world resources. It tracks resource IDs, metadata, and dependencies so Terraform knows what exists, what to create, update, or destroy on the next `terraform apply`.',
   ARRAY['infrastructure', 'terraform'],
   'When managing cloud infrastructure as code.',
   'State is stored in a backend (local file, GCS bucket, etc.). `terraform plan` diffs desired config against state to produce an execution plan. Without state, Terraform would try to recreate everything.',
   '',
   NULL),

  ('seed-007', 'concept',
   'Explain the difference between HNSW and IVFFlat indexes in pgvector.',
   'HNSW (Hierarchical Navigable Small World) builds a multi-layer graph for fast approximate nearest-neighbor search with high recall. IVFFlat partitions vectors into clusters and searches nearby clusters. HNSW has better query performance but slower index builds and more memory usage.',
   ARRAY['postgres', 'embeddings'],
   'When choosing an index strategy for vector similarity search at scale.',
   'HNSW: O(log n) query time, builds incrementally, higher memory. IVFFlat: requires training step, faster builds, needs more probes for good recall. For most use cases under 1M vectors, HNSW is preferred.',
   'CREATE INDEX ON problem_logs USING hnsw (embedding vector_cosine_ops)',
   NULL),

  ('seed-008', 'qa',
   'How does the Hono web framework handle middleware?',
   'Hono uses a chain of middleware functions called with `app.use()`. Each middleware receives a Context object and calls `next()` to pass control. Middleware can modify the request/response, add headers, check auth, etc.',
   ARRAY['backend', 'hono'],
   'When building HTTP APIs with Hono in TypeScript.',
   'Middleware runs in order of registration. `app.use(''*'', cors())` applies CORS to all routes. Route-specific middleware can be passed as arguments before the handler: `app.get(''/api'', authMiddleware, handler)`.',
   'app.use(''*'', async (c, next) => { console.log(c.req.method, c.req.url); await next() })',
   'wellington')
ON CONFLICT (id) DO NOTHING;

-- ── Card State (spaced repetition) ───────────────────────────────────────────

INSERT INTO card_state (card_id, interval_days, streak, got_count, miss_count, next_review, last_seen, retired, flagged) VALUES
  ('seed-001', 3,   2, 4, 1, extract(epoch from now() - interval '1 hour')  * 1000, extract(epoch from now() - interval '1 day') * 1000, false, false),
  ('seed-002', 7,   3, 5, 0, extract(epoch from now() + interval '2 days')  * 1000, extract(epoch from now() - interval '3 days') * 1000, false, false),
  ('seed-003', 1,   0, 1, 2, extract(epoch from now() - interval '30 minutes') * 1000, extract(epoch from now() - interval '6 hours') * 1000, false, false),
  ('seed-004', 14,  4, 6, 1, extract(epoch from now() + interval '5 days')  * 1000, extract(epoch from now() - interval '7 days') * 1000, false, false),
  ('seed-005', 1,   0, 0, 0, extract(epoch from now() - interval '2 hours') * 1000, NULL, false, false),
  ('seed-006', 30,  5, 8, 0, extract(epoch from now() + interval '20 days') * 1000, extract(epoch from now() - interval '10 days') * 1000, false, false),
  ('seed-007', 180, 5, 10, 0, extract(epoch from now() + interval '180 days') * 1000, extract(epoch from now() - interval '30 days') * 1000, true, false),
  ('seed-008', 1,   0, 2, 3, extract(epoch from now()) * 1000, extract(epoch from now() - interval '2 days') * 1000, false, true)
ON CONFLICT (card_id) DO NOTHING;

-- ── Problem Logs ─────────────────────────────────────────────────────────────

INSERT INTO problem_logs (id, filename, date, type, problem, tags, content, cards_generated, repo) VALUES
  ('log-001', 'react-query-migration-2026-03-28', '2026-03-28', 'coding',
   'Migrating from manual useState+useEffect to React Query',
   ARRAY['react', 'react-query', 'refactoring'],
   E'---\ndate: 2026-03-28\nproblem: Migrating from manual useState+useEffect to React Query\ntags: react, react-query, refactoring\n---\n\n## Key Insights\n- React Query replaces manual loading/error state management with declarative hooks\n- `useQuery` handles caching, deduplication, and background refetching automatically\n- Mutations with `onSuccess` callbacks are the clean way to invalidate stale queries\n- The `enabled` option lets you conditionally fetch based on component state\n\n## Solution\nCreated a centralized `use-api.ts` hook file with typed query and mutation hooks wrapping every IPC call. Each mutation that modifies data invalidates the relevant query keys.\n\n## Pitfalls\n- Don''t forget to set `enabled: false` for queries that depend on state not yet available\n- `useMutation` is better than `useQuery` for one-shot operations like chat sends\n- The default `staleTime` of 0 can cause unnecessary refetches — set a reasonable default',
   true, 'wellington'),

  ('log-002', 'electron-ipc-patterns-2026-03-25', '2026-03-25', 'coding',
   'Understanding Electron IPC security model',
   ARRAY['electron', 'security'],
   E'---\ndate: 2026-03-25\nproblem: Understanding Electron IPC security model\ntags: electron, security\n---\n\n## Key Insights\n- The preload script is the ONLY bridge between main and renderer processes\n- contextBridge.exposeInMainWorld creates a safe API surface\n- ipcRenderer.invoke returns Promises, ipcRenderer.send is fire-and-forget\n- Never expose ipcRenderer directly to the renderer\n\n## Solution\nAll data fetching goes through window.api methods defined in preload.js. Main process handlers registered with ipcMain.handle() for request/response, ipcMain.on() for fire-and-forget.\n\n## Pitfalls\n- Forgetting to clean up IPC listeners causes memory leaks\n- Large payloads over IPC are serialized/deserialized (performance hit)',
   true, 'wellington'),

  ('log-003', 'pgvector-dedup-threshold-2026-03-20', '2026-03-20', 'coding',
   'Tuning pgvector cosine similarity threshold for deduplication',
   ARRAY['postgres', 'embeddings', 'dedup'],
   E'---\ndate: 2026-03-20\nproblem: Tuning pgvector cosine similarity threshold for deduplication\ntags: postgres, embeddings, dedup\n---\n\n## Key Insights\n- 0.88 cosine similarity is a good threshold for detecting near-duplicate knowledge entries\n- Below 0.85, too many false positives (unrelated content matched)\n- Above 0.92, too many false negatives (rephrased content not caught)\n- HNSW index with vector_cosine_ops is required for the <=> operator to use the index\n\n## Solution\nSet DEDUP_THRESHOLD=0.88 in config. Before inserting a new log, embed it and query nearest neighbors. If similarity > threshold, merge instead of creating a new entry.\n\n## Pitfalls\n- Embeddings from different models are NOT comparable — always use the same model\n- Re-indexing after bulk inserts can be slow; batch inserts then rebuild index',
   true, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Activity Log (last 30 days) ──────────────────────────────────────────────

INSERT INTO activity_log (date, count) VALUES
  (current_date - interval '1 day',  5),
  (current_date - interval '2 days', 3),
  (current_date - interval '3 days', 7),
  (current_date - interval '5 days', 2),
  (current_date - interval '6 days', 4),
  (current_date - interval '8 days', 6),
  (current_date - interval '10 days', 3),
  (current_date - interval '12 days', 8),
  (current_date - interval '14 days', 5),
  (current_date - interval '15 days', 1),
  (current_date - interval '18 days', 4),
  (current_date - interval '20 days', 6),
  (current_date - interval '22 days', 3),
  (current_date - interval '25 days', 7),
  (current_date - interval '28 days', 2)
ON CONFLICT (date) DO NOTHING;

-- ── Settings ─────────────────────────────────────────────────────────────────

INSERT INTO settings (key, value) VALUES
  ('intervalMinutes',  '30'),
  ('annoyanceLevel',   '1'),
  ('cardsPerSession',  '3'),
  ('launchAtLogin',    'false'),
  ('retireThreshold',  '5')
ON CONFLICT (key) DO NOTHING;
