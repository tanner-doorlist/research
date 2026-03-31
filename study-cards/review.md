# Study Card Review
_Generated 2026-03-24_

---

## 2026-03-24-knowledge-scribe-setup-mcp-server-for-knowledge-scribe-not-connecting-to-

### Q&A Cards

**Q:** You run `claude mcp add knowledge-scribe` and the command exits without errors. When you open Claude Code, the server is nowhere in `claude mcp list`. What is the most likely cause, and how would you confirm it?

**A:** The default scope is `local`, which writes the entry under a directory-specific key inside `~/.claude.json` rather than the top-level `mcpServers` key. The server is only visible when Claude Code is opened from that exact working directory. Confirm by inspecting `~/.claude.json` directly — if the entry is nested under a path key instead of at the top level, that is the problem. Fix with `claude mcp add -s user` to write to the global scope.

**Q:** You need to pass a long API key as an `-e` flag to `claude mcp add`, but the command behaves erratically — the server name seems to be misread and arguments are misassigned. What is the underlying cause and what is the safer alternative?

**A:** Long values with special characters (common in API keys) can break CLI argument parsing, causing the parser to misinterpret the server name or other flags as part of the variadic argument list. The safer alternative is to bypass the CLI entirely and directly edit `~/.claude.json`, placing the key in the `env` object. This avoids all shell escaping ambiguity and makes the config auditable.

**Q:** After editing `~/.claude.json` to add an MCP server, the server appears registered via `claude mcp list` but all tool calls fail at runtime. What independent failure mode should you investigate?

**A:** MCP server registration and the server's runtime dependencies are separate concerns. In this case, the `knowledge-mcp` server requires ChromaDB running at `localhost:8000`. Even if the server process launches successfully, it will be non-functional if ChromaDB is not running. Check that all backing services the server depends on are started before the session begins.

**Q:** A teammate reports that after running `sudo claude mcp add -s user`, their MCP server config is written successfully but Claude Code never sees it. Explain exactly why this happens on macOS.

**A:** `sudo` elevates to root, which changes the effective home directory from `~/` (the user's home) to `/var/root` (root's home). The config is therefore written to `/var/root/.claude.json`, not `~/.claude.json`. Claude Code runs as the user and reads from the user's home directory, so the entry is silently ignored. The fix is to run `claude mcp add` without `sudo` and edit `~/.claude.json` directly if elevated permissions are truly needed for another reason.

**Q:** What is the structural difference between `~/.claude.json` and `~/.claude/settings.json` in Claude Code, and what happens if you place `mcpServers` in the wrong file?

**A:** `~/.claude.json` is the top-level user config file and is the only location where `mcpServers` is recognized. `~/.claude/settings.json` is a separate file with a distinct schema (used for other Claude Code settings); Claude Code validates it strictly and does not look for `mcpServers` there. Placing the `mcpServers` block in `settings.json` silently fails — no error is raised, but the servers never appear.

**Q:** You correctly add an MCP server by directly editing `~/.claude.json` while Claude Code is already open. The server still does not appear. What did you miss?

**A:** Claude Code reads `~/.claude.json` at startup and does not hot-reload it. Changes made while the application is running are ignored until Claude Code is fully restarted. Always close and reopen Claude Code after editing `~/.claude.json`, then verify with `claude mcp list`.

### Concept Cards

**Silent Config Mislocation**

- *When to use:* When a tool or service appears correctly configured but the expected behavior never materializes and no error is emitted.
- *How it works:* Many applications load config from one canonical location and simply ignore all others without warning. If the config is written to a plausible-but-wrong path — due to naming confusion, scope mismatches, or privilege escalation — the application proceeds as if unconfigured. The diagnostic move is to inspect what file is actually being written versus what file the application actually reads, treating them as independent questions.
- *Example:* Claude Code reads `mcpServers` only from `~/.claude.json`. Writing the same key to `~/.claude/settings.json` or having `sudo` redirect the write to `/var/root/.claude.json` both produce silent failures with no error output.

**Scope as a Hidden Binding**

- *When to use:* When a registration or configuration command succeeds but the registered item is only visible or active in some contexts and not others.
- *How it works:* Some CLI tools support multiple scopes (e.g., local vs. user vs. system) and default to the narrowest one. The binding is encoded in where the data is written, not in whether the command succeeded. Because the command exits cleanly regardless of scope, the mismatch is invisible until you encounter a context where the narrower binding does not apply. Always verify scope explicitly, especially for tools you intend to use globally.
- *Example:* `claude mcp add` defaults to `local` scope, writing the server entry under a directory-specific key in `~/.claude.json`. The server appears in `claude mcp list` only when Claude Code is opened from that directory. Adding `-s user` writes to the top-level key and makes the server available everywhere.

**CLI Bypass for Fragile Argument Parsing**

- *When to use:* When a CLI command misbehaves with long, complex, or special-character values in flags, producing cryptic errors unrelated to the actual intent.
- *How it works:* CLI argument parsers often have undocumented edge cases around escaping, quoting, and variadic argument boundaries. When the value itself (not the logic) is causing parse failures, the CLI layer is the problem — not your intent. Editing the underlying config file directly removes the shell and parser as variables entirely, produces a human-readable and auditable result, and is often more reliable for structured data like JSON.
- *Example:* Passing a long API key via `-e OPENAI_API_KEY=sk-...` to `claude mcp add` caused the parser to misread the server name. Directly editing the `env` block in `~/.claude.json` bypassed the issue completely.

**Registration vs. Runtime as Independent Failure Modes**

- *When to use:* When a service or plugin is correctly registered and appears active but produces errors or no output when actually invoked.
- *How it works:* Registration proves that a system knows where to find a component; it says nothing about whether that component can do its job. Runtime failures — missing dependencies, unreachable services, bad credentials — are orthogonal to registration. Debugging requires confirming both layers independently: first that the component is registered correctly, then that everything it depends on at runtime is available and healthy.
- *Example:* The `knowledge-mcp` MCP server was correctly registered in `~/.claude.json` and appeared in `claude mcp list`, but all tool calls failed because ChromaDB was not running at `localhost:8000`. Fixing the registration had no effect on the runtime dependency.


