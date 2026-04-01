"""
Shared utilities for knowledge-scribe.

Contains embedding, text processing, prompt templates, and Claude formatting helpers.
"""

import json
import re
from datetime import datetime

from .ai import anthropic_client, openai_client
from .config import CLAUDE_MODEL, EMBED_MODEL


# ── Embedding ────────────────────────────────────────────────────────────────

def embed(text: str) -> list[float]:
    """Embed text using OpenAI text-embedding-3-small."""
    resp = openai_client.embeddings.create(
        model=EMBED_MODEL,
        input=text[:8000],
    )
    return resp.data[0].embedding


# ── Text helpers ─────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", text.lower().strip()))[:50]


def extract_problem_line(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("problem:"):
            return line.split(":", 1)[1].strip().strip("\"'")
    return "untitled"


def parse_tags(fm: dict) -> list[str]:
    """Parse tags from frontmatter dict (may be JSON string or list)."""
    try:
        parsed = json.loads(fm.get("tags", "[]"))
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def extract_sections(markdown: str, section_names: list[str]) -> str:
    """Pull named ## sections from a markdown log."""
    lines = markdown.splitlines()
    capture = False
    out = []

    for line in lines:
        if line.startswith("## "):
            heading = line[3:].strip()
            capture = any(heading.startswith(s) for s in section_names)
        elif capture:
            out.append(line)

    text = "\n".join(out).strip()
    return text[:800] if text else markdown[:800]


# ── Prompt templates ─────────────────────────────────────────────────────────

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


# ── Claude formatting ────────────────────────────────────────────────────────

def format_with_claude(ticket_id: str, raw_notes: str, tags: list[str]) -> str:
    tag_str = ", ".join(f'"{t}"' for t in tags) if tags else ""
    prompt = FORMAT_PROMPT.format(
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
