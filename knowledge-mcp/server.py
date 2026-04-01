#!/usr/bin/env python3
"""
knowledge-scribe MCP server

Exposes four tools:
  - log_knowledge        : format, deduplicate, and persist a new problem log
  - search_knowledge     : semantic search over all indexed logs
  - generate_study_cards : convert unprocessed logs into flashcards
  - review_pr            : extract engineering knowledge from a PR diff → log + study cards

Deduplication:
  1. Embed incoming notes with OpenAI text-embedding-3-small
  2. Query Postgres (pgvector) for nearest neighbor
  3. If similarity >= DEDUP_THRESHOLD → Claude merges into existing log
  4. Otherwise → Claude formats fresh log, writes to Postgres with embedding
"""

import json
import os
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from openai import OpenAI

import db as pgdb

# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")

DEDUP_THRESHOLD  = float(os.environ.get("DEDUP_THRESHOLD", "0.88"))
EMBED_MODEL      = "text-embedding-3-small"
CLAUDE_MODEL     = "claude-sonnet-4-6"

anthropic_client = Anthropic()
openai_client    = OpenAI()

mcp = FastMCP("knowledge-scribe")


# ── Helpers ───────────────────────────────────────────────────────────────────

def embed(text: str) -> list[float]:
    resp = openai_client.embeddings.create(
        model=EMBED_MODEL,
        input=text[:8000],
    )
    return resp.data[0].embedding


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", text.lower().strip()))[:50]


FORMAT_PROMPT = """\
You are formatting raw developer notes into a structured knowledge log.

Ticket: {ticket_id}
Date: {date}

Raw notes:
{raw_notes}

Output ONLY valid markdown using this exact template. Be concise. \
Every section must be filled — use "N/A" if genuinely not applicable.

---
date: {date}
type: coding
problem: <one-line problem description>
tags: [{tags}]
---

## Problem
<what was asked or what broke; relevant context>

## Initial Observations
<what was noticed first; what was ambiguous>

## Approach
<numbered step-by-step reasoning; what hypotheses were formed and checked>

1.
2.
3.

## Key Insights
<the non-obvious things; mental models or heuristics that applied>

-

## Solution
<the final answer, fix, or output>

## Pitfalls / What to Watch For
<what would have led someone astray; wrong early assumptions>

-

## Study Prompts
Q: <key diagnostic or reasoning question>
A: <answer>
---"""


MERGE_PROMPT = """\
Two knowledge logs cover overlapping material. Merge them into one comprehensive log that:
- Deduplicates repeated information (keep the clearest version)
- Preserves unique insights from both
- Maintains the same markdown template structure

EXISTING LOG:
{existing}

NEW NOTES:
{new_notes}

Output ONLY the merged markdown — no preamble, no explanation.\
"""


def format_with_claude(ticket_id: str, raw_notes: str, tags: list[str]) -> str:
    tag_str = ", ".join(f'"{t}"' for t in tags) if tags else ""
    prompt  = FORMAT_PROMPT.format(
        ticket_id=ticket_id,
        date=datetime.now().strftime("%Y-%m-%d"),
        raw_notes=raw_notes,
        tags=tag_str,
    )
    msg = anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


def merge_with_claude(existing: str, new_notes: str) -> str:
    prompt = MERGE_PROMPT.format(existing=existing, new_notes=new_notes)
    msg = anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