---

## 2026-03-24-study-notifier-bugs-five-bugs-fixed-in-study-notifier-electron-app--sm

### Q&A Cards

**Q:** A spaced repetition app shows cards repeating sooner than expected. The scheduling algorithm looks correct. What else should you check, and what symptom would confirm the real cause?

**A:** Check whether the session-building code pads sessions with non-due cards when fewer due cards exist than the target session size. The confirming symptom is that cards reappear correctly after their intervals when you remove the padding — meaning the algorithm was never broken, only bypassed. The fix is to let pickCard() return null when no due cards remain and stop filling the queue at that point.

**Q:** An Electron app auto-closes after a manually-triggered review session but should instead return to the catalog. The session-end handler looks identical for both session types. What is the diagnostic question, and what is the correct fix?

**A:** The diagnostic question is: does the session-end handler know how the session was initiated? If not, it cannot branch correctly. The fix is to record intent at the source — set a boolean flag (e.g., notificationSession) when the session starts, then branch at session-end on that flag: hideWindow() for notification-triggered sessions, showCatalog() for manual ones. Inferring origin from context at session-end is fragile and breaks as code evolves.

**Q:** A macOS Electron app has a pill-shaped window with vibrancy blur, but the blur visibly bleeds outside the rounded corners. The container already has overflow:hidden. Why is the blur still leaking, and what is the correct fix?

