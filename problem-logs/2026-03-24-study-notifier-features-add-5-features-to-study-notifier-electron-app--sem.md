```markdown
---
date: 2026-03-24
type: coding
problem: Add 5 features to Study Notifier Electron app — semantic search, tag filter pills, manual tag assignment, chat-based answer evaluation, and an analytics tab
tags: ["electron", "ipc", "openai-embeddings", "semantic-search", "spaced-repetition", "canvas", "css", "anthropic-sdk"]
---

## Problem
The Study Notifier Electron app (main.js, preload.js, index.html) needed five new features built on top of the existing SM-2 flashcard system: semantic catalog search using OpenAI embeddings, multi-select tag filter pills, manual tag assignment in card view, Claude-based answer evaluation with visual scoring, and an analytics tab with a canvas bar chart and activity tracking.

## Initial Observations
- Several building blocks already existed: `openaiEmbeddings()` (used for auto-tagging), `saveQaTagsForRow()` (IPC for writing tags), and `recordAnswer()` (single source of truth for SM-2 events). Reuse was the default strategy.
- The existing `filterCatalog()` function was bound directly to an HTML `oninput` attribute, making it a rename/alias risk for any refactor.
- Semantic search introduces async latency; the UI needed a non-blocking strategy to avoid freezing on keystroke.
- Answer evaluation via LLM risks double-counting SM-2 progress if wired incorrectly to `recordAnswer()`.

## Approach

1. **Semantic search:** Reused `openaiEmbeddings()` to build a `.card_embeddings.json` store (`{model, indexed_at, embeddings: {cardId: float[]}}`). Since vectors were already normalized for k-means, cosine similarity reduces to a dot-product loop. Added 400ms debounce on search input; text results render immediately and swap silently to semantic results when available. Placed the "Index" button in the Analytics tab to avoid catalog clutter.
2. **Tag filter pills:** Built a horizontal scroll row (`overflow-x:auto` + `scrollbar-width:none`). State is a `Set()` (`activeTagFilters`); toggling membership handles multi-select. "All" pill resets the set. Tag extraction and pill rendering live inside `renderCatalog()` since full catalog data is already in scope. Introduced `applyTagFilter()` as a pure function composed with search inside `applyCatalogFilters()`. Renamed the search handler to `onCatalogSearch()` in HTML and kept `filterCatalog()` as an alias to avoid breaking other callers.
3. **Manual tag assignment:** `renderCardTags(card)` rebuilds the entire chip row on each render (simpler than incremental DOM). Input sanitizes to lowercase-hyphenated via `/[^a-z0-9-]/g → '-'`. Reused `saveQaTagsForRow()` via `cards:set-tags` IPC. Concept cards hide the tag row entirely (their `'concept'` system tag is not user-editable).
4. **Answer evaluation:** Used `claude-haiku-4-5-20251001` for speed/cost. Prompt returns `{"score":0|1|2,"feedback":"..."}`. Evaluation writes only to `eval_log` and returns the score — it does NOT call `recordAnswer()`. The user still clicks ✓/✗ to record the SM-2 event, preventing double-counting and preserving override ability. Non-suggested verdict buttons are dimmed to opacity 0.4 as a nudge; opacity resets inside `vote()` before calling `answer()`.
5. **Analytics tab:** `getAnalytics()` computes stats from in-memory `cardState` + `cards`; only additional file read is `.activity_log.json`. `trackActivity()` is called inside `recordAnswer()` so all answer paths (including evaluated ones) are captured. Canvas chart uses `devicePixelRatio` scaling for retina crispness; `ctx.roundRect()` works natively in Electron 31 (Chromium 126). Cards with no tags bucket into `'uncategorized'`; the `'concept'` system tag is filtered from category stats. Added `ANALYTICS = { w: 460, h: 620 }` to the `sizeForView()` lookup object.

## Key Insights

- **Don't block the UI for embeddings:** show text results immediately, upgrade to semantic results silently — users perceive responsiveness before accuracy.
- **Evaluation ≠ recording:** LLM scoring should be advisory only; separating `evaluate` from `recordAnswer` preserves SM-2 integrity and gives users override control.
- **Dot product = cosine similarity** when vectors are pre-normalized — no need for magnitude division, which saves compute in the similarity loop.
- **Pure filter functions compose cleanly:** keeping `applyTagFilter()` stateless makes it trivial to AND it with text/semantic search in a single `applyCatalogFilters()` pipeline.
- **`ipcMain.handle()` vs `ipcMain.on()`:** use `handle`/`invoke` for anything needing a return value; use `on`/`send` for fire-and-forget events — mixing them causes silent failures.
- **`renderCardTags()` full rebuild > incremental DOM:** for small chip lists the simplicity wins; incremental manipulation introduces subtle state-drift bugs.

## Solution

Five features shipped across main.js, preload.js, and index.html:

| Feature | Key files/APIs |
|---|---|
| Semantic search | `openaiEmbeddings()`, `.card_embeddings.json`, `cards:semantic-search` IPC handle, 400ms debounce |
| Tag filter pills | `Set() activeTagFilters`, `applyTagFilter()`, `applyCatalogFilters()`, CSS scroll row |
| Manual tag assignment | `renderCardTags()`, `cards:set-tags` IPC, lowercase-hyphen sanitizer |
| Answer evaluation | `claude-haiku-4-5-20251001`, JSON score prompt, `eval_log`, opacity nudge on verdict buttons |
| Analytics tab | `getAnalytics()`, `trackActivity()` in `recordAnswer()`, HiDPI canvas chart, `ANALYTICS` size constant |

IPC pattern enforced throughout: `handle`/`invoke` for request-response, `on`/`send` for fire-and-forget. All new handlers registered in a labeled section after existing ones.

## Pitfalls / What to Watch For

- **`filterCatalog()` rename risk:** it was bound via `oninput` in HTML — renaming without keeping the alias breaks the attribute silently; always audit HTML event attributes before refactoring handler names.
- **Double-counting SM-2 events:** wiring `evaluate` directly to `recordAnswer()` would corrupt spaced-repetition scheduling; evaluation and recording must remain separate code paths.
- **Concept card tag row:** must be explicitly hidden — concept cards use `'concept'` as a system tag, and exposing the tag input would let users corrupt that invariant.
- **Canvas blurriness on retina:** forgetting `devicePixelRatio` scaling produces blurry charts on HiDPI screens; always set `canvas.width = W * dpr`, `ctx.scale(dpr, dpr)`, `canvas.style.width = W + 'px'`.
- **`'concept'` tag leaking into analytics categories:** system tags must be explicitly filtered before bucketing or they pollute category stats with meaningless entries.
- **Missing embeddings file / missing API key:** semantic search must gracefully fall back to text search rather than throwing or showing an empty result set.
- **Stale opacity on verdict buttons:** opacity set during evaluation persists to the next card unless explicitly reset inside `vote()` before calling `answer()`.

## Study Prompts

Q: Why does the answer evaluator write to `eval_log` instead of calling `recordAnswer()`, and what would break if it did call `recordAnswer()`?
A: Calling `recordAnswer()` would update SM-2 scheduling immediately on evaluation, before the user confirms their answer. This double-counts the event (once on evaluate, once on ✓/✗ click), corrupts the repetition interval, and removes the user's ability to override the AI's verdict. Keeping evaluation advisory and letting the user's click be the sole trigger for `recordAnswer()` preserves SM-2 integrity and user agency.

Q: