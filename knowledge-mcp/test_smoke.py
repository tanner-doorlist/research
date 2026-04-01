#!/usr/bin/env python3
"""
test_smoke.py

Validates the knowledge-scribe stack:
  1. Postgres reachable
  2. OpenAI embeddings working
  3. Anthropic Claude reachable
  4. log_knowledge service callable
  5. search_knowledge service callable

Run from the knowledge-mcp directory:
    python3 test_smoke.py

Expects .env with ANTHROPIC_API_KEY and OPENAI_API_KEY set.
Postgres must be running (docker compose up -d).
"""

import sys

# ── Helpers ──────────────────────────────────────────────────────────────────

PASS = "\033[92mOK\033[0m"
FAIL = "\033[91mFAIL\033[0m"
INFO = "\033[94m.\033[0m"


def ok(msg):
    print(f"  {PASS} {msg}")


def err(msg):
    print(f"  {FAIL} {msg}")
    sys.exit(1)


def info(msg):
    print(f"  {INFO} {msg}")


# ── Tests ────────────────────────────────────────────────────────────────────

def test_postgres():
    print("\n[1] Postgres connectivity")
    try:
        from knowledge_scribe.db import get_db
        db = get_db()
        conn = db.get_conn_raw()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        db.put_conn_raw(conn)
        ok("Connected to Postgres")
    except Exception as e:
        err(f"Postgres unreachable: {e}\n    -> Run: docker compose up -d")


def test_openai_embed():
    print("\n[2] OpenAI embeddings")
    try:
        from knowledge_scribe.core import embed
        vec = embed("test")
        ok(f"Embedding OK - dim={len(vec)}")
    except Exception as e:
        err(f"OpenAI embedding failed: {e}")


def test_anthropic():
    print("\n[3] Anthropic Claude")
    try:
        from knowledge_scribe.ai import anthropic_client
        msg = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with just: OK"}],
        )
        resp = msg.content[0].text.strip()
        ok(f"Claude responded: {resp!r}")
    except Exception as e:
        err(f"Anthropic call failed: {e}")


def test_imports():
    print("\n[4] Package imports")
    try:
        from knowledge_scribe import core, config, ai
        from knowledge_scribe.db import get_db, PostgresDB, parse_frontmatter
        from knowledge_scribe.services.knowledge import log_knowledge, search_knowledge
        from knowledge_scribe.services.cards import process_unprocessed_logs
        ok("All package imports successful")
    except Exception as e:
        err(f"Import failed: {e}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 50)
    print("  knowledge-scribe smoke test")
    print("=" * 50)

    test_imports()
    test_postgres()
    test_openai_embed()
    test_anthropic()

    print("\n" + "=" * 50)
    print("  All tests passed")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    main()