**A:** Vibrancy/blur is a compositor-level effect rendered outside the normal CSS paint and layout pipeline, so overflow:hidden does not constrain it. The fix is to apply a matching border-radius to the container element (#shell in this case) — the compositor uses border-radius to clip the effect to the correct rounded shape. CSS clipping properties only affect normal paint; composited effects require explicit geometric constraints.

**Q:** A developer runs npm run build successfully but the installed Electron app shows no changes. The build artifacts exist in dist/mac-arm64/. What is the bug category, and what should the build script do to prevent this silently happening again?

**A:** This is a deployment gap, not a code bug — the build pipeline stops at artifact generation and never updates the installed copy. The fix is to extend the build script to remove the old bundle (rm -rf ~/Applications/Study Notifier.app) and copy the new one (cp -R dist/mac-arm64/Study Notifier.app ~/Applications/) after every build. Build scripts should be complete deployment pipelines by default; stopping at artifact generation silently allows stale installed copies to persist.

**Q:** An MCP server crashes intermittently with invalid ChromaDB collection references, but only after the ChromaDB service restarts. The collection object is initialized once at module import. What is the root cause and the correct architectural fix?

**A:** The root cause is that the module-level singleton captures the collection's UUID at import time. When ChromaDB restarts it assigns a new UUID, making the cached object's reference stale and invalid. The fix is to replace the singleton with a get_collection() function that calls get_or_create_collection() on every invocation, letting ChromaDB resolve the current valid handle each time. Any object embedding a server-assigned ephemeral ID must be re-acquired after any possible service restart rather than cached across the module lifetime.

**Q:** In SM-2, a session produces only 2 cards when cardsPerSession is set to 10. A teammate reports this as a bug. Is it? How do you reason through whether a short session is correct or broken behavior?

**A:** It is correct behavior if only 2 cards are due. SM-2 schedules cards for specific future dates; if fewer cards are due than cardsPerSession, the right response is a short session — padding with non-due cards would force early reviews, compress intervals, and undermine the forgetting-curve-based spacing that makes the algorithm effective. The diagnostic question is: are the 2 cards actually due today? If yes, the session is correct. Treating a short session as a bug is the pitfall; the session length should be driven entirely by the schedule.

### Concept Cards

**Record Intent at the Source**

- *When to use:* Whenever a downstream handler must behave differently depending on how or why an upstream action was initiated.
- *How it works:* At the point where an action is triggered, explicitly capture the intent or origin in a flag or context object. Pass or store that context so the downstream handler can read it directly rather than trying to reconstruct it from ambient state. This keeps downstream logic simple, explicit, and stable as new initiation paths are added over time.
- *Example:* In the Study Notifier app, a notificationSession boolean was set true when a notification triggered a session and false when the user triggered it manually. The session-end handler read this flag to decide between hideWindow() and showCatalog() — no fragile inference from window state or call stack required.

**Compositor-Level Effects Escape CSS Clipping**

- *When to use:* When applying rounded corners, masks, or clip paths to containers that host GPU-composited visual effects such as blur, vibrancy, backdrop-filter, or shadow layers.
- *How it works:* CSS properties like overflow:hidden and clip-path operate on the normal paint and layout pipeline. Compositor-level effects (blur, vibrancy, backdrop-filter) are rendered on the GPU outside that pipeline and are not constrained by CSS clipping. To clip a composited effect to a shape, that shape's geometric property — border-radius being the most common — must be applied directly to the element hosting the effect so the compositor uses it as a clipping boundary.
- *Example:* The Study Notifier pill window had overflow:hidden on its container but vibrancy blur still bled outside the rounded corners. Adding border-radius: var(--r-pill) to the #shell container caused the compositor to clip the vibrancy effect to the correct pill shape.

**Re-Acquire Ephemeral Service Handles on Every Use**

- *When to use:* When your code holds a reference to an object obtained from an external service that embeds a server-assigned ephemeral identifier such as a UUID, session token, or connection handle.
- *How it works:* External services often assign internal identifiers (UUIDs, tokens) to objects at creation time. If the service restarts or resets state, those identifiers become invalid while your cached object still holds the old value. Instead of caching the resolved handle at module load or initialization, wrap retrieval in a function that calls the service's lookup or creation API on every use, so you always receive a currently valid reference.
- *Example:* The ChromaDB MCP server cached the collection object at import time. After a ChromaDB restart the stored UUID was invalid, causing crashes. Replacing the singleton with a get_collection() function that calls get_or_create_collection() on every invocation eliminated the stale-reference failures entirely.

**Build Scripts as Complete Deployment Pipelines**

- *When to use:* Whenever a build process produces artifacts that must replace a previously installed or running copy of the software, especially for packaged desktop or native applications.
- *How it works:* A build step that stops at artifact generation creates a silent gap: the developer sees a successful build but the running copy remains stale. The build script should be treated as a full deployment pipeline — it must remove the old installed copy and replace it with the newly built artifact as part of the same invocation. This makes 'build' and 'deploy locally' a single atomic operation and eliminates an entire class of 'my changes aren't showing up' confusion.
- *Example:* The Study Notifier build script only populated dist/mac-arm64/ and never updated ~/Applications/. Extending it with rm -rf and cp -R after every build ensured the installed app always matched the latest build output.


---

## 2026-03-24-knowledge-scribe-architecture-document-the-end-to-end-architecture-of-the-knowle

### Q&A Cards

**Q:** Why does the Python MCP server call `get_collection()` fresh on every tool invocation instead of caching it at startup?

**A:** A cached collection object holds the collection's UUID at the time it was fetched. If ChromaDB restarts, that UUID becomes stale and all subsequent calls using the cached object fail silently or with a UUID error. Calling `get_collection()` fresh on every invocation guarantees a valid handle regardless of how many times ChromaDB has restarted since the server launched.

**Q:** A developer deletes the `chroma_db/` directory to 'reset' the knowledge system. What actually breaks, and what is completely unaffected?

**A:** Breaks: semantic search (no embedding index) and dedup checking on new log ingestion. Unaffected: all markdown files in `problem-logs/`, all study cards in `study-cards/*.tsv`, and the `.processed_logs.json` processed-file registry. The two stores are intentionally decoupled — ChromaDB holds only embeddings and metadata, not the source of truth for cards or logs.

**Q:** Trace the full call chain when the Electron renderer triggers a knowledge search query.

**A:** Renderer sends an IPC message → `main.js` IPC handler receives it → spawns `python3 cli.py search <query>` as a subprocess → `cli.py` instantiates `chromadb.HttpClient` and calls the search tool → ChromaDB HTTP server performs cosine similarity search → results (including filename metadata) returned to `cli.py` → full markdown fetched from disk via filename → results written to stdout → `main.js` reads stdout → IPC reply sent back to renderer. The Electron app never calls ChromaDB directly.

**Q:** You log a new knowledge entry with `log_knowledge()`. When will a study card appear in the Electron review UI from that entry, and what must happen in between?

**A:** Nothing is automatic. Three manual steps must occur in sequence: (1) `log_knowledge()` formats the note with Claude, writes markdown to `problem-logs/`, and indexes an embedding in ChromaDB. (2) A developer explicitly invokes `generate_study_cards()`, which runs `generate_study_cards.py --new-only`, reads unprocessed markdown files, calls Claude to extract Q&A and concept cards, appends them to the TSV files, and marks the files processed in `.processed_logs.json`. (3) The Electron app reads the TSV files directly. No step triggers the next automatically.

**Q:** ChromaDB is described as serving 'two roles only' in this system. What are they, and what roles does it explicitly NOT serve?

**A:** ChromaDB's two roles: (1) dedup checking at ingest — querying for near-duplicate embeddings before storing a new log entry; (2) semantic search — embedding a query and returning cosine-similar results for the knowledge browser. It does NOT generate, store, or serve study cards; it does NOT power study sessions; it does NOT hold the canonical text of logs (only the first 1000 chars as metadata). Cards and study sessions run entirely on markdown and TSV files.

**Q:** What is the ChromaDB process lifecycle in this system — how does it start, how is double-spawning prevented, and how does it shut down?

**A:** Start: Electron's `main.js` calls `startChroma()` on app launch, which first sends a heartbeat request to `localhost:8000/api/v2/heartbeat`. If a response is received, ChromaDB is already running and spawn is skipped. Otherwise, `chroma run` is spawned as a child process. Shutdown: the process is killed on Electron's `before-quit` event. Persistence: data lives on disk at `knowledge-mcp/chroma_db/` (SQLite + HNSW index), so restarts do not lose data.

### Concept Cards

**Defensive Handle Refresh — Never Cache Distributed Resource Handles**

- *When to use:* Any time your code holds a reference to a resource in a separate process (database connection, collection object, session token) that can restart or expire independently of your process.
- *How it works:* Instead of caching a handle at startup and reusing it, re-fetch the handle on every operation. This costs a small overhead per call but eliminates an entire class of stale-reference failures where the remote resource has restarted and invalidated the old handle's internal identifiers. The pattern trades a minor performance cost for strong correctness guarantees across restarts.
- *Example:* The Python MCP server calls `get_collection()` on every tool invocation rather than caching the collection object at startup. If ChromaDB restarts, the cached UUID would be stale and all calls would fail; re-fetching guarantees a valid handle every time.

**Intentional Store Decoupling — Separate Indices Serve Separate Access Patterns**

- *When to use:* When a system has multiple consumers with fundamentally different access patterns (e.g., semantic search vs. sequential review), and coupling them to a single store would create fragile dependencies or unnecessary complexity.
- *How it works:* Rather than making one store the source of truth for everything, assign each store exactly the data it needs for its specific access pattern. The stores share an upstream source (raw files) but are populated independently and can fail or be deleted independently. This means losing one store only breaks the features it directly powers, not the whole system.
- *Example:* `chroma_db/` holds embeddings and first-1000-char previews for semantic search; `study-cards/*.tsv` holds full Claude-generated cards for the review UI. Both derive from the same markdown files but are otherwise independent — deleting ChromaDB does not affect card review, and regenerating cards does not require ChromaDB to be healthy.

**Thin Shell / Subprocess Delegation — Keeping Runtime Dependencies Isolated**

- *When to use:* When a frontend or orchestration layer needs to invoke functionality that carries heavy or language-specific dependencies you want to keep out of the host process's runtime.
- *How it works:* The host process (e.g., an Electron app) spawns the dependency-heavy component as a subprocess and communicates via stdin/stdout or IPC rather than importing it directly. This keeps the dependency entirely in the subprocess's runtime, prevents version conflicts, and means the host can restart or replace the subprocess without modifying its own code. The tradeoff is subprocess spawning overhead and the need to serialize data across the boundary.
- *Example:* The Electron app never imports or calls ChromaDB directly. When a search is needed, `main.js` spawns `python3 cli.py search <query>`, reads the results from stdout, and relays them to the renderer — keeping the entire ChromaDB dependency inside Python land.

**Heartbeat Guard — Idempotent Process Spawning via Liveness Check**

- *When to use:* When your application needs to ensure a background service is running at startup, but blindly spawning it would cause conflicts if it is already running from a previous session or another process.
- *How it works:* Before spawning, send a cheap liveness probe (e.g., an HTTP heartbeat request) to the service's known address. If a valid response is received, skip spawning and attach to the existing instance. If no response is received, proceed with spawning. This makes the startup routine idempotent — safe to call repeatedly without creating duplicate processes or port conflicts.
- *Example:* `startChroma()` in `main.js` checks `localhost:8000/api/v2/heartbeat` before running `chroma run`. If ChromaDB is already up (e.g., left running from a previous dev session), the spawn is skipped entirely, preventing a port conflict or a second dangling process.


---

## 2026-03-24-study-notifier-features-add-5-features-to-study-notifier-electron-app--sem

### Q&A Cards

**Q:** Semantic search introduces async latency on every keystroke. What two-phase UX strategy was used to keep the catalog feeling responsive, and why does it work perceptually?

**A:** Show text-match results immediately on each keystroke, then silently swap in semantic results once the embedding lookup resolves. A 400ms debounce limits how often the async call fires. It works because users perceive responsiveness before they notice accuracy — seeing any result instantly feels faster than waiting for the 'best' result.

**Q:** You want to add LLM-based answer scoring to a spaced-repetition app. A teammate suggests calling recordAnswer() inside the evaluator so the score is saved right away. What is the specific failure mode, and how should it be structured instead?

**A:** Calling recordAnswer() inside the evaluator double-counts the SM-2 event: once when the LLM evaluates and again when the user clicks ✓/✗. This corrupts the repetition interval and removes the user's ability to override the AI verdict. The evaluator should write only to an eval_log and return a score; the user's explicit click remains the sole trigger for recordAnswer(), keeping evaluation advisory and SM-2 integrity intact.

**Q:** Before renaming a JavaScript event handler function, what specific risk must you audit, and what technique was used here to mitigate it?

**A:** HTML event attributes (e.g., oninput='filterCatalog()') reference function names as strings, so renaming the function silently breaks the binding — no error is thrown. The mitigation is to keep the old name as an alias (e.g., const filterCatalog = onCatalogSearch) so existing HTML attributes continue to work while new code uses the cleaner name.

**Q:** What is the correct Electron IPC pattern to use when the renderer needs a return value from the main process, versus when it only needs to fire an event? What breaks if you mix them?

**A:** Use ipcMain.handle() in main and ipcRenderer.invoke() in the renderer for any call that needs a return value (request-response). Use ipcMain.on() and webContents.send() / ipcRenderer.send() for fire-and-forget events. Mixing them causes silent failures: invoke() on an on() handler returns undefined with no error thrown, and send() to a handle() handler is simply ignored.

**Q:** How must a HiDPI (retina) canvas be set up to avoid blurry chart rendering, and what are the three specific steps required?

**A:** 1) Read window.devicePixelRatio (dpr). 2) Set the canvas pixel dimensions to the logical size multiplied by dpr (e.g., canvas.width = W * dpr). 3) Call ctx.scale(dpr, dpr) so drawing commands use logical coordinates, then set canvas.style.width and canvas.style.height to the original logical size in CSS pixels. Skipping any step produces blurry output on retina screens.

