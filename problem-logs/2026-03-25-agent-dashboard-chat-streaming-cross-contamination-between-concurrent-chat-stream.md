```markdown
---
date: 2026-03-25
type: coding
problem: Cross-contamination between concurrent chat streams in a multi-agent Electron dashboard caused blocked inputs, overwritten messages, and listener leaks.
tags: ["electron", "react", "ipc", "streaming", "state-management", "concurrency"]
---

## Problem
An agent dashboard renders multiple ChatPanel components, each with an independent chat stream over IPC. Three bugs caused panels to interfere with one another: shared streaming state blocked all panels when any one streamed, colliding stream IDs caused chunk cross-contamination and message loss, and IPC listeners accumulated without cleanup causing a memory leak.

## Initial Observations
- Streaming blocked all panels simultaneously, not just the active one — pointed immediately to state living too high in the tree.
- After moving state into each panel, message content from one panel would overwrite another — a subtler collision, not a React state issue but a logical ID uniqueness issue.
- No visible rendering bug from the listener leak; it was silent but detectable via DevTools showing dozens of duplicate IPC listeners accumulating over time.

## Approach

1. **Trace `streaming` state ownership.** Found `streaming` boolean and `streamCounterRef` in root `App`, passed as props to all `ChatPanel` instances. Moving both into each `ChatPanel` as local state made panels independently blockable.
2. **Diagnose chunk cross-contamination after step 1.** With each panel owning its own `streamCounterRef` initialized to `0`, simultaneous first messages in two panels both generated `streamId = "1"`. The IPC filter `if (chunk.streamId !== streamId) return` was ineffective since both panels shared the same ID value. Identified that per-instance refs cannot guarantee uniqueness across instances.
3. **Fix ID uniqueness at module level.** Moved the counter to `let globalStreamCounter = 0` at the module (file) scope outside the component. All `ChatPanel` instances increment the same counter, guaranteeing globally unique stream IDs regardless of instantiation order or timing.
4. **Audit IPC listener lifecycle.** Found `ipcRenderer.on('chat:chunk', wrapped)` in `preload.js` adds a permanent listener on every `onChatChunk(cb)` call with no removal path. Modified `onChatChunk` to return a cleanup function; called `remove()` inside the stream's `finish()` handler to tear down the listener when each stream completes.

## Key Insights

- **Shared counters used as unique IDs must be scoped above all instances that need uniqueness.** A `useRef` or instance variable resets per instantiation; module-level variables persist for the lifetime of the module and are shared across all component instances in that file.
- **Silent IPC listener accumulation is a common Electron leak pattern.** The streamId guard masked the functional impact, making the leak invisible in normal use — only observable via listener count inspection.
- **State ownership level should match the scope of the concern.** "Is *this* panel streaming?" is panel-scoped; "Is *any* panel streaming?" is app-scoped. Mismatching these creates either over-blocking (state too high) or collision (state too low for shared resources like IDs).

## Solution
- **Bug 1:** Move `streaming` state and `streamCounterRef` from `App` into each `ChatPanel` as local state.
- **Bug 2:** Replace per-instance `streamCounterRef` with a module-level `let globalStreamCounter = 0`; all panels increment and read from this single counter to ensure globally unique stream IDs.
- **Bug 3:** Update `preload.js` so `api.onChatChunk(cb)` returns a cleanup function (`() => ipcRenderer.removeListener('chat:chunk', wrapped)`). Call `remove()` inside `finish()` when the stream ends to prevent listener accumulation.

## Pitfalls / What to Watch For

- **Assuming `useRef` provides instance-unique values across multiple mounts.** It does — but "unique per instance" is not the same as "unique across all instances," which is what IPC stream filtering requires.
- **Trusting early-return guards as substitutes for proper cleanup.** The `streamId` check prevented incorrect rendering but did not prevent the listener count from growing unboundedly; functional correctness and resource correctness are separate concerns.
- **Fixing state locality without auditing all shared resources.** Moving `streamCounterRef` into the component solved the blocking bug but introduced the ID collision — the fix revealed a hidden assumption that the counter would be global.

## Study Prompts
Q: Why does moving a counter from a root component into individual child components risk ID collisions, and what is the correct fix?
A: Each component instance initializes its own counter starting from the same value (e.g., 0), so simultaneous first increments across instances produce identical IDs. The fix is to place the counter at module scope so all instances share and increment a single sequence, guaranteeing uniqueness across the entire module.

Q: How should IPC listeners registered inside a React component be cleaned up, and why is a streamId guard alone insufficient?
A: The listener should be removed via a cleanup function (e.g., returned from the registration call and invoked when the stream finishes or the component unmounts). A streamId guard only prevents incorrect data processing — it does not remove the listener from memory, so stale listeners continue to accumulate and fire on every subsequent event.
---
```