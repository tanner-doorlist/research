---
description: Run lint, type checks, and tests across all subprojects
allowed-tools: Bash, Read, Grep, Glob
---

Run all CI checks locally to validate the project.

## Checks

Run these checks **in parallel** where possible and report all results:

### knowledge-mcp (Python)
1. `cd knowledge-mcp && python3 -m py_compile server.py` — syntax check
2. `cd knowledge-mcp && python3 -m py_compile cli.py` — syntax check

### study-notifier (Electron + React)
1. `cd study-notifier && node --check main.js` — syntax check
2. `cd study-notifier && node --check preload.js` — syntax check
3. `cd study-notifier && npx tsc --noEmit` — TypeScript type check
4. `cd study-notifier && npx vite build` — Vite build check

### Root
1. `python3 -m py_compile generate_study_cards.py` — syntax check

## Output

After all commands complete, print a summary table:

| Project | Check | Status |
|---------|-------|--------|
| knowledge-mcp | server.py | pass/fail |
| knowledge-mcp | cli.py | pass/fail |
| study-notifier | main.js | pass/fail |
| study-notifier | preload.js | pass/fail |
| study-notifier | tsc --noEmit | pass/fail |
| study-notifier | vite build | pass/fail |
| root | generate_study_cards.py | pass/fail |

If any check fails, show the relevant error output.

$ARGUMENTS