**Q:** The analytics tab buckets cards by tag category. What two data-hygiene steps are required before bucketing, and what symptom appears if each is skipped?

**A:** 1) Filter out the 'concept' system tag before bucketing — skipping this pollutes category stats with a meaningless 'concept' entry that inflates counts for non-user-defined categories. 2) Assign cards with no tags to an 'uncategorized' bucket — skipping this silently drops those cards from all category stats, making totals not add up to the full card count.

### Concept Cards

**Progressive Result Upgrading (Show Fast, Improve Silently)**

- *When to use:* Any async operation that improves result quality but introduces latency, where users need immediate feedback.
- *How it works:* Render a lower-fidelity result synchronously so the UI feels instantly responsive, then replace it with the higher-quality async result when it arrives — without any visible loading state. This separates perceived responsiveness from actual accuracy. A debounce limits how frequently the expensive async call is triggered.
- *Example:* Catalog search shows text-match results on every keystroke and silently upgrades to embedding-based semantic results once the OpenAI call resolves, with a 400ms debounce to throttle API calls.

**Advisory Evaluation vs. Authoritative Recording**

- *When to use:* When an automated system (LLM, rule engine, heuristic) can assess user input but the downstream state machine (e.g., spaced-repetition, progress tracking) must not be corrupted by false positives.
- *How it works:* Separate the evaluation path from the recording path entirely. The evaluator writes to its own log and returns a score as a suggestion. Only an explicit, deliberate user action triggers the authoritative state update. This preserves user override ability and prevents double-counting when both paths would otherwise converge on the same state mutation.
- *Example:* The Claude-based answer evaluator writes to eval_log and returns a score with opacity nudges on verdict buttons, but never calls recordAnswer(). The user's ✓/✗ click remains the sole trigger for SM-2 scheduling updates.

**Dot Product as Cosine Similarity for Pre-Normalized Vectors**

- *When to use:* Computing similarity between embedding vectors that were already L2-normalized during generation or a prior processing step.
- *How it works:* Cosine similarity is defined as the dot product divided by the product of the two vector magnitudes. When both vectors are unit vectors (magnitude = 1), the denominator is always 1, so the similarity reduces to a plain dot product loop. This eliminates magnitude division on every pair comparison, reducing compute proportionally to vector dimensionality.
- *Example:* OpenAI embeddings were already normalized for k-means clustering, so the semantic search similarity loop computes only a dot product rather than full cosine similarity, avoiding redundant magnitude calculations.

**Full Rebuild Over Incremental DOM for Small, Stateful UI Components**

