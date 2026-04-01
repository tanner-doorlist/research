#!/usr/bin/env python3
"""
index_existing.py

Backfill embeddings for problem_logs rows that don't have one yet.
Safe to re-run — only processes rows where embedding IS NULL.

Usage:
    python3 index_existing.py
"""

import sys

from knowledge_scribe.core import embed
from knowledge_scribe.db import get_db


def main():
    db = get_db()
    conn = db.get_conn_raw()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT filename, content FROM problem_logs WHERE embedding IS NULL AND merged_into IS NULL"
            )
            rows = cur.fetchall()
    finally:
        db.put_conn_raw(conn)

    if not rows:
        print("All logs already have embeddings.")
        sys.exit(0)

    print(f"Backfilling embeddings for {len(rows)} log(s)...\n")

    for filename, content in rows:
        try:
            vec = embed(content)
            db.update_log_embedding(filename, vec)
            print(f"  + {filename}")
        except Exception as e:
            print(f"  SKIP {filename}: {e}")

    print(f"\nDone. {len(rows)} log(s) processed.")


if __name__ == "__main__":
    main()
