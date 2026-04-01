#!/usr/bin/env python3
"""
knowledge-scribe MCP server

Exposes four tools:
  - log_knowledge        : format, deduplicate, and persist a new problem log
  - search_knowledge     : semantic search over all indexed logs
  - generate_study_cards : convert unprocessed logs into flashcards
  - review_pr            : extract engineering knowledge from a PR diff -> log + study cards

Deduplication:
  1. Embed incoming notes with OpenAI text-embedding-3-small
  2. Query Postgres (pgvector) for nearest neighbor
  3. If similarity >= DEDUP_THRESHOLD -> Claude merges into existing log
  4. Otherwise -> Claude formats fresh log, writes to Postgres with embedding
"""

import json
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from knowledge_scribe.ai import anthropic_client
from knowledge_scribe.config import CLAUDE_MODEL, DEDUP_THRESHOLD
from knowledge_scribe.core import embed
from knowledge_scribe.db import get_db
from knowledge_scribe.services.cards import process_unprocessed_logs
from knowledge_scribe.services.knowledge import log_knowledge as _log_knowledge
from knowledge_scribe.services.knowledge import search_knowledge as _search_knowledge

# ── MCP setup ────────────────────────────────────────────────────────────────

mcp = FastMCP("knowledge-scribe")


# ── Tools ────────────────────────────────────────────────────────────────────

@mcp.tool()
def log_knowledge(
    ticket_id: str,
    raw_notes: str,
    tags: list[str] | None = None,
) -> str:
    """
    Log knowledge gained from working on a ticket.
    Claude formats the notes, checks for duplicates via embedding similarity,
    merges if overlapping, and persists to Postgres.

    Args:
        ticket_id: Linear ticket ID, e.g. DLE-123
        raw_notes: Verbose raw notes — what you did, why, what broke, what worked
        tags:      Optional list of topic tags
    """
    return _log_knowledge(ticket_id, raw_notes, tags)


@mcp.tool()
def search_knowledge(query: str, n_results: int = 3) -> str:
    """
    Semantic search over all indexed knowledge logs.
    Returns the most relevant log excerpts for the given query.

    Args:
        query:     Natural language query
        n_results: Number of results to return (default 3)
    """
    return _search_knowledge(query, n_results)


@mcp.tool()
def generate_study_cards() -> str:
    """
    Convert unprocessed problem logs into Q&A and concept flashcards.
    Reads from Postgres, writes new cards to Postgres.
    """
    return process_unprocessed_logs()


# ── review_pr ────────────────────────────────────────────────────────────────

REVIEW_PR_PROMPT = """\
You are reviewing a pull request diff to extract engineering knowledge worth studying.

The audience is a software engineer working on this codebase. Extract only items that
genuinely expand understanding — not things that are obvious, boilerplate, or easily Googled.

PR #{pr_number}: {pr_title}

Description:
{pr_description}

Diff:
{diff}

---

Identify up to 3 knowledge items worth logging. Each item must be one of:
- A non-obvious implementation decision and the WHY behind it
- A problem-solving or debugging strategy actually used here
- A pattern, tradeoff, or codebase convention with real engineering value
- A mental model or heuristic that makes this class of problem easier to solve

Skip: boilerplate, obvious refactors, trivial style changes, anything that doesn't
teach a transferable skill or deepen understanding of how this system works.

Return JSON only — no preamble:
{{
  "items": [
    {{
      "slug": "<5-word-max kebab-case identifier>",
      "raw_notes": "<concrete explanation: what changed, why, what the insight is, what to watch for. 3-8 sentences. Be specific — name the actual classes, functions, values involved.>",
      "tags": ["<tag1>", "<tag2>"]
    }}
  ]
}}

If there is genuinely nothing worth logging, return {{"items": []}}
"""


@mcp.tool()
def review_pr(pr_number: int, repo_path: str | None = None) -> str:
    """
    Extract engineering knowledge from a merged PR, log it, and generate study cards.

    Fetches the PR diff via `gh`, has Claude identify learnable content, deduplicates
    against existing knowledge, logs new items, and triggers study card generation.

    Args:
        pr_number: GitHub PR number
        repo_path: Path to the git repo (defaults to current working directory)
    """
    cwd = repo_path or str(Path.cwd())
    db = get_db()

    meta_result = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "--json", "title,body"],
        capture_output=True, text=True, cwd=cwd,
    )
    if meta_result.returncode != 0:
        return f"Could not fetch PR #{pr_number}: {meta_result.stderr.strip()}"

    meta = json.loads(meta_result.stdout)
    pr_title = meta.get("title", "")
    pr_description = (meta.get("body") or "").strip()[:2000]

    diff_result = subprocess.run(
        ["gh", "pr", "diff", str(pr_number)],
        capture_output=True, text=True, cwd=cwd,
    )
    if diff_result.returncode != 0:
        return f"Could not fetch diff for PR #{pr_number}: {diff_result.stderr.strip()}"

    diff = diff_result.stdout[:12000]

    prompt = REVIEW_PR_PROMPT.format(
        pr_number=pr_number,
        pr_title=pr_title,
        pr_description=pr_description or "(no description)",
        diff=diff,
    )
    msg = anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        payload = json.loads(msg.content[0].text.strip())
        items = payload.get("items", [])
    except (json.JSONDecodeError, IndexError):
        return "Claude returned malformed JSON — skipping review_pr."

    if not items:
        return f"PR #{pr_number} reviewed — no new knowledge worth logging."

    results = []
    logged_count = 0

    for item in items:
        slug = item.get("slug", "unknown")
        raw_notes = item.get("raw_notes", "")
        item_tags = item.get("tags", []) + ["pr-review", f"pr-{pr_number}"]
        ticket_id = f"PR-{pr_number}-{slug}"

        if not raw_notes:
            continue

        # Check for near-duplicate via pgvector
        vec = embed(f"{ticket_id}\n{raw_notes}")
        nearest = db.nearest_logs(vec, n=1)
        if nearest and nearest[0]["similarity"] >= DEDUP_THRESHOLD:
            results.append(f"  skipped '{slug}' (already covered at {nearest[0]['similarity']:.0%} similarity)")
            continue

        outcome = _log_knowledge(ticket_id=ticket_id, raw_notes=raw_notes, tags=item_tags)
        results.append(f"  logged '{slug}': {outcome.splitlines()[0]}")
        logged_count += 1

    if logged_count > 0:
        card_outcome = process_unprocessed_logs()
        results.append(f"\nStudy cards: {card_outcome.splitlines()[0]}")

    summary = f"PR #{pr_number} — {logged_count}/{len(items)} items logged\n" + "\n".join(results)
    return summary


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