- *When to use:* Rendering small lists or chip rows (tags, pills, badges) that are regenerated from a single source-of-truth object on every relevant state change.
- *How it works:* Rather than tracking which DOM nodes need to be added, removed, or updated, clear the container and rebuild it entirely from the current data on each render. For small element counts the performance cost is negligible, and the approach eliminates an entire class of state-drift bugs where the DOM diverges from the underlying data model.
- *Example:* renderCardTags(card) clears and rebuilds the entire chip row on every call rather than diffing existing chips against the new tag array, avoiding subtle bugs where removed tags linger in the DOM.


---

## 2026-03-25-agent-dashboard-chat-streaming-cross-contamination-between-concurrent-chat-stream

### Q&A Cards

**Q:** All ChatPanel components block simultaneously when any one of them starts streaming. What does this symptom tell you about where the streaming state lives, and what is the fix?

**A:** Simultaneous blocking across all panels means the state controlling 'is streaming?' is shared by all panels — it lives too high in the component tree, likely in a root or parent component. The fix is to move the streaming state into each ChatPanel as local state, so each panel's blocked/unblocked status is independent of every other panel.

**Q:** After moving streamCounterRef into each ChatPanel as a local ref, messages from one panel overwrite another. Why does this happen even though each panel now has its own ref?

**A:** Each component instance initializes its own ref starting from the same value (0), so the first stream in Panel A and the first stream in Panel B both generate streamId = '1'. The IPC chunk filter compares against this ID, so both panels accept each other's chunks. Per-instance refs guarantee uniqueness within a single instance's lifetime, not across all instances simultaneously.

**Q:** What is the correct way to ensure stream IDs are unique across all simultaneously mounted ChatPanel instances, and why does useRef fail to provide this?

**A:** Place the counter at module scope (e.g., `let globalStreamCounter = 0` outside the component function). All instances of the component share and increment this single counter, so each stream gets a genuinely unique ID regardless of how many panels exist or when they are mounted. useRef fails because it is initialized per component instantiation — every new mount resets the ref to its initial value, meaning concurrent mounts can produce identical IDs.

**Q:** A streamId guard (`if (chunk.streamId !== streamId) return`) prevents wrong data from rendering, yet there is still a serious resource bug. What is it, and how do you detect it?

**A:** Each call to onChatChunk registers a new IPC listener but never removes it. The streamId guard makes the stale listeners functionally harmless — they early-return on every event — but they remain in memory and fire on every subsequent chunk. The bug is detectable by inspecting listener counts in DevTools or Electron's ipcRenderer; you will see dozens of duplicate listeners accumulating over time. Functional correctness and resource correctness are separate concerns.

**Q:** What change to the onChatChunk API in preload.js is needed to support proper listener cleanup, and at what point in the stream lifecycle should cleanup be triggered?

**A:** Modify onChatChunk to return a cleanup function: `() => ipcRenderer.removeListener('chat:chunk', wrapped)`. The caller stores this function and invokes it inside the stream's finish() handler — the moment the stream ends and the listener is no longer needed. This ensures exactly one listener is active per in-flight stream and is removed as soon as that stream completes.

**Q:** When fixing a bug by moving shared state down into child components, what hidden assumption should you immediately audit in any resources that moved with it?

**A:** Audit whether any resource that moved (such as a counter, ID generator, or shared reference) was implicitly relying on being singular and global. Moving it into each component instance makes it per-instance, which may break any logic that depended on uniqueness or continuity across all instances. In this case, moving streamCounterRef into each ChatPanel solved the blocking bug but introduced ID collisions because the counter had been silently serving as a global unique-ID source.

### Concept Cards

**State Ownership Level Matching Concern Scope**

- *When to use:* When deciding where in a component hierarchy to place a piece of state, especially when multiple sibling components interact with a shared resource.
- *How it works:* Ask: what is the scope of the question this state answers? If the question is 'Is this specific component active?', the state belongs inside that component. If the question is 'Is any component in this group active?', it belongs in a shared ancestor. Mismatching creates either over-blocking (state too high, all instances affected by one) or collision (state too low, per-instance values conflict where global uniqueness is required).
- *Example:* The 'streaming' boolean belonged inside each ChatPanel because it answered 'Is this panel streaming?' Moving it from App into each panel let panels stream independently. But the stream ID counter could not follow it into the component because it answered an implicitly global question: 'What is the next unique ID across all panels?'

**Module-Scope Variables as Cross-Instance Singletons**

- *When to use:* When multiple instances of the same component need to share a single, persistent, incrementing resource such as a unique ID counter, a registry, or a shared sequence.
- *How it works:* Variables declared at module scope (outside the component function) are initialized once when the module loads and persist for the module's lifetime, shared by all component instances in that file. Unlike useRef or useState, they do not reset on mount or unmount. This makes them appropriate for resources where per-instance initialization would break the invariant the resource is meant to provide.
- *Example:* `let globalStreamCounter = 0` placed outside the ChatPanel component ensures that Panel A's first stream gets ID 1 and Panel B's simultaneous first stream gets ID 2, rather than both getting ID 1 as they would with per-instance refs.

**Functional Correctness vs. Resource Correctness**

- *When to use:* When reviewing defensive guards or filters in event-driven or IPC systems — any time an early-return or filter masks the effects of an underlying resource management problem.
- *How it works:* A guard that prevents incorrect behavior (e.g., ignoring chunks with the wrong stream ID) addresses functional correctness: outputs are right. It does not address resource correctness: whether listeners, handles, timers, or memory are properly acquired and released. These are orthogonal properties. A system can be functionally correct while leaking resources, and the guard itself can obscure the leak by making the stale resource appear harmless.
- *Example:* The streamId filter in ChatPanel meant that stale IPC listeners never caused wrong messages to appear, hiding the fact that dozens of listeners were accumulating. The leak was only visible by inspecting listener counts, not by observing rendered output.

**Return-a-Cleanup Registration Pattern**

- *When to use:* When designing any API that registers a listener, subscription, or callback, especially in environments like Electron IPC, Node EventEmitter, or browser event targets where the caller controls the lifetime of the registration.
- *How it works:* Instead of requiring callers to separately call a remove/off/unsubscribe function with the same arguments as the registration call, the registration function itself returns a zero-argument cleanup function that captures the exact listener reference internally. This eliminates the need for the caller to store the listener reference and makes correct cleanup the path of least resistance — the caller only needs to call the returned function at the appropriate lifecycle point.
- *Example:* Changing `api.onChatChunk(cb)` from returning nothing to returning `() => ipcRenderer.removeListener('chat:chunk', wrapped)` let the ChatPanel call `const remove = api.onChatChunk(handler)` and then call `remove()` inside finish() without needing to track or re-reference the internal wrapped listener.


