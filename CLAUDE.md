# CLAUDE.md — Knowledge Scribe Research Repo

This repo is a personal developer growth system: Claude/Cursor log insights during work sessions via MCP → Postgres (pgvector) → study cards → Electron spaced repetition app.

---

## Projects

| Directory | Purpose |
|-----------|---------|
| `knowledge-mcp/` | Python MCP server — log notes, search knowledge, generate study cards |
| `study-notifier/` | Electron macOS app — spaced repetition study sessions |
| `docker-compose.yml` | Postgres 17 + pgvector local service |
| `scripts/` | `setup` (install deps) and `dev` (start everything with hot reload) |
| `study-cards/` | **Legacy** — TSV files migrated to Postgres on first run |
| `problem-logs/` | **Legacy** — markdown files migrated to Postgres on first run |

---

## MCP Tools (knowledge-mcp/server.py)

MCP server name: `knowledge-scribe`

### `log_knowledge(ticket_id, raw_notes, tags?)`
Logs a knowledge entry from a work session.
- Embeds input → checks Postgres (pgvector) for semantic dups (threshold: 0.88 cosine similarity)
- If dup: merges with existing log via Claude
- If new: formats with Claude → writes to Postgres `problem_logs` table with embedding

**When to call:** At the end of a debugging session, after solving a non-trivial problem, or when a meaningful insight emerges. Use the ticket/task ID or a short descriptor as `ticket_id`.

### `search_knowledge(query, n_results=3)`
Semantic search over all logged knowledge.
- Embeds query → queries Postgres via pgvector cosine distance → extracts Key Insights, Solution, Pitfalls sections
- Returns similarity %, filename, date, and excerpts

**When to call:** When starting work on something that may have been encountered before.

### `generate_study_cards()`
Converts unprocessed problem-logs into flashcards.
- Reads unprocessed logs from Postgres → calls Claude → inserts Q&A + concept cards into Postgres `cards` table
- Marks logs as processed in `problem_logs.cards_generated`

**When to call:** After logging several new knowledge entries, or at end of a work session.

---

## Running Things

### Dev Scripts (recommended)

```bash
./scripts/setup                              # install all deps (run once per worktree)
./scripts/dev                                # start Electron + Vite + Postgres with hot reload
RESEARCH_DIR=~/research ./scripts/dev        # use ~/research for card data instead of repo dir
```

`RESEARCH_DIR` env var controls where `knowledge-mcp/` config lives. Defaults to the repo root. All data (cards, logs, state, embeddings) lives in Postgres.

### knowledge-mcp (Python)

```bash
cd knowledge-mcp

# Install deps
pip install -r requirements.txt

# Run MCP server (stdio, used by Claude/Cursor)
python3 server.py

# CLI alternatives (same logic, no MCP)
python3 cli.py log --ticket "DLE-123" --notes "..." [--tags tag1,tag2]
python3 cli.py search --query "..." [--n 3]
python3 cli.py generate

# Backfill embeddings for logs that don't have one yet
python3 index_existing.py
```

**Requires:**
- Postgres running (via `./scripts/dev` or `docker compose up -d`)
- `OPENAI_API_KEY` env var (for embeddings)
- `ANTHROPIC_API_KEY` env var (for formatting/merging)

### study-notifier (Electron + React)

**Stack:** Electron + React 19 + TypeScript + Tailwind v4 + React Query

```bash
cd study-notifier
npm install
npm run dev        # Vite dev server + Electron (hot reload)
npm run start      # Build renderer + run Electron
npm run build      # Full build → macOS .app to dist/
```

**Structure:**
- `main.js` — Electron main process (IPC, spaced repetition logic, AI calls)
- `db.js` — Postgres client (all data persistence)
- `preload.js` — IPC bridge (contextBridge → window.api)
- `src/renderer/` — React app (views, components, hooks)
  - `App.tsx` — View router (switches on push-based view state from main process)
  - `views/` — PillView, CardView, CatalogView, ChatView, KnowledgeView, AnalyticsView
  - `components/` — Shell, Titlebar, SettingsPanel, MarkdownRender, etc.
  - `lib/` — types.ts, markdown.ts (marked + highlight.js), query-client.ts
  - `hooks/` — use-view-state.ts (push-based IPC view), use-annoy.ts

**All data in Postgres** — no filesystem reads for cards, logs, or state.

---

## Data Model (Postgres)

All data lives in `study_notifier` Postgres database (Docker Compose). Uses `pgvector` extension for embedding storage and similarity search.

### Tables

