#!/usr/bin/env python3
"""
index_existing.py

Backfill embeddings for problem_logs rows that don't have one yet.
Safe to re-run — only processes rows where embedding IS NULL.

Usage:
    python3 index_existing.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

import db as pgdb

load_dotenv(Path(__file__).parent / ".env")

EMBED_MODEL = "text-embedding-3-small"
openai_client = OpenAI()


def embed(text: str) -> list[float]:
    resp = openai_client.embeddings.create(
        model=EMBED_MODEL,
        input=text[:8000],
    )
    return resp.data[0].embedding


def main():
    conn = pgdb.get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT filename, content FROM problem_logs WHERE embedding IS NULL AND merged_into IS NULL"
        )
        rows = cur.fetchall()
    conn.close()

    if not rows:
        print("All logs already have embeddings.")
        sys.exit(0)

    print(f"Backfilling embeddings for {len(rows)} log(s)...\n")

    for filename, content in rows:
        try:
            vec = embed(content)
            pgdb.update_embedding(filename, vec)
            print(f"  + {filename}")
        except Exception as e:
            print(f"  SKIP {filename}: {e}")

    print(f"\nDone. {len(rows)} log(s) processed.")


if __name__ == "__main__":
    main()
