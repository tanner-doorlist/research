#!/usr/bin/env python3
"""
index_existing.py

One-time (and idempotent) script to backfill all existing problem-logs/*.md
into ChromaDB. Safe to re-run — already-indexed files are skipped.

Usage:
    python3 index_existing.py
"""

import json
import os
import re
import sys
from pathlib import Path

import chromadb
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).parent / ".env")

RESEARCH_DIR    = Path(os.environ.get("RESEARCH_DIR", Path.home() / "research"))
LOGS_DIR        = RESEARCH_DIR / "problem-logs"
CHROMA_HOST     = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT     = int(os.environ.get("CHROMA_PORT", "8000"))
EMBED_MODEL     = "text-embedding-3-small"
COLLECTION_NAME = "knowledge_logs"

openai_client = OpenAI()
chroma        = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
collection    = chroma.get_or_create_collection(
    COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)


def embed(text: str) -> list[float]:
    resp = openai_client.embeddings.create(
        model=EMBED_MODEL,
        input=text[:8000],
    )
    return resp.data[0].embedding


def parse_frontmatter(content: str) -> dict:
    meta = {}
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            fm = content[3:end]
            for line in fm.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip()] = v.strip().strip('"\'')
    return meta


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", text.lower().strip()))[:50]


def get_indexed_ids() -> set[str]:
    # ChromaDB doesn't expose a simple "list all IDs" on large collections easily,
    # but get() with no filter returns everything (fine at this scale)
    result = collection.get(include=[])
    return set(result["ids"])


def main():
    log_files = sorted(
        p for p in LOGS_DIR.glob("*.md")
        if not p.name.startswith("_")
    )

    if not log_files:
        print("No log files found in", LOGS_DIR)
        sys.exit(0)

    print(f"Found {len(log_files)} log(s) in {LOGS_DIR}")

    indexed = get_indexed_ids()
    print(f"Already indexed: {len(indexed)}")

    to_index = [f for f in log_files if f.stem not in indexed and f.name not in indexed]

    if not to_index:
        print("All logs already indexed.")
        sys.exit(0)

    print(f"Indexing {len(to_index)} new log(s)...\n")

    for log_path in to_index:
        content = log_path.read_text(encoding="utf-8", errors="replace")
        meta    = parse_frontmatter(content)

        date      = meta.get("date", "unknown")
        problem   = meta.get("problem", log_path.stem)
        tags_raw  = meta.get("tags", "[]")

        # Derive a stable doc_id from the filename stem
        doc_id = log_path.stem

        # Embed the full content (or first 8k chars)
        try:
            vec = embed(content)
        except Exception as e:
            print(f"  SKIP {log_path.name}: embed error — {e}")
            continue

        collection.add(
            ids=[doc_id],
            embeddings=[vec],
            documents=[content[:1000]],
            metadatas={
                "filename":  log_path.name,
                "ticket_id": meta.get("ticket_id", ""),
                "date":      date,
                "tags":      tags_raw,
            },
        )

        print(f"  ✓ {log_path.name}  [{date}]  {problem[:60]}")

    print(f"\nDone. {len(to_index)} log(s) indexed.")


if __name__ == "__main__":
    main()
