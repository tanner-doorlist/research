"""
Postgres access for knowledge-mcp.

Connects to the same study_notifier database used by the Electron app.
Provides read/write for problem_logs and cards tables.
Embeddings stored via pgvector — no external vector DB needed.
"""

import json
import os
import re
import uuid

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/study_notifier",
)


def get_conn():
    return psycopg2.connect(DATABASE_URL)


# ── Problem Logs ─────────────────────────────────────────────────────────────

def get_log_by_filename(filename: str) -> dict | None:
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute("SELECT * FROM problem_logs WHERE filename = %s", (filename,))
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_log(filename: str, date: str | None, log_type: str, problem: str,
               tags: list[str], content: str, embedding: list[float] | None = None):
    with get_conn() as conn, conn.cursor() as cur:
        if embedding is not None:
            vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
            cur.execute(
                """INSERT INTO problem_logs (filename, date, type, problem, tags, content, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                   ON CONFLICT (filename) DO UPDATE SET
                     date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
                     tags = EXCLUDED.tags, content = EXCLUDED.content, embedding = EXCLUDED.embedding""",
                (filename, date, log_type, problem, tags, content, vec_str),
            )
        else:
            cur.execute(
                """INSERT INTO problem_logs (filename, date, type, problem, tags, content)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (filename) DO UPDATE SET
                     date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
                     tags = EXCLUDED.tags, content = EXCLUDED.content""",
                (filename, date, log_type, problem, tags, content),
            )
        conn.commit()


def update_embedding(filename: str, embedding: list[float]):
    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE problem_logs SET embedding = %s::vector WHERE filename = %s",
            (vec_str, filename),
        )
        conn.commit()


def nearest_logs(embedding: list[float], n: int = 1) -> list[dict]:
    """Find the n nearest problem logs by cosine distance. Returns dicts with similarity score."""
    vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(
            """SELECT *, 1 - (embedding <=> %s::vector) AS similarity
               FROM problem_logs
               WHERE embedding IS NOT NULL AND merged_into IS NULL
               ORDER BY embedding <=> %s::vector
               LIMIT %s""",
            (vec_str, vec_str, n),
        )
        return [dict(r) for r in cur.fetchall()]


def mark_log_merged(filename: str, merged_into_filename: str):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE problem_logs SET merged_into = (
                 SELECT id FROM problem_logs WHERE filename = %s
               ) WHERE filename = %s""",
            (merged_into_filename, filename),
        )
        conn.commit()


def get_unprocessed_logs() -> list[dict]:
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(
            """SELECT id, filename, content FROM problem_logs
               WHERE merged_into IS NULL AND cards_generated = false
               ORDER BY date ASC"""
        )
        return [dict(r) for r in cur.fetchall()]


def mark_log_processed(filename: str):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE problem_logs SET cards_generated = true WHERE filename = %s",
            (filename,),
        )
        conn.commit()


# ── Cards ────────────────────────────────────────────────────────────────────

def insert_card(card_id: str, card_type: str, front: str, back: str,
                tags: list[str], when_to_use: str = "", how_it_works: str = "",
                example: str = ""):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT DO NOTHING""",
            (card_id, card_type, front, back, tags, when_to_use, how_it_works, example),
        )
        conn.commit()


def parse_frontmatter(content: str) -> dict:
    """Extract frontmatter fields from a markdown problem log."""
    fm = {}
    m = re.match(r"^---\n([\s\S]*?)\n---", content)
    if m:
        for line in m.group(1).split("\n"):
            idx = line.find(": ")
            if idx > 0:
                fm[line[:idx].strip()] = line[idx + 2:].strip()
    return fm