def extract_problem_line(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("problem:"):
            return line.split(":", 1)[1].strip().strip('"\'')
    return "untitled"


def _parse_tags(fm: dict) -> list[str]:
    try:
        parsed = json.loads(fm.get("tags", "[]"))
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


# ── Tools ─────────────────────────────────────────────────────────────────────

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
    tags = tags or []
    embed_input = f"{ticket_id}\n{raw_notes}"
    vec = embed(embed_input)

    # Check for near-duplicate via pgvector
    nearest = pgdb.nearest_logs(vec, n=1)

    if nearest:
        similarity = nearest[0]["similarity"]

        if similarity >= DEDUP_THRESHOLD:
            existing_row = nearest[0]
            existing_filename = existing_row["filename"]
            existing_content = existing_row["content"]
            merged = merge_with_claude(existing_content, raw_notes)

            # Re-embed merged content
            merged_vec = embed(merged[:8000])

            # Update in Postgres
            fm = pgdb.parse_frontmatter(merged)
            pgdb.upsert_log(
                filename=existing_filename,
                date=fm.get("date"),
                log_type=fm.get("type", "coding"),
                problem=fm.get("problem", existing_filename),
                tags=_parse_tags(fm),
                content=merged,
                embedding=merged_vec,
            )

            return (
                f"Merged into existing log: {existing_filename}\n"
                f"Similarity: {similarity:.0%}"
            )

    # Format fresh log
    formatted    = format_with_claude(ticket_id, raw_notes, tags)
    problem_line = extract_problem_line(formatted)
    date_str     = datetime.now().strftime("%Y-%m-%d")
    filename     = f"{date_str}-{ticket_id.lower()}-{slugify(problem_line)}.md"

    # Parse frontmatter for structured storage
    fm = pgdb.parse_frontmatter(formatted)

    # Write to Postgres with embedding
    pgdb.upsert_log(
        filename=filename,
        date=date_str,
        log_type=fm.get("type", "coding"),
        problem=fm.get("problem", problem_line),
        tags=tags,
        content=formatted,
        embedding=vec,
    )

    preview = "\n".join(formatted.splitlines()[:20])
    return f"Logged: {filename}\n\n{preview}\n..."


@mcp.tool()
def search_knowledge(query: str, n_results: int = 3) -> str:
    """
    Semantic search over all indexed knowledge logs.
    Returns the most relevant log excerpts for the given query.

    Args:
        query:     Natural language query
        n_results: Number of results to return (default 3)
    """
    vec     = embed(query)
    results = pgdb.nearest_logs(vec, n=n_results)

    if not results:
        return "No matching knowledge found."

    parts = []
    for row in results:
        similarity = row["similarity"]
        filename   = row["filename"]
        excerpt    = _extract_sections(row["content"], ["Key Insights", "Solution", "Pitfalls"])

        parts.append(
            f"### {filename}  (similarity {similarity:.0%})\n"
            f"date: {row.get('date', '?')}\n\n"
            f"{excerpt}"
        )

    return "\n\n---\n\n".join(parts)


@mcp.tool()
def generate_study_cards() -> str:
    """
    Convert unprocessed problem logs into Q&A and concept flashcards.
    Reads from Postgres, writes new cards to Postgres.
    """
    from generate_cards import process_unprocessed_logs
    return process_unprocessed_logs()


# ── Util ──────────────────────────────────────────────────────────────────────

def _extract_sections(markdown: str, section_names: list[str]) -> str:
    """Pull named ## sections from a markdown log."""
    lines   = markdown.splitlines()
    capture = False
    out     = []

    for line in lines:
        if line.startswith("## "):
            heading = line[3:].strip()
            capture = any(heading.startswith(s) for s in section_names)
        elif capture:
            out.append(line)

    text = "\n".join(out).strip()
    return text[:800] if text else markdown[:800]


# ── review_pr ─────────────────────────────────────────────────────────────────

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
        nearest = pgdb.nearest_logs(vec, n=1)
        if nearest and nearest[0]["similarity"] >= DEDUP_THRESHOLD:
            results.append(f"  skipped '{slug}' (already covered at {nearest[0]['similarity']:.0%} similarity)")
            continue

        outcome = log_knowledge(ticket_id=ticket_id, raw_notes=raw_notes, tags=item_tags)
        results.append(f"  logged '{slug}': {outcome.splitlines()[0]}")
        logged_count += 1

    if logged_count > 0:
        card_outcome = generate_study_cards()
        results.append(f"\nStudy cards: {card_outcome.splitlines()[0]}")

    summary = f"PR #{pr_number} — {logged_count}/{len(items)} items logged\n" + "\n".join(results)
    return summary


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