---

## 2026-03-25-agent-dashboard-dev-server-spawn-electron-agent-dashboard-failed-to-reliably-spawn-

### Q&A Cards

**Q:** You're debugging a spawn failure in Electron's main process. The child process exits with code 1 and a Node version error, even though you confirmed npm is on the PATH. What is the most likely cause, and how would you diagnose it?

**A:** npm resolves Node via its shebang line, which picks up whichever Node binary is first on the PATH — in Electron's main process that is Electron's own bundled Node, not the user's system Node. To diagnose, check the version of `process.execPath` and compare it to the Node version requirement of the tool. The fix is to bypass npm entirely: resolve the highest available Node binary from ~/.nvm/versions/node/ and invoke the CLI binary directly with that Node, skipping npm and any shebang resolution.

**Q:** A Next.js dev server spawned from Electron crashes with 'Symlink node_modules is invalid'. Nothing in your spawn code has changed recently. What should you investigate first, and why might the error message be misleading?

**A:** Investigate whether Next.js is using Turbopack, which became the default in Next.js 16.1.1. The error message does not mention Turbopack by name, making it easy to assume it is a general Node.js or filesystem error. Turbopack enforces a strict filesystem-root boundary and rejects symlinks pointing outside the project directory. Webpack does not have this restriction. Passing `--webpack` to `next dev` bypasses Turbopack and resolves the crash if node_modules is symlinked from outside the project tree, as is the case with git worktrees.

**Q:** After killing an Electron app and relaunching it immediately, the spawned dev server fails with EADDRINUSE. You did not change any port configuration. Why does this happen, and what is the reliable fix?

**A:** Child processes do not die synchronously when their parent Electron process exits — they briefly outlive it. On a fast restart, the previous process may still hold the port. This makes EADDRINUSE appear to be a configuration bug when it is actually a process-lifecycle issue. The reliable fix is to run `lsof -ti :<port> | xargs kill -9` synchronously before every server spawn to evict any process still bound to the target port, regardless of whether a previous instance is believed to be dead.

**Q:** You need to spawn a CLI tool from Electron's main process on a machine where the tool is managed by nvm. Using `shell: true` makes the spawn succeed in development but fail on a colleague's machine. What is the structural reason for this fragility, and what is the correct approach?

**A:** With `shell: true`, the spawn inherits Electron's shell environment, which is not the user's interactive login shell. Tools installed via nvm or other shell-init-managed systems are not on this PATH. The behavior is therefore machine- and configuration-dependent. The correct approach is to resolve all binary paths to absolute filesystem locations before spawning: scan ~/.nvm/versions/node/ to find the desired Node binary, and construct the full path to any CLI tool inside node_modules/.bin. This removes all reliance on PATH and makes the spawn environment-independent.

**Q:** Each git worktree in your project has its own working directory but no node_modules. A script needs to run `next dev` inside each worktree. What two problems must you solve before spawning, and what is the minimal correct sequence of steps?

**A:** First, node_modules (and the `next` binary inside it) does not exist in the worktree — only the main checkout has it. Solve this by running `git worktree list --porcelain` to locate the main checkout and symlinking its node_modules into the worktree with `ln -sfn`. Second, Next.js 16.1.1's Turbopack rejects symlinked node_modules that point outside the project root. Solve this by passing `--webpack` to `next dev`. The full sequence in startServer() is: (1) detect main checkout and symlink node_modules, (2) evict any process on the target port, (3) resolve the system Node binary, (4) resolve the absolute path to .bin/next, (5) spawn directly with no shell or PATH dependency.

**Q:** A teammate suggests using `process.execPath` to get a Node binary path so you can run a script from Electron's main process. What is wrong with this suggestion, and what are the two distinct failure modes it can cause?

**A:** `process.execPath` in Electron's main process returns the path to the Electron binary, not a plain Node binary. The two failure modes are: (1) behavioral — running the Electron binary as a script interpreter triggers Electron's application bootstrap rather than a plain Node runtime, so behavior is undefined and unrelated to script execution; (2) version — Electron bundles a specific Node version (e.g., 18) that may not satisfy the version requirement of the tool being spawned, causing a silent version-mismatch exit. The correct approach is to independently resolve a real Node binary from the user's nvm versions directory.

### Concept Cards

**Absolute Binary Resolution for Sandboxed Spawners**

- *When to use:* Any time you need to spawn an external process from an environment that does not inherit the user's interactive shell PATH, such as Electron's main process, CI runners, or system daemons.
- *How it works:* Instead of relying on PATH lookup or shell resolution, you enumerate the filesystem directly to find the exact binary you need. For runtimes like Node managed by nvm, you scan the known versions directory, sort semantically, and select the appropriate version's absolute path. For project-local tools, you construct the path directly from node_modules/.bin. This approach is deterministic and portable across machines regardless of shell configuration.
- *Example:* In Electron, rather than spawning `npm run dev` with shell: true, the solution scanned ~/.nvm/versions/node/, sorted descending, took the highest version's node binary, and constructed the full path to .bin/next — making the spawn work identically on any developer's machine regardless of their shell or nvm setup.

**Port Eviction Before Respawn**

- *When to use:* Whenever a long-lived process you own may restart quickly and needs to re-bind a network port, especially when the process can be killed externally or crash unexpectedly.
- *How it works:* Child processes do not release their resources atomically when a parent dies — there is a window where the child still holds the port. Instead of assuming the port is free, you actively evict any occupant before binding it again. Running a synchronous `lsof -ti :<port> | xargs kill -9` before each spawn converts a probabilistic race condition into a deterministic clean state. This also defends against any previous instance that was orphaned by a crash rather than a clean shutdown.
- *Example:* In the Electron agent, fast restarts produced EADDRINUSE errors that appeared to be spawn configuration bugs. Adding a synchronous lsof kill step at the top of startServer() before every spawn eliminated the race condition entirely, regardless of how quickly the app was restarted.

