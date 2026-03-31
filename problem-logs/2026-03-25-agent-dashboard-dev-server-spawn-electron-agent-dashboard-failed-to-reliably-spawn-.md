```markdown
---
date: 2026-03-25
type: coding
problem: Electron agent dashboard failed to reliably spawn Next.js dev servers for git worktrees due to missing node_modules, Turbopack symlink crashes, broken PATH, wrong Node binary, and port conflicts.
tags: ["electron", "nextjs", "spawn", "nvm", "worktrees", "turbopack", "path"]
---

## Problem
An Electron app needed to spawn a `next dev` server for each git worktree of a Next.js 16.1.1 project. Five compounding issues prevented this from working: worktrees lack node_modules, Turbopack rejects symlinked node_modules, Electron's PATH doesn't include nvm-managed binaries, `process.execPath` resolves to the Electron binary (Node 18) rather than the user's Node, and killed Electron instances leave orphaned processes that hold ports on restart.

## Initial Observations
- Git worktrees share the repo but each has its own working directory with no node_modules — `next` binary is simply not present.
- `next dev` in Next.js 16.1.1 defaults to Turbopack, which was not immediately obvious as a source of filesystem errors.
- Spawning with `shell: true` appeared to work at first (npm was eventually found) but failed at runtime due to the wrong Node version being used.
- Port-conflict errors only appeared on fast restarts, making them easy to overlook as a separate systemic issue.

## Approach

1. **Missing node_modules in worktrees:** Used `git worktree list --porcelain` to locate the main checkout's node_modules, then symlinked it into each worktree via `ln -sfn`. Added this auto-symlink logic inside `startServer()` so it runs before every spawn.
2. **Turbopack symlink crash:** Identified that Turbopack enforces a strict filesystem-root boundary and rejects symlinks pointing outside the project tree. Switched to webpack by passing `--webpack` to `next dev`, bypassing Turbopack entirely.
3. **npm not on Electron's PATH:** Attempted to augment the spawn environment with nvm bin directories so `npm` could be found. This succeeded in finding npm but exposed the next problem.
4. **Wrong Node version via npm shebang:** npm's run script resolved Node via shebang, which picked up Electron's bundled Node 18. Next.js 16 requires Node ≥ 20.9.0, so the process exited with code 1. Abandoned the npm/shell approach entirely. Instead, walked `~/.nvm/versions/node/`, sorted versions descending, selected the highest, and used its absolute path as the Node binary. Invoked the `next` bin directly: `spawn(systemNode, [nextBin, 'dev', '--webpack', '--port', port])`.
5. **Port conflicts on restart:** Added a synchronous `lsof -ti :<port> | xargs kill -9` call before each server spawn to evict any process still holding the target port.

## Key Insights
- **In Electron, `process.execPath` is the Electron binary, not Node.** Using it as a Node interpreter causes Electron to run as a script runner — it will not behave like a plain Node process.
- **Never rely on `shell: true` or inherited PATH in Electron's main process.** The shell environment is Electron's, not the user's login shell; nvm and other shell-init-managed tools are absent.
- **Always resolve the full absolute path to every binary you intend to spawn.** This is the only portable, environment-independent approach in Electron.
- **Turbopack's filesystem root check is strict and not symlink-friendly.** If node_modules is symlinked outside the project root (as it is with worktrees), Turbopack will crash even if webpack handles it fine.
- **Child processes outlive their Electron parent momentarily.** Fast restarts must account for this with an explicit port-eviction step.

## Solution
Inside `startServer()`:
1. Detect the worktree's parent checkout via `git worktree list --porcelain` and symlink its node_modules into the worktree if missing.
2. Run `lsof -ti :<port> | xargs kill -9` synchronously to clear the port.
3. Resolve the highest available Node binary by scanning `~/.nvm/versions/node/` and sorting descending.
4. Resolve the absolute path to the `next` CLI binary inside the symlinked node_modules (`.bin/next`).
5. Spawn directly: `spawn(systemNode, [nextBin, 'dev', '--webpack', '--port', port], { cwd: worktreePath })` — no npm, no shell, no PATH dependency.

## Pitfalls / What to Watch For
- **Augmenting PATH to find npm seems like a fix but is not** — npm still uses a shebang that resolves to Electron's bundled Node, silently running the wrong version.
- **Assuming `shell: true` is harmless for convenience** — in Electron it is actively dangerous because the environment is unpredictable.
- **Not accounting for Turbopack being the default in Next.js 16.1.1** — the error message ("Symlink node_modules is invalid") does not obviously point to Turbopack as the cause.
- **Assuming orphaned child processes die immediately** — they don't; without explicit port-eviction, EADDRINUSE on restart will appear to be a spawn configuration bug rather than a lifecycle issue.
- **Using `process.execPath` for any purpose that requires a real Node binary** — it is always wrong inside Electron's main process.

## Study Prompts
Q: Why can't you use `process.execPath` in Electron's main process to get a Node binary for spawning scripts?
A: `process.execPath` in Electron returns the path to the Electron binary itself. While Electron embeds Node internally, running the Electron binary as a script interpreter invokes Electron's application bootstrap, not a plain Node runtime. It also reflects Electron's bundled Node version (e.g., 18), which may not satisfy the version requirements of the tool being spawned.

Q: Why does passing `--webpack` to `next dev` fix the Turbopack symlink crash?
A: Next.js 16.1.1 defaults to Turbopack, which enforces a strict filesystem-root boundary and treats symlinks pointing outside the project directory as invalid. Passing `--webpack` forces Next.js to use webpack instead, which has no such restriction and resolves symlinked node_modules normally.

Q: What is the correct general strategy for spawning user-land Node tools from Electron's main process?
A: Resolve all binary paths to their absolute filesystem locations before spawning. For Node, scan the user's nvm versions directory and select the appropriate version explicitly. For CLI tools, use the absolute path to the binary inside node_modules/.bin. Never use `shell: true`, never rely on inherited PATH, and never use `process.execPath` as a Node interpreter.
```