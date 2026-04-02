---
description: Run lint, type checks, and tests across all subprojects
allowed-tools: Bash, Read, Grep, Glob
---

Run all CI checks locally to validate the project.

## Checks

Run these checks **in parallel** where possible and report all results:

### remote-mcp-server (TypeScript)
1. `cd remote-mcp-server && npx tsc --noEmit` — TypeScript type check

### study-notifier (Electron + React)
1. `cd study-notifier && node --check main.js` — syntax check
2. `cd study-notifier && node --check preload.js` — syntax check
3. `cd study-notifier && npx tsc --noEmit` — TypeScript type check
4. `cd study-notifier && npx vite build` — Vite build check

## Output

After all commands complete, print a summary table:

| Project | Check | Status |
|---------|-------|--------|
| remote-mcp-server | tsc --noEmit | pass/fail |
| study-notifier | main.js | pass/fail |
| study-notifier | preload.js | pass/fail |
| study-notifier | tsc --noEmit | pass/fail |
| study-notifier | vite build | pass/fail |

If any check fails, show the relevant error output.

$ARGUMENTS
