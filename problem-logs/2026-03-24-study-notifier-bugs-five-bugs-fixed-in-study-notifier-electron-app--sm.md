```markdown
---
date: 2026-03-24
type: coding
problem: Five bugs fixed in Study Notifier Electron app — SM-2 scheduling, session UX, CSS vibrancy, build deployment, and ChromaDB stale reference
tags: ["electron", "spaced-repetition", "debugging", "sm2", "macos", "chromadb", "mcp"]
---

## Problem
The Study Notifier Electron spaced repetition app had five distinct bugs: (1) SM-2 cards repeating even after correct answers due to session padding, (2) app auto-closing after manually-answered sessions, (3) vibrancy blur bleeding outside pill rounded corners, (4) build output never updating the installed app, and (5) an MCP server crashing with stale ChromaDB collection references after restarts.

## Initial Observations
- Cards were reappearing too soon, suggesting the scheduling algorithm was being bypassed rather than broken.
- App closing on manual sessions suggested a missing distinction between notification-triggered and user-triggered sessions — the same code path was handling both.
- Vibrancy artifact was visible outside the pill shape, suggesting the clipping container lacked a matching border-radius.
- Build artifacts existed in `dist/mac-arm64/` but the running app in `~/Applications/` was never refreshed — a deployment gap, not a code bug.
- ChromaDB failures were intermittent and tied to app restarts, pointing to a stale cached object rather than a logic error.

## Approach

1. **Bug 1 (SM-2 padding):** Traced `buildSessionQueue()` — it called `pickCard()` n times unconditionally. Identified that `pickCard()` had a random fallback that returned non-due cards when no due cards existed. Added `dutyOnly=true` parameter to return `null` instead; `buildSessionQueue()` now stops filling when `null` is returned, allowing sessions shorter than `cardsPerSession`.
2. **Bug 2 (auto-close):** Traced the answer IPC handler — `hideWindow()` was called unconditionally on session end. Identified that session initiation source was never recorded. Added `notificationSession` boolean flag, set at session start by the initiating code path, checked at session end to branch between `hideWindow()` and `showCatalog()`.
3. **Bug 3 (pill border-radius):** Inspected the DOM — `#shell` had `position:fixed;inset:0;overflow:hidden` but no `border-radius`, so vibrancy blur extended to the rectangular window bounds. Added mode-scoped CSS rules to apply matching border-radius to `#shell` in both `pill-mode` and `card-mode`.
4. **Bug 4 (build deployment):** Identified that `npm run build` only populated `dist/mac-arm64/` and no step copied it to `~/Applications/`. Extended the build script to `rm -rf` the old `.app` bundle and `cp -R` the new one after every build.
5. **Bug 5 (stale ChromaDB):** Identified that `collection` was a module-level singleton initialized once at import time. When ChromaDB restarted, the cached object held an invalidated UUID. Replaced the singleton with a `get_collection()` function that calls `get_or_create_collection()` on every invocation; all tool functions now call `get_collection()` fresh each time.

## Key Insights

- **Padding sessions defeats spaced repetition.** The entire value of SM-2 is in respecting the schedule; silently filling sessions with non-due cards masks the problem while corrupting the algorithm's effect.
- **Record intent at the source, not the destination.** Inferring how a session was initiated at session-end is fragile; a flag set at initiation is explicit and survives any intermediate code changes.
- **`overflow:hidden` clips content but does not clip composited effects like vibrancy.** The container holding the effect must also carry the matching `border-radius` for visual clipping to work correctly.
- **Build scripts should be complete deployment pipelines.** A build step that stops at artifact generation silently allows stale installed copies to persist — auto-copy should be the default.
- **Module-level singletons for external service handles break on service restarts.** Always re-fetch handles from the service rather than caching objects that embed ephemeral IDs.

## Solution

- **Bug 1:** Added `dutyOnly=true` to `pickCard()`; `buildSessionQueue()` stops at `null` — sessions are now correctly variable-length.
- **Bug 2:** Added `notificationSession` boolean flag set by the initiating handler; session-end logic branches on this flag: `hideWindow()` vs `showCatalog()`.
- **Bug 3:** Added CSS rules `body.pill-mode #shell { border-radius: var(--r-pill) }` and `body.card-mode #shell { border-radius: var(--r-card) }`.
- **Bug 4:** Extended build script: `rm -rf ~/Applications/Study\ Notifier.app && cp -R dist/mac-arm64/Study\ Notifier.app ~/Applications/`.
- **Bug 5:** Replaced module-level `collection` singleton with `get_collection()` function calling `get_or_create_collection()` on every invocation.

## Pitfalls / What to Watch For

- **Assuming `cardsPerSession` must always be filled.** The natural instinct is to treat a short session as a bug; in SM-2 it is correct behavior when no cards are due.
- **Trying to infer session origin at session-end.** Any approach that reconstructs intent from context (e.g., checking window state or caller stack) is brittle — the flag pattern is the right model.
- **Assuming `overflow:hidden` clips all rendering including compositor-level effects.** Vibrancy/blur is composited outside normal paint clipping; `border-radius` must be explicit on the container.
- **Trusting that rebuilding is enough.** Developers accustomed to in-place build targets may not notice that Electron builds require explicit installation step to update the running copy.
- **Assuming a cached service handle remains valid across service restarts.** Any object embedding a server-assigned ID (UUID, session token, etc.) must be treated as ephemeral and re-acquired after any possible service restart.

## Study Prompts
Q: Why can sessions be shorter than `cardsPerSession` in correct SM-2 behavior, and what does padding with non-due cards do to the algorithm?
A: SM-2 schedules cards for specific future dates; if fewer cards are due than `cardsPerSession`, the correct response is a short session. Padding with non-due cards forces early reviews, compressing intervals and undermining the forgetting-curve-based spacing that makes the algorithm effective.

Q: Why is a session-initiation flag cleaner than inferring post-session behavior from context at session-end?
A: Intent is unambiguous at initiation and may be impossible to reconstruct reliably at session-end as code evolves. A flag captures the "why" explicitly and keeps the session-end handler simple and stable regardless of how many initiation paths are added later.

Q: Why does `overflow:hidden` on a container not clip macOS vibrancy blur, and what is the correct fix?
A: Vibrancy/blur is a compositor-level effect rendered outside the normal paint/layout pipeline, so CSS `overflow:hidden` does not constrain it. The fix is to apply a matching `border-radius` to the container so the compositor clips the effect to the rounded shape.

Q: Why does a module-level ChromaDB collection singleton fail after a service restart, and what is the correct pattern?
A: The singleton captures the collection's UUID at import time; after a restart ChromaDB assigns a new UUID, making the cached object's reference invalid. The correct pattern is to call `get_or_create_collection()` on every use, letting ChromaDB resolve the current valid handle each time.
---
```