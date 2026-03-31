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
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ── Bootstrap ─────────────────────────────────────────────────────────────────

_here = Path(__file__).parent
_env  = _here / ".env"

if _env.exists():
    from dotenv import load_dotenv
    load_dotenv(_env)

import chromadb
from anthropic import Anthropic
from openai import OpenAI

RESEARCH_DIR    = Path(os.environ.get("RESEARCH_DIR", Path.home() / "research"))
LOGS_DIR        = RESEARCH_DIR / "problem-logs"
CARDS_SCRIPT    = RESEARCH_DIR / "generate_study_cards.py"
CHROMA_HOST     = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT     = int(os.environ.get("CHROMA_PORT", "8000"))
DEDUP_THRESHOLD = float(os.environ.get("DEDUP_THRESHOLD", "0.88"))
EMBED_MODEL     = "text-embedding-3-small"
CLAUDE_MODEL    = "claude-sonnet-4-6"
COLLECTION_NAME = "knowledge_logs"

LOGS_DIR.mkdir(parents=True, exist_ok=True)

_anthropic  = Anthropic()
_openai     = OpenAI()
_chroma     = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
_collection = _chroma.get_or_create_collection(
    COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)


# ── Core (shared with server.py) ──────────────────────────────────────────────

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


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_log(ticket_id: str, raw_notes: str, tags: list[str]) -> str:
    vec     = embed(f"{ticket_id}\n{raw_notes}")
    results = _collection.query(
        query_embeddings=[vec],
        n_results=1,
        include=["documents", "distances", "metadatas"],
    )

    if results["ids"][0]:
        distance   = results["distances"][0][0]
        similarity = 1.0 - distance

        if similarity >= DEDUP_THRESHOLD:
            meta     = results["metadatas"][0][0]
            path     = LOGS_DIR / meta.get("filename", "")
            existing = path.read_text(encoding="utf-8") if path.exists() else ""
            merged   = _merge(existing, raw_notes)

            path.write_text(merged, encoding="utf-8")
            _collection.update(
                ids=[results["ids"][0][0]],
                embeddings=[embed(merged[:8000])],
                documents=[merged[:1000]],
            )
            return f"Merged into: {meta.get('filename')}  (similarity {similarity:.0%})"

    formatted    = _format(ticket_id, raw_notes, tags)
    problem_line = _extract_problem(formatted)
    date_str     = datetime.now().strftime("%Y-%m-%d")
    filename     = f"{date_str}-{ticket_id.lower()}-{slugify(problem_line)}.md"
    log_path     = LOGS_DIR / filename

    log_path.write_text(formatted, encoding="utf-8")

    doc_id = f"{date_str}-{ticket_id}-{slugify(problem_line)}"
    _collection.add(
        ids=[doc_id],
        embeddings=[vec],
        documents=[raw_notes[:1000]],
        metadatas={
            "filename":  filename,
            "ticket_id": ticket_id,
            "date":      date_str,
            "tags":      json.dumps(tags),
        },
    )

    preview = "\n".join(formatted.splitlines()[:20])
    return f"Logged: {filename}\n\n{preview}\n..."


def cmd_search(query: str, n: int) -> str:
    vec     = embed(query)
    results = _collection.query(
        query_embeddings=[vec],
        n_results=n,
        include=["documents", "metadatas", "distances"],
    )

    if not results["ids"][0]:
        return "No matching knowledge found."

    parts = []
    for doc_id, meta, distance in zip(
        results["ids"][0], results["metadatas"][0], results["distances"][0]
    ):
        similarity = 1.0 - distance
        filename   = meta.get("filename", doc_id)
        log_path   = LOGS_DIR / filename
        excerpt    = (
            _extract_sections(
                log_path.read_text(encoding="utf-8"),
                ["Key Insights", "Solution", "Pitfalls"],
            )
            if log_path.exists()
            else f"[missing: {filename}]"
        )
        parts.append(
            f"### {filename}  ({similarity:.0%} match)\n"
            f"ticket: {meta.get('ticket_id', '?')}  date: {meta.get('date', '?')}\n\n"
            f"{excerpt}"
        )

    return "\n\n---\n\n".join(parts)


def cmd_generate() -> str:
    if not CARDS_SCRIPT.exists():
        return f"Script not found: {CARDS_SCRIPT}"
    result = subprocess.run(
        [
            "python3", str(CARDS_SCRIPT),
            "--new-only",
            "--logs-dir",   str(LOGS_DIR),
            "--output-dir", str(RESEARCH_DIR / "study-cards"),
        ],
        capture_output=True,
        text=True,
        cwd=str(RESEARCH_DIR),
    )
    return (result.stdout + result.stderr).strip() or "Done — no new logs."


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
