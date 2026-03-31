# CLAUDE.md — Knowledge Scribe Research Repo

This repo is a personal developer growth system: Claude/Cursor log insights during work sessions via MCP → embeddings index + markdown files → study cards → Electron spaced repetition app.

---

## Projects

| Directory | Purpose |
|-----------|---------|
| `knowledge-mcp/` | Python MCP server — log notes, search knowledge, generate study cards |
| `study-notifier/` | Electron macOS app — spaced repetition study sessions |
| `study-cards/` | Output directory — TSV flashcards, study state, app settings |
| `problem-logs/` | Output directory — formatted markdown knowledge logs |
| `generate_study_cards.py` | Script to convert problem-logs → TSV study cards |

---

## MCP Tools (knowledge-mcp/server.py)

MCP server name: `knowledge-scribe`

### `log_knowledge(ticket_id, raw_notes, tags?)`
Logs a knowledge entry from a work session.
- Embeds input → checks ChromaDB for semantic dups (threshold: 0.88 cosine similarity)
- If dup: merges with existing log via Claude
- If new: formats with Claude → writes markdown → indexes in ChromaDB
- Output file: `problem-logs/{YYYY-MM-DD}-{ticket_id}-{slug}.md`

**When to call:** At the end of a debugging session, after solving a non-trivial problem, or when a meaningful insight emerges. Use the ticket/task ID or a short descriptor as `ticket_id`.

### `search_knowledge(query, n_results=3)`
Semantic search over all logged knowledge.
- Embeds query → queries ChromaDB → reads full markdown → extracts Key Insights, Solution, Pitfalls sections
- Returns similarity %, filename, date, and excerpts

**When to call:** When starting work on something that may have been encountered before.

### `generate_study_cards()`
Converts unprocessed problem-logs into flashcards.
- Runs `generate_study_cards.py --new-only`
- For each new log: calls Claude → extracts Q&A cards + concept cards → appends to TSVs

**When to call:** After logging several new knowledge entries, or at end of a work session.

---

## Running Things

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

# Backfill existing logs into ChromaDB
python3 index_existing.py
```

**Requires:**
- ChromaDB running at `localhost:8000` (`chroma run --path ./chroma_db`)
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
- `main.js` — Electron main process (file I/O, IPC, spaced repetition logic, AI calls)
- `preload.js` — IPC bridge (contextBridge → window.api)
- `src/renderer/` — React app (views, components, hooks)
  - `App.tsx` — View router (switches on push-based view state from main process)
  - `views/` — PillView, CardView, CatalogView, ChatView, KnowledgeView, AnalyticsView
  - `components/` — Shell, Titlebar, SettingsPanel, MarkdownRender, etc.
  - `lib/` — types.ts, markdown.ts (marked + highlight.js), query-client.ts
  - `hooks/` — use-view-state.ts (push-based IPC view), use-annoy.ts

**Reads from:** `../study-cards/` (relative to study-notifier/)

### generate_study_cards.py

```bash
python3 generate_study_cards.py \
  --logs-dir ./problem-logs \
  --output-dir ./study-cards \
  --new-only
```

---

## Data Model

### Problem Log (problem-logs/*.md)
```markdown
---
date: 2025-03-24
type: coding
problem: <one-line problem title>
tags: ["flutter", "performance"]
---

## Problem
## Initial Observations
## Approach
## Key Insights
## Solution
## Pitfalls / What to Watch For
## Study Prompts (Q&A)
Q: ...
A: ...
---
```

### ChromaDB Entry (collection: `knowledge_logs`)
```json
{
  "id": "2025-03-24-DLE-123-flutter-rebuild",
  "embedding": [1536 floats — text-embedding-3-small],
  "document": "first 1000 chars of raw notes",
  "metadata": {
    "filename": "2025-03-24-dle-123-flutter-rebuild-issue.md",
    "ticket_id": "DLE-123",
    "date": "2025-03-24",
    "tags": "[\"flutter\", \"performance\"]"
  }
}
```

### Q&A Flashcard (study-cards/qa_cards.tsv)
```
id (UUID) \t front (question) \t back (answer) \t tags (space-separated)
```

### Concept Card (study-cards/concept_cards.tsv)
```
id (UUID) \t concept \t when_to_use \t how_it_works \t example
```

### Card Study State (study-cards/.card_state.json)
```json
{
  "<cardUUID>": {
    "interval": 20,         // days until next review
    "streak": 3,            // consecutive correct answers
    "gotCount": 3,
    "missCount": 0,
    "nextReview": 1776018470420,  // Unix ms
    "lastSeen": 1774290470420
  }
}
```

---

## Architecture Notes

- **Embeddings model:** `text-embedding-3-small` (OpenAI), 1536 dims, cosine distance
- **Dedup threshold:** 0.88 cosine similarity — above this, logs are merged rather than duplicated
- **Spaced repetition:** SM-2 variant — correct: `interval *= 2.5` (cap 180d), wrong: `interval = 1` + retry in 10 min
- **Card IDs:** UUIDs; legacy sequential IDs (`qa_0`) are migrated on first Electron load
- **Electron IPC:** main.js owns all state/files; renderer is sandboxed React app that talks via preload.js bridge
- **Renderer stack:** React 19 + TypeScript + Tailwind v4 + React Query, built with Vite
- **View state:** Push-based from main.js via IPC (`onView`); renderer subscribes in `use-view-state` hook
- **Study session size:** default 3 cards, configurable in `.settings.json`

---

## Active Usage Pattern

During a work session with Claude Code:

1. **Before starting:** `search_knowledge("topic")` to surface relevant past learnings
2. **During work:** note interesting insights mentally
3. **After solving something:** `log_knowledge(ticket_id, raw_notes, tags)` — be specific about what was confusing, what the insight was, what to watch for
4. **Periodically:** `generate_study_cards()` to convert logs into flashcards
5. **Study Notifier app:** runs in background, pops up cards every ~10-20 min