**Default-Feature Suspicion When Error Messages Are Opaque**

- *When to use:* When a tool produces an error that doesn't obviously map to your code changes, especially after a major version upgrade where defaults may have changed.
- *How it works:* Framework and tooling major versions sometimes change which subsystem runs by default. When an error message points to a filesystem or environmental constraint you did not deliberately introduce, consider whether a new default feature — rather than your code — is responsible. Check the changelog or defaults for the current version and test whether explicitly disabling the new default resolves the error.
- *Example:* Next.js 16.1.1 silently switched the default bundler to Turbopack. The error 'Symlink node_modules is invalid' gave no indication that Turbopack was involved. Recognizing that the default had changed and passing `--webpack` to explicitly opt out immediately resolved the crash.

**Layered Environment Isolation Debugging**

- *When to use:* When a spawn or subprocess failure has multiple compounding causes that each appear independently plausible, making it hard to determine which fix is sufficient.
- *How it works:* Treat each environmental layer — binary resolution, runtime version, filesystem layout, network resource availability — as an independent variable to validate in sequence. Fix and confirm one layer before moving to the next, because a partial fix may mask or expose a different underlying problem. Document each symptom-to-cause mapping explicitly so that apparent fixes that only address symptoms (like adding nvm to PATH) are recognized as incomplete before being committed.
- *Example:* In this problem, five distinct issues compounded: missing node_modules, Turbopack symlink rejection, missing PATH, wrong Node version via shebang, and port conflicts. Fixing PATH to find npm appeared to work but exposed the Node version problem. Only by treating each layer separately and verifying independently was the full solution reached.


---

## 2026-03-25-agent-dashboard-resizable-panels-agent-dashboard-side-panels-were-fixed-width-with-

### Q&A Cards

**Q:** You need to animate a panel resize in an Electron app that has a native WebContentsView overlay. Why is using a CSS `width` transition with a ResizeObserver better than imperatively pushing bounds on every drag/collapse event?

**A:** CSS transitions drive real DOM geometry on every animation frame. A ResizeObserver attached to the container fires on each of those frames, always reporting the true current width, and can push that directly to `setBounds`. The alternative — imperative bounds updates — would require you to replicate the animation's duration, easing, and timing in JS, creating two sources of truth that can drift apart and causing the native view to jump rather than follow smoothly.

**Q:** A drag handle stops tracking the mouse mid-drag whenever the user moves quickly. What is the likely cause and how do you fix it?

**A:** The `mousemove` listener is attached to the handle element itself. Fast mouse movement causes the cursor to leave the element, so the browser stops delivering events to it. The fix is to attach both `mousemove` and `mouseup` to `window` on `mousedown`, then remove them on `mouseup`. The window always receives pointer events regardless of which element the cursor is over.

**Q:** You implement drag-to-resize for both a left and a right panel using the same delta formula `currentX - startX`. The left panel works correctly but the right panel expands when you drag left. What is wrong and how do you fix it?

**A:** The delta formula is not direction-aware. For the left panel, moving right (increasing X) should expand the panel, so `delta = currentX - startX` is correct. For the right panel, moving left (decreasing X) should expand it, so the delta must be inverted: `delta = startX - currentX`. Each panel needs its own direction-aware delta formula.

**Q:** A user collapses a panel, then re-expands it and finds it has reset to the default width instead of their last custom width. What persistence bug caused this and how do you fix it?

**A:** Only the `collapsed` boolean was saved to `localStorage`, not the panel width. On re-expand, the hook falls back to `defaultWidth`. The fix is to persist both values under separate keys — e.g., `<key>:width` and `<key>:collapsed` — so the width is remembered independently of whether the panel is currently collapsed.

**Q:** At what drag position should a panel snap to fully collapsed, and what principle justifies that specific threshold?

**A:** The panel should snap to collapsed when the computed width drops below `minWidth / 2`. This threshold requires the user to drag well past the minimum before collapse is triggered, preventing accidental collapse from a small overshoot. Once past the halfway point, completing the collapse matches the user's apparent intent, making the snap feel natural rather than surprising.

**Q:** You render the floating 'expand' pill button inside the same div that collapses to zero width. The pill is never visible when the panel is collapsed. Why, and where should the pill be rendered instead?

**A:** The collapsing wrapper div has `overflow: hidden`, which clips all child content — including the pill — as the width animates to zero. The pill must be rendered outside the collapsing wrapper, positioned relative to a parent container (e.g., the dashboard root), so it is not subject to the wrapper's clipping context.

### Concept Cards

**DOM-as-Ground-Truth Observer Pattern**

- *When to use:* When you need to keep an external system (native overlay, canvas, iframe, third-party widget) synchronized with an element whose size changes via CSS transitions or animations.
- *How it works:* Instead of computing expected size in JS and pushing it to the external system, attach a ResizeObserver to the DOM element and let the browser report actual layout size on every change. Because the observer reads real geometry after layout, it is always correct regardless of what caused the resize — drag, CSS transition, flexbox reflow, or window resize. This eliminates duplicated timing and easing logic.
- *Example:* In the Electron dashboard, a ResizeObserver on the preview-pane container fires on every frame of the CSS width transition and calls `setBounds` with the observed rect, keeping the native WebContentsView perfectly in sync without any animation callbacks.

**Snap-to-Threshold Collapse**

- *When to use:* When a UI panel or drawer can be dragged to resize and you want collapse to feel intentional rather than accidental.
- *How it works:* Define a snap threshold partway through the 'illegal' zone — typically at half the minimum allowed width. If the user drags past the minimum but not past the threshold, clamp back to the minimum. Only snap to fully collapsed once they cross the threshold. This two-zone model means a small accidental overshoot bounces back, while a deliberate drag completes the collapse.
- *Example:* The agent dashboard snaps a panel to collapsed only when the computed drag width falls below `minWidth / 2`, preventing a panel from accidentally collapsing on a small overshoot past the minimum.

**Window-Level Drag Capture**

