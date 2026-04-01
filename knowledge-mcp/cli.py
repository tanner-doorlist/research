#!/usr/bin/env python3
"""
cli.py — Direct CLI interface to knowledge-scribe.

Used by Claude (Cowork) to log, search, and generate cards
without going through the MCP stdio protocol.

Commands:
    log      --ticket DLE-123 --notes "..." [--tags tag1,tag2]
    search   --query "..." [--n 3]
    generate

Exit codes: 0 = success, 1 = error
Output: plain text to stdout (suitable for reading back in conversation)
"""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

# ── Bootstrap ─────────────────────────────────────────────────────────────────

_here = Path(__file__).parent
_env  = _here / ".env"

if _env.exists():
    from dotenv import load_dotenv
    load_dotenv(_env)

from anthropic import Anthropic
from openai import OpenAI

import db as pgdb

DEDUP_THRESHOLD = float(os.environ.get("DEDUP_THRESHOLD", "0.88"))
EMBED_MODEL     = "text-embedding-3-small"
CLAUDE_MODEL    = "claude-sonnet-4-6"

_anthropic  = Anthropic()
_openai     = OpenAI()


# ── Core ─────────────────────────────────────────────────────────────────────

def embed(text: str) -> list[float]:
    resp = _openai.embeddings.create(model=EMBED_MODEL, input=text[:8000])
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


def _format(ticket_id: str, raw_notes: str, tags: list[str]) -> str:
    tag_str = ", ".join(f'"{t}"' for t in tags) if tags else ""
    msg     = _anthropic.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": FORMAT_PROMPT.format(
                ticket_id=ticket_id,
                date=datetime.now().strftime("%Y-%m-%d"),
                raw_notes=raw_notes,
                tags=tag_str,
            ),
        }],
    )
    return msg.content[0].text.strip()


def _merge(existing: str, new_notes: str) -> str:
    msg = _anthropic.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": MERGE_PROMPT.format(
            existing=existing, new_notes=new_notes
        )}],
    )
    return msg.content[0].text.strip()


def _extract_problem(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("problem:"):
            return line.split(":", 1)[1].strip().strip('"\'')
    return "untitled"


def _extract_sections(markdown: str, names: list[str]) -> str:
    lines, capture, out = markdown.splitlines(), False, []
    for line in lines:
        if line.startswith("## "):
            capture = any(line[3:].strip().startswith(n) for n in names)
        elif capture:
            out.append(line)
    text = "\n".join(out).strip()
    return text[:800] if text else markdown[:800]


def _parse_tags(fm: dict) -> list[str]:
    try:
        parsed = json.loads(fm.get("tags", "[]"))
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_log(ticket_id: str, raw_notes: str, tags: list[str]) -> str:
    vec = embed(f"{ticket_id}\n{raw_notes}")

    # Check for near-duplicate via pgvector
    nearest = pgdb.nearest_logs(vec, n=1)

    if nearest:
        similarity = nearest[0]["similarity"]

        if similarity >= DEDUP_THRESHOLD:
            existing = nearest[0]
            filename = existing["filename"]

            merged = _merge(existing["content"], raw_notes)
            merged_vec = embed(merged[:8000])

            fm = pgdb.parse_frontmatter(merged)
            pgdb.upsert_log(
                filename=filename,
                date=fm.get("date"),
                log_type=fm.get("type", "coding"),
                problem=fm.get("problem", filename),
                tags=_parse_tags(fm),
                content=merged,
                embedding=merged_vec,
            )
            return f"Merged into: {filename}  (similarity {similarity:.0%})"

    formatted    = _format(ticket_id, raw_notes, tags)
    problem_line = _extract_problem(formatted)
    date_str     = datetime.now().strftime("%Y-%m-%d")
    filename     = f"{date_str}-{ticket_id.lower()}-{slugify(problem_line)}.md"

    fm = pgdb.parse_frontmatter(formatted)

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


def cmd_search(query: str, n: int) -> str:
    vec     = embed(query)
    results = pgdb.nearest_logs(vec, n=n)

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


def cmd_generate() -> str:
    from generate_cards import process_unprocessed_logs
    return process_unprocessed_logs()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="cli.py")
    sub    = parser.add_subparsers(dest="cmd", required=True)

    # log
    p_log = sub.add_parser("log", help="Log knowledge from a ticket")
    p_log.add_argument("--ticket", required=True, help="Ticket ID, e.g. DLE-123")
    p_log.add_argument("--notes",  required=True, help="Raw notes (verbose)")
    p_log.add_argument("--tags",   default="",    help="Comma-separated tags")

    # search
    p_search = sub.add_parser("search", help="Semantic search over logs")
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--n",     type=int, default=3)

    # generate
    sub.add_parser("generate", help="Generate study cards from new logs")

    args = parser.parse_args()

    try:
        if args.cmd == "log":
            tags   = [t.strip() for t in args.tags.split(",") if t.strip()]
            result = cmd_log(args.ticket, args.notes, tags)
        elif args.cmd == "search":
            result = cmd_search(args.query, args.n)
        elif args.cmd == "generate":
            result = cmd_generate()
        else:
            result = "Unknown command"

        print(result)
        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
