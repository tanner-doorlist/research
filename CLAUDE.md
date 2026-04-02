# CLAUDE.md — Knowledge Scribe

MCP server + Electron macOS app. Coding agents log insights via MCP → Postgres (pgvector) → spaced repetition flashcards with AI-graded chat sessions that identify and fill knowledge gaps.

### Distribution Goal
Ship as a single `.dmg` that coworkers install and immediately use — no Docker, no local Postgres, no manual setup. The app connects to a hosted `remote-mcp-server` (TypeScript/Hono on GCP Cloud Run) that serves both REST endpoints and the MCP protocol. Coworkers add the remote MCP URL to their Claude Code/Cursor MCP config. Auth is via a shared `TEAM_TOKEN` bearer token.

### Multi-Repo Knowledge Spaces
Devs work across multiple repos and want knowledge scoped per-repo (each repo gets its own cards/categories) with an "all" view across everything. Growth team members just want a single flat knowledge base. To support both:
- `log_knowledge` accepts an optional `repo` param (repo name or URL) — stored on the problem log and propagated to generated cards as a tag.
- The study-notifier UI shows a folder/tab nav by repo **only if** the user has at least one repo-tagged entry. Users with no repo tags see the flat single-source experience with no extra UI.
- "All" is always available as the default view regardless.

---

## Projects

| Directory | Purpose |
|-----------|---------|
| `remote-mcp-server/` | TypeScript/Hono server — MCP + REST API, deployed to GCP Cloud Run |
| `study-notifier/` | Electron macOS app — spaced repetition + chat-based study |
| `infra/` | Terraform — GCP Cloud Run, Cloud SQL, Artifact Registry |
| `docker-compose.yml` | Postgres 17 + pgvector (remote-mcp-server local dev only) |
| `scripts/` | `setup` (install deps), `dev` (start Electron + Vite with hot reload), `deploy` (build + push + terraform apply) |

---

## MCP Tools (remote-mcp-server/src/mcp.ts)

MCP server name: `knowledge-scribe`

### `log_knowledge(ticket_id, raw_notes, tags?, repo?)`
Embeds input → checks pgvector for semantic dups (0.88 cosine threshold) → merges with existing or formats as new → writes to `problem_logs` with embedding.

### `search_knowledge(query, n_results=3)`
Embeds query → pgvector cosine distance → returns similarity %, filename, date, and Key Insights/Solution/Pitfalls excerpts.

### `generate_study_cards()`
Reads unprocessed logs → Claude generates Q&A + concept cards → inserts into `cards` table → marks logs as processed.

### `review_pr(pr_number, owner, repo)`
Fetches PR via GitHub API (using `owner/repo`) → Claude extracts up to 3 learnable items → deduplicates → logs and auto-generates cards. Tags with `pr-review`, `pr-{pr_number}`.

---

## Running Things

```bash
./scripts/setup                    # install all deps (once per worktree)
./scripts/dev                      # Electron + Vite (uses remote server)
./scripts/dev --local-server       # Electron + Vite + local server + Postgres
```

### remote-mcp-server

```bash
cd remote-mcp-server
npm install
npm run dev                        # tsx watch (local dev, needs Postgres + env vars)
npm run build                      # tsc → dist/
```

