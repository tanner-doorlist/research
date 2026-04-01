"""
Business logic for logging and searching knowledge.
"""

from datetime import datetime

from ..config import DEDUP_THRESHOLD
from ..core import (
    embed,
    extract_problem_line,
    extract_sections,
    format_with_claude,
    merge_with_claude,
    parse_tags,
    slugify,
)
from ..db import get_db, parse_frontmatter


def log_knowledge(ticket_id: str, raw_notes: str, tags: list[str] | None = None) -> str:
    """
    Format, deduplicate, and persist a knowledge log.

    Returns a summary string.
    """
    tags = tags or []
    db = get_db()

    embed_input = f"{ticket_id}\n{raw_notes}"
    vec = embed(embed_input)

    # Check for near-duplicate via pgvector
    nearest = db.nearest_logs(vec, n=1)

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
            fm = parse_frontmatter(merged)
            db.upsert_log(
                filename=existing_filename,
                date=fm.get("date"),
                log_type=fm.get("type", "coding"),
                problem=fm.get("problem", existing_filename),
                tags=parse_tags(fm),
                content=merged,
                embedding=merged_vec,
            )

            return (
                f"Merged into existing log: {existing_filename}\n"
                f"Similarity: {similarity:.0%}"
            )

    # Format fresh log
    formatted = format_with_claude(ticket_id, raw_notes, tags)
    problem_line = extract_problem_line(formatted)
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"{date_str}-{ticket_id.lower()}-{slugify(problem_line)}.md"

    # Parse frontmatter for structured storage
    fm = parse_frontmatter(formatted)

    # Write to Postgres with embedding
    db.upsert_log(
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


def search_knowledge(query: str, n_results: int = 3) -> str:
    """
    Semantic search over all indexed knowledge logs.

    Returns formatted results string.
    """
    db = get_db()
    vec = embed(query)
    results = db.nearest_logs(vec, n=n_results)

    if not results:
        return "No matching knowledge found."

    parts = []
    for row in results:
        similarity = row["similarity"]
        filename = row["filename"]
        excerpt = extract_sections(
            row["content"], ["Key Insights", "Solution", "Pitfalls"]
        )

        parts.append(
            f"### {filename}  (similarity {similarity:.0%})\n"
            f"date: {row.get('date', '?')}\n\n"
            f"{excerpt}"
        )

    return "\n\n---\n\n".join(parts)
