"""
Business logic for generating study cards from problem logs.
"""

import json
import uuid

from ..ai import anthropic_client
from ..config import CLAUDE_MODEL
from ..db import get_db

CARD_GENERATION_PROMPT = """You are a Socratic tutor creating study cards from a problem-solving log.

## Problem Log

{log_content}

## Task

Generate two types of study cards from this log:

### 1. Q&A Cards (3-6 cards)
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

### 2. Concept Cards (2-4 cards)
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

MAX_TOKENS = 4096


def _call_claude(log_content: str) -> dict:
    """Ask Claude to generate cards from a problem log."""
    message = anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{
            "role": "user",
            "content": CARD_GENERATION_PROMPT.format(log_content=log_content),
        }],
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(raw)


def process_unprocessed_logs() -> str:
    """Process all unprocessed logs and return a summary string."""
    db = get_db()
    logs = db.get_unprocessed_logs()
    if not logs:
        return "No unprocessed logs found."

    total_qa = 0
    total_concept = 0

    for log in logs:
        filename = log["filename"]
        content = log["content"]
        print(f"  -> {filename}")

        try:
            cards = _call_claude(content)
        except Exception as exc:
            print(f"    ERROR: {exc}")
            continue

        # Insert Q&A cards
        for c in cards.get("qa_cards", []):
            card_id = str(uuid.uuid4())
            card_tags = c.get("tags", [])
            db.insert_card(
                card_id=card_id,
                card_type="qa",
                front=c["front"],
                back=c["back"],
                tags=card_tags,
            )
            total_qa += 1

        # Insert concept cards
        for c in cards.get("concept_cards", []):
            card_id = str(uuid.uuid4())
            when = c.get("when_to_use", "")
            how = c.get("how_it_works", "")
            example = c.get("example", "")
            back_parts = [
                when and f"**When:** {when}",
                how and f"**How:** {how}",
                example and f"**Example:** {example}",
            ]
            back = "\n\n".join(p for p in back_parts if p) or how
            db.insert_card(
                card_id=card_id,
                card_type="concept",
                front=c["concept"],
                back=back,
                tags=["concept"],
                when_to_use=when,
                how_it_works=how,
                example=example,
            )
            total_concept += 1

        db.mark_cards_generated(filename)
        print(f"    {len(cards.get('qa_cards', []))} Q&A, {len(cards.get('concept_cards', []))} concept")

    return f"Generated {total_qa} Q&A cards and {total_concept} concept cards from {len(logs)} log(s)."