Requires: Postgres running, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TEAM_TOKEN`

### Deploy

```bash
./scripts/deploy                   # Docker build + push + terraform apply
```

### study-notifier

```bash
cd study-notifier
npm install
npm run dev        # Vite dev + Electron (hot reload)
npm run build      # macOS .app → dist/
```

---

## Architecture

### Stack
- **Electron 31** — macOS only (arm64 + x64)
- **React 19 + TypeScript + Tailwind v4 + React Query** — renderer built with Vite
- **TypeScript + Hono + MCP SDK** — remote knowledge server (GCP Cloud Run)
- **Postgres 17 + pgvector** — all data storage and vector search (Cloud SQL in prod)
- **Terraform** — GCP infrastructure (Cloud Run, Cloud SQL, VPC, Artifact Registry)

### AI Models
- `text-embedding-3-small` (OpenAI) — 1536-dim embeddings for dedup and semantic search
- `claude-sonnet-4-6` — formatting, merging, answer evaluation, card generation (config.ts)
- `claude-haiku-4-5-20251001` — gap card suggestions (hardcoded in main.js)

### Electron Internals
- **main.js** — main process: IPC handlers, spaced repetition scheduler, AI calls, in-memory card/state cache with write-through to remote server
- **preload.js** — IPC bridge (`window.api`)
- **Renderer** — sandboxed React app, view state pushed from main.js via IPC (`use-view-state` hook)
- **Views:** PillView → CardView → CatalogView | ChatView | KnowledgeView | AnalyticsView | EditOverlay
- **Window sizes:** PILL (400x84), CARD (460x580), CATALOG (460x660), CHAT (460x580), KNOWLEDGE (560x700), ANALYTICS (460x620)

### remote-mcp-server Internals
- `src/config.ts` — model names, dedup threshold, DATABASE_URL, TEAM_TOKEN
- `src/core.ts` — embed(), slugify(), format/merge prompts
- `src/db.ts` — Postgres pool, schema init, CRUD helpers, pgvector queries
- `src/mcp.ts` — MCP server with tool registrations
- `src/routes.ts` — REST API routes (MCP tools, AI proxy, full CRUD for cards/state/sessions/settings/activity/embeddings/logs)
- `src/tools/` — tool implementations (log-knowledge, search-knowledge, generate-cards, review-pr)

### Key Behaviors
- **Spaced repetition:** SM-2 variant. Correct: `interval *= 2.5` (cap 180d). Wrong: `interval = 1`, retry in 10 min.
- **Gap cards:** Low-scoring chat sessions trigger Haiku to suggest a new card. User approves/denies with reason; feedback stored in `gap_card_feedback` for learning.
- **Auto-retire:** After `retireThreshold` (default 5) consecutive correct at max interval → retired from rotation.
- **Note combining:** Claude merges two knowledge logs, second marked as `merged_into` in Postgres.
- **Auto-tagging:** k-means (7 clusters) on card embeddings, cosine < 0.25 → "misc" bucket.
- **Delete:** Inline confirmation, 10s undo window, card data stashed in memory for restore.

---

## Data Model (Postgres)

Database: `study_notifier`. pgvector extension with HNSW cosine index on `problem_logs.embedding`.

| Table | Purpose |
|-------|---------|
| `cards` | Flashcards (id, type, front, back, tags[], when_to_use, how_it_works, example) |
| `card_state` | Spaced repetition state (interval, streak, got/miss counts, next_review, retired, flagged) |
| `card_embeddings` | OpenAI embeddings for semantic search and clustering |
| `problem_logs` | Knowledge logs (filename, date, problem, tags[], content, embedding vector(1536), merged_into, cards_generated) |
| `sessions` | Chat sessions per card (card_id, started_at, score) |
| `messages` | Chat messages (session_id, card_id, role, content, ts, score) |
| `settings` | App settings as key-value JSONB |
| `activity_log` | Daily review counts |
| `evaluation_log` | AI grading history |
| `gap_card_feedback` | Approved/denied gap card suggestions with reasons |

---

## Testing Checklist

**Auto-retire:** Set card to interval_days=180, streak=4 in Postgres → answer correctly → verify `retired=true`, card gone from sessions, visible in Catalog "Retired" filter.

**Flagging:** Session → menu → "Bad card" → verify session advances → Catalog "Flagged" filter → unflag to restore.

**Delete:** Menu → Delete → inline red confirmation (not browser dialog) → undo toast (10s) → Undo restores card.

**Gap cards:** Score poorly in chat → gap card toast appears → Approve creates card / Deny with reason stores feedback.

**Settings:** Change "Retire after" slider (3-10) → verify persists across restart.
