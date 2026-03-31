```markdown
---
date: 2026-03-24
type: coding
problem: MCP server for knowledge-scribe not connecting to Claude Code due to wrong config location, scope, and shell parsing issues
tags: ["claude-code", "mcp", "setup", "devtools", "chromadb"]
---

## Problem
Wiring the `knowledge-mcp` Python FastMCP server into Claude Code so it auto-logs insights during work sessions. The system comprises three components: `knowledge-mcp` (FastMCP server), `study-notifier` (Electron spaced repetition app), and `study-cards` (TSV flashcard files). Despite attempting multiple config approaches, the MCP server failed to appear in Claude Code.

## Initial Observations
- Config placement was ambiguous: `~/.claude/claude_code_config.json`, `~/.claude/settings.local.json`, and `~/.claude.json` all seemed plausible homes for `mcpServers`
- `claude mcp add` appeared to work without errors but the server still didn't show up
- Long API keys with special characters caused cryptic CLI parse errors that obscured the real failure

## Approach

1. Identified correct config file: Claude Code validates `settings.json` strictly and does not recognize `mcpServers` there. The correct location is the top-level `mcpServers` key in `~/.claude.json`.
2. Identified scope problem: `claude mcp add` defaults to `local` scope, writing the entry under the current directory path inside `~/.claude.json` — making the server available only in that exact working directory. Switched to `-s user` flag to write to the top-level `mcpServers` key for global availability.
3. Identified sudo problem: `sudo claude mcp add` writes to `/var/root` (root's home), not `~/`. Claude Code reads from the user's home, so the config was silently ignored.
4. Identified shell parsing problem: Long API keys in `-e` flags caused the CLI to misparse the server name as part of the variadic argument list. Bypassed CLI entirely by directly editing `~/.claude.json`.
5. Identified ChromaDB dependency: The MCP server requires ChromaDB running at `localhost:8000`, which must currently be started manually each session. Flagged for automation via Electron `child_process.spawn` on `app ready` / `before-quit`.

## Key Insights

- `~/.claude.json` and `~/.claude/settings.json` are distinct files with distinct purposes — do not conflate them
- `local` vs `user` scope in `claude mcp add` is silent but critical: local scope binds the server to a directory, user scope makes it global
- `sudo` silently redirects home-directory writes to `/var/root`, making it a dangerous default for any user-config tooling on macOS
- When CLI argument parsing is fragile (special characters, long values), editing the config JSON directly is safer and more reliable than fighting shell escaping
- MCP server registration and the server's runtime dependencies (e.g., ChromaDB) are independent failure modes — both must be satisfied

## Solution

Directly edit `~/.claude.json` to add the `mcpServers` entry at the top level:

```json
{
  "mcpServers": {
    "knowledge-scribe": {
      "type": "stdio",
      "command": "python3",
      "args": ["/path/to/server.py"],
      "env": {
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

Start ChromaDB manually before each session:
```bash
cd knowledge-mcp && .venv/bin/chroma run --path ./chroma_db
```

Restart Claude Code after editing `~/.claude.json`. Verify with `claude mcp list`.

## Pitfalls / What to Watch For

- Writing to `~/.claude/settings.json` or `~/.claude/claude_code_config.json` instead of `~/.claude.json` — all silently fail
- Using `claude mcp add` without `-s user` — server appears registered but is invisible outside the original directory
- Using `sudo claude mcp add` — config is written to `/var/root`, never read by the user's Claude Code instance
- API keys stored in plaintext in `~/.claude.json` — rotate immediately if exposed in chat or logs
- Forgetting to start ChromaDB before a session — MCP server will be registered but non-functional
- Editing `~/.claude.json` while Claude Code is open — changes require a full restart to take effect

## Study Prompts
Q: Where does Claude Code store user-scope MCP server configuration, and how does it differ from local scope?
A: User-scope MCP servers are stored in the top-level `mcpServers` key of `~/.claude.json` and are available in all sessions. Local scope writes the entry under a directory-specific path inside the same file, making the server available only when Claude Code is opened in that exact directory. Use `claude mcp add -s user` for global availability.

Q: Why would a correctly configured MCP server in `~/.claude.json` never appear after running `sudo claude mcp add`?
A: `sudo` changes the effective home directory to `/var/root`, so the config is written there instead of `~/`. Claude Code reads from the user's home directory, so the entry is silently ignored. Never use `sudo` for `claude mcp add`.
```