- *When to use:* Whenever you implement any drag interaction using raw mouse events on a specific DOM element.
- *How it works:* On `mousedown`, record initial state and attach `mousemove` and `mouseup` listeners to `window` (not the handle element). The window receives all pointer events regardless of which element the cursor is over, so fast movement that exits the handle does not drop the drag. On `mouseup`, clean up both listeners to avoid memory leaks and ghost drags.
- *Example:* The resize handle's `onMouseDown` attaches `window` listeners for `mousemove` (to compute delta and update width) and `mouseup` (to clean up), ensuring drag tracking is never interrupted even when the cursor races ahead of the handle.

**Orthogonal Persistence Keys for Compound State**

- *When to use:* When persisting UI state that has multiple independent dimensions — such as a panel's size and its open/closed status — to local storage or any key-value store.
- *How it works:* Store each logically independent dimension under its own key rather than serializing them together. This allows each dimension to evolve independently: the panel can be collapsed without overwriting its remembered width, and re-expanding restores the exact prior size. Coupling them into one value forces a read-modify-write cycle and risks one dimension stomping the other.
- *Example:* The `usePanelResize` hook stores width under `<key>:width` and collapsed state under `<key>:collapsed` in localStorage, so collapsing a panel never clears the user's last custom width and re-expanding always restores it.


---

## 2026-03-25-agent-dashboard-webcontentsview-zindex-popovers-and-dropdowns-in-an-electron-renderer-wer

### Q&A Cards

**Q:** Popovers in your Electron app have correct CSS z-index values and exist in the DOM, but are still invisible. What should this symptom make you suspect, and why?

**A:** It should prompt you to look outside the CSS rendering model entirely. When z-index is correct but has no effect, the stacking issue is likely crossing a native compositing boundary — such as a WebContentsView or BrowserView — which the OS compositor places above all renderer content regardless of any CSS property.

**Q:** Why is adjusting z-index or adding `isolation: isolate` useless when a WebContentsView is involved, even if the values are very high?

**A:** CSS z-index only controls paint order within a single renderer process context. WebContentsView is a native OS-level compositing layer managed by Electron outside the renderer entirely. The OS compositor always places it above renderer content — there is no CSS property that can cross this boundary.

**Q:** You need to hide a native WebContentsView whenever any popover is open in your app. Why is the shared `PopoverContent` component the right place to add this logic, rather than each individual popover callsite?

**A:** Placing the logic in the shared component means it applies automatically to every current and future popover without any per-callsite changes. Adding it at individual callsites creates repetition, is fragile, and will silently miss any new overlays added later.

**Q:** Why does a `useEffect` with an empty dependency array and a cleanup function map cleanly to popover open/close in this case, without needing explicit open/close event wiring?

**A:** Because `PopoverContent` is portaled and only mounted when the popover is open. Mount corresponds exactly to the popover opening and unmount corresponds exactly to closing, so the effect body runs on open and the cleanup runs on close — no additional event handling is required.

**Q:** What is the critical mistake to avoid when adding hide/show logic for a native view inside a `useEffect`, and what is the consequence of making it?

**A:** Forgetting the cleanup function that calls `showPreview` on unmount. If the cleanup is omitted, the native WebContentsView will remain hidden permanently after the popover closes, breaking the preview panel for the rest of the session.

**Q:** After fixing popovers by hiding the WebContentsView in `PopoverContent`, a new modal component is added to the app and has the same invisibility problem. Why isn't it fixed automatically, and what must you do?

**A:** The fix only covers components that share the `PopoverContent` component. A modal is a separate overlay primitive with its own root component, so the hide/show pattern must be independently added to that component (e.g., `ModalContent`) to cover it.

### Concept Cards

**Native Compositing Layer Boundary**

- *When to use:* When a UI element appears invisible or mis-stacked despite correct CSS z-index values, especially in hybrid native/web environments like Electron.
- *How it works:* Operating systems composite UI from multiple independent layers. Native views (such as Electron's WebContentsView) exist on a separate OS-managed layer that is always placed above web renderer content. CSS z-index only controls ordering within a single renderer context and has no authority across this boundary — the fix must be architectural, not stylistic.
- *Example:* In Electron, a WebContentsView displaying a Next.js preview was always rendered above popovers in the main renderer, regardless of z-index. The solution was to hide the WebContentsView via IPC when any overlay opened, rather than attempting any CSS fix.

**Mount/Unmount as Open/Close Lifecycle Proxy**

- *When to use:* When you need to trigger side effects on the open and close of a conditionally rendered or portaled UI component without access to explicit open/close events.
- *How it works:* If a component is only mounted while it is 'active' (open, visible, selected), React's mount and unmount lifecycle events are exact proxies for open and close. A `useEffect` with an empty dependency array runs on mount (open) and its cleanup runs on unmount (close), eliminating the need for prop-drilling or event subscription.
- *Example:* In `PopoverContent`, which is only mounted while the popover is open, `useEffect(() => { hidePreview(); return () => showPreview(); }, [])` hides the native view on open and restores it on close without any explicit state or event wiring.

**Shared Component as Single Fix Point**

- *When to use:* When a cross-cutting behavioral fix needs to apply to every instance of a UI pattern across an application, now and in the future.
- *How it works:* Identify the lowest shared abstraction that all instances of the pattern pass through. Implement the fix there exactly once. This ensures consistent behavior, eliminates per-callsite repetition, and automatically covers future additions — as long as they use the same shared component.
- *Example:* Rather than adding hide/show IPC calls to every individual popover in the Electron dashboard, the logic was added once to the shared `PopoverContent` component, covering all existing and future popovers automatically.

**Eliminate CSS Before Escalating Diagnosis**

- *When to use:* When a visual layering or stacking bug does not respond to z-index, stacking context, or isolation adjustments as expected.
- *How it works:* CSS z-index and stacking context are well-defined within a browser renderer, so if manipulating them has no effect, the root cause is almost certainly outside the CSS model — likely a native layer, iframe boundary, or compositor behavior. Confirming this early prevents wasted effort on CSS-only solutions and redirects investigation to the correct layer.
- *Example:* Overlays in the Electron dashboard had correct z-index values but remained invisible. Recognizing that CSS adjustments had no effect pointed directly to the WebContentsView as a native compositing layer, and the investigation shifted to IPC-based visibility toggling.

