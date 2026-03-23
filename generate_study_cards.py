#!/usr/bin/env python3
"""
generate_study_cards.py

Reads problem logs from the problem-logs/ directory and uses Claude to generate:
  1. Anki-compatible Q&A cards  (study-cards/qa_cards.tsv)
  2. Concept / mental model cards  (study-cards/concept_cards.tsv)
  3. A human-readable review file  (study-cards/review.md)

Usage:
    python generate_study_cards.py [--logs-dir ./problem-logs] [--output-dir ./study-cards] [--new-only]

Options:
    --logs-dir    Path to problem logs directory (default: ./problem-logs)
    --output-dir  Path to write study cards (default: ./study-cards)
    --new-only    Only process logs not yet in the processed index
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import anthropic

# ── Config ────────────────────────────────────────────────────────────────────
MODEL         = "claude-sonnet-4-6"
MAX_TOKENS    = 4096
INDEX_FILE    = ".processed_logs.json"   # tracks which logs have been converted


# ── Prompts ───────────────────────────────────────────────────────────────────

CARD_GENERATION_PROMPT = """You are a Socratic tutor creating study cards from a problem-solving log.

## Problem Log

{log_content}

## Task

Generate two types of study cards from this log:

### 1. Q&A Cards (3–6 cards)
Each card tests whether the learner could solve or reason through a similar problem themselves.
Cards should probe:
- The core diagnostic or reasoning step (not just the answer)
- Why a particular approach was chosen over alternatives
- What symptom or signal pointed toward the solution
- Any pitfall or wrong assumption to avoid

Format each card as:
Q: <question>
A: <answer>
---

### 2. Concept Cards (2–4 cards)
Each card captures one reusable mental model, heuristic, or technique revealed by this problem.
The concept should be general enough to apply beyond this specific case.

Format each card as:
CONCEPT: <name of the concept/heuristic>
WHEN TO USE: <one sentence — what situations call for this>
HOW IT WORKS: <2-3 sentences explaining the mental model or technique>
EXAMPLE: <one concrete example from the log>
---

Output exactly this JSON structure — no markdown fences, no extra text:

{{
  "qa_cards": [
    {{"front": "question text", "back": "answer text", "tags": ["tag1", "tag2"]}}
  ],
  "concept_cards": [
    {{
      "concept": "concept name",
      "when_to_use": "...",
      "how_it_works": "...",
      "example": "..."
    }}
  ]
}}
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_index(output_dir: Path) -> set:
    index_path = output_dir / INDEX_FILE
    if index_path.exists():
        return set(json.loads(index_path.read_text()))
    return set()


def save_index(output_dir: Path, processed: set):
    index_path = output_dir / INDEX_FILE
    index_path.write_text(json.dumps(sorted(processed), indent=2))


def get_log_files(logs_dir: Path) -> list[Path]:
    return sorted(
        p for p in logs_dir.glob("*.md")
        if not p.name.startswith("_")   # skip _TEMPLATE.md etc.
    )


def call_claude(log_content: str) -> dict:
    client = anthropic.Anthropic()
    message = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{
            "role": "user",
            "content": CARD_GENERATION_PROMPT.format(log_content=log_content)
        }]
    )
    raw = message.content[0].text.strip()
    # Strip accidental markdown fences
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(raw)


def append_tsv(path: Path, rows: list[list[str]]):
    with open(path, "a", encoding="utf-8") as f:
        for row in rows:
            f.write("\t".join(row) + "\n")


def append_review(path: Path, log_name: str, cards: dict):
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"\n---\n\n## {log_name}\n\n")

        if cards.get("qa_cards"):
            f.write("### Q&A Cards\n\n")
            for card in cards["qa_cards"]:
                f.write(f"**Q:** {card['front']}\n\n")
                f.write(f"**A:** {card['back']}\n\n")

        if cards.get("concept_cards"):
            f.write("### Concept Cards\n\n")
            for card in cards["concept_cards"]:
                f.write(f"**{card['concept']}**\n\n")
                f.write(f"- *When to use:* {card['when_to_use']}\n")
                f.write(f"- *How it works:* {card['how_it_works']}\n")
                f.write(f"- *Example:* {card['example']}\n\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate study cards from problem logs.")
    parser.add_argument("--logs-dir",   default="./problem-logs",  help="Path to problem logs")
    parser.add_argument("--output-dir", default="./study-cards",   help="Path to write cards")
    parser.add_argument("--new-only",   action="store_true",        help="Skip already-processed logs")
    args = parser.parse_args()

    logs_dir   = Path(args.logs_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    log_files = get_log_files(logs_dir)
    if not log_files:
        print("No log files found.")
        sys.exit(0)

    processed = load_index(output_dir) if args.new_only else set()
    to_process = [f for f in log_files if f.name not in processed]

    if not to_process:
        print("All logs already processed. Use without --new-only to regenerate.")
        sys.exit(0)

    print(f"Processing {len(to_process)} log(s)…\n")

    # Output file paths
    qa_tsv      = output_dir / "qa_cards.tsv"
    concept_tsv = output_dir / "concept_cards.tsv"
    review_md   = output_dir / "review.md"

    # Write headers on first run
    if not qa_tsv.exists():
        qa_tsv.write_text("front\tback\ttags\n")
    if not concept_tsv.exists():
        concept_tsv.write_text("concept\twhen_to_use\thow_it_works\texample\n")
    if not review_md.exists():
        review_md.write_text(f"# Study Card Review\n_Generated {datetime.now().strftime('%Y-%m-%d')}_\n")

    for log_path in to_process:
        print(f"  → {log_path.name}")
        content = log_path.read_text(errors="replace")

        try:
            cards = call_claude(content)
        except Exception as exc:
            print(f"    ERROR: {exc}")
            continue

        # Append Q&A rows
        qa_rows = [
            [c["front"], c["back"], " ".join(c.get("tags", []))]
            for c in cards.get("qa_cards", [])
        ]
        append_tsv(qa_tsv, qa_rows)

        # Append concept rows
        concept_rows = [
            [c["concept"], c["when_to_use"], c["how_it_works"], c["example"]]
            for c in cards.get("concept_cards", [])
        ]
        append_tsv(concept_tsv, concept_rows)

        # Append to human-readable review
        append_review(review_md, log_path.stem, cards)

        processed.add(log_path.name)
        qa_count      = len(qa_rows)
        concept_count = len(concept_rows)
        print(f"    {qa_count} Q&A card(s), {concept_count} concept card(s)")

    save_index(output_dir, processed)

    print(f"\nDone.")
    print(f"  Q&A cards    → {qa_tsv}")
    print(f"  Concept cards → {concept_tsv}")
    print(f"  Review        → {review_md}")
    print(f"\nTo import into Anki: File → Import → select qa_cards.tsv (tab-separated, fields: front / back / tags)")


if __name__ == "__main__":
    main()