| Table | Purpose |
|-------|---------|
| `cards` | Q&A and concept flashcards (id, type, front, back, tags[], when_to_use, how_it_works, example) |
| `card_state` | Spaced repetition state per card (interval, streak, got/miss counts, next_review, retired, flagged) |
| `problem_logs` | Knowledge logs (filename, date, problem, tags[], content, embedding vector(1536), merged_into, cards_generated) |
| `sessions` | Conversation sessions per card (card_id, started_at, score) |
| `messages` | Chat messages within sessions (session_id, card_id, role, content, ts, score) |
| `settings` | App settings as key-value JSONB |
| `activity_log` | Daily review counts |
| `evaluation_log` | AI grading history |
| `card_embeddings` | OpenAI embeddings for card semantic search/clustering |

### Legacy files (migrated on first run)
- `study-cards/*.tsv` → `cards` table
- `study-cards/.card_state.json` → `card_state` table
- `study-cards/.settings.json` → `settings` table
- `problem-logs/*.md` → `problem_logs` table

---

## Architecture Notes

- **Embeddings model:** `text-embedding-3-small` (OpenAI), 1536 dims, cosine distance
- **Vector search:** pgvector extension in Postgres — HNSW index on `problem_logs.embedding`
- **Dedup threshold:** 0.88 cosine similarity — above this, logs are merged rather than duplicated
- **Spaced repetition:** SM-2 variant — correct: `interval *= 2.5` (cap 180d), wrong: `interval = 1` + retry in 10 min
- **Data layer:** All data in Postgres (Docker Compose) — no external vector DB
- **Card IDs:** UUIDs
- **Electron IPC:** main.js owns in-memory card state; renderer is sandboxed React app that talks via preload.js bridge
- **Persistence pattern:** In-memory cache (cards, cardState, settings) with write-through to Postgres. Sessions/messages go directly through db.
- **Renderer stack:** React 19 + TypeScript + Tailwind v4 + React Query, built with Vite
- **View state:** Push-based from main.js via IPC (`onView`); renderer subscribes in `use-view-state` hook
- **Study session size:** default 3 cards, configurable in settings
- **Card retirement:** After `retireThreshold` (default 5) consecutive correct answers at max interval (180d), cards are auto-retired from rotation. Can be un-retired from catalog.
- **Bad-card flagging:** Cards can be flagged during review via the menu. Flagged cards are immediately removed from rotation and the session advances to the next card. Can be unflagged from catalog.
- **Delete flow:** Delete uses inline confirmation (no native dialog), advances to next card in session, and provides a 10-second undo window via toast. Deleted card data is stashed in memory for undo, re-inserted on undo.
- **Related notes:** When viewing a knowledge log detail, related notes are shown below (via pgvector semantic search). Each related note can be opened or combined with the current note.
- **Note combining:** Merges two knowledge logs into one via Claude, deduplicating content and preserving unique insights. The second log is marked as merged in Postgres (excluded from the log list).
- **Category clustering:** Auto-tag uses exactly 7 clusters (k-means on card embeddings) + a "misc" bucket for cards with weak cluster fit (cosine similarity < 0.25).

---

## Testing the Study Notifier

### Manual testing checklist

**Auto-retire:**
1. In Postgres: `UPDATE card_state SET interval_days=180, streak=4, got_count=4, miss_count=0, next_review=0 WHERE card_id='<id>'`
2. Run the app (`./scripts/dev`), answer that card correctly
3. Verify `retired=true` in `card_state` table
4. Verify the card no longer appears in study sessions
5. Open Catalog — verify "Retired" filter pill appears, retired card shows with "Retired ↩" label
6. Click "Retired ↩" to un-retire — verify card returns to active rotation

**Bad-card flagging:**
1. Start a study session (or open a card from catalog)
2. Open the menu (⋯) — verify "Bad card" option with flag icon exists
3. Click "Bad card" — verify session advances to next card (not window hide)
4. Open Catalog — verify "Flagged" filter pill appears
5. Click "Flagged ↩" on the flagged card to unflag

**Delete flow:**
1. Open a card in a multi-card session
2. Menu → Delete — verify inline red confirmation bar (not browser dialog)
3. Click Cancel — verify confirmation dismisses
4. Click Delete — verify next card in session appears
5. Verify undo toast appears at bottom ("Card deleted" + "Undo" button)
6. Click Undo within 10s — verify card is restored (check catalog)
7. Delete the last card in a session — verify catalog appears (not window hide)

**Settings:**
1. Open settings — verify "Retire after" slider (3-10 range) is present
2. Change the value and save — verify it persists across app restart

---

## Active Usage Pattern

During a work session with Claude Code:

1. **Before starting:** `search_knowledge("topic")` to surface relevant past learnings
2. **During work:** note interesting insights mentally
3. **After solving something:** `log_knowledge(ticket_id, raw_notes, tags)` — be specific about what was confusing, what the insight was, what to watch for
4. **Periodically:** `generate_study_cards()` to convert logs into flashcards
5. **Study Notifier app:** runs in background, pops up cards every ~10-20 min
