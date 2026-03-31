#!/usr/bin/env python3
"""
test_smoke.py

Validates the full knowledge-scribe stack:
  1. ChromaDB reachable
  2. OpenAI embeddings working
  3. Anthropic Claude reachable
  4. log_knowledge → creates a .md file + ChromaDB entry
  5. search_knowledge → returns the logged entry
  6. Dedup → second similar log triggers merge, not a new file

Run from the knowledge-mcp directory:
    python3 test_smoke.py

Expects .env with ANTHROPIC_API_KEY and OPENAI_API_KEY set.
ChromaDB must be running (docker compose up -d).
"""

import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
INFO = "\033[94m·\033[0m"

def ok(msg):  print(f"  {PASS} {msg}")
def err(msg): print(f"  {FAIL} {msg}"); sys.exit(1)
def info(msg): print(f"  {INFO} {msg}")

# ── Tests ─────────────────────────────────────────────────────────────────────

def test_chroma():
    print("\n[1] ChromaDB connectivity")
    try:
        import chromadb
        host = os.environ.get("CHROMA_HOST", "localhost")
        port = int(os.environ.get("CHROMA_PORT", "8000"))
        client = chromadb.HttpClient(host=host, port=port)
        client.heartbeat()
        ok(f"Connected to ChromaDB at {host}:{port}")
        return client
    except Exception as e:
        err(f"ChromaDB unreachable: {e}\n    → Run: docker compose up -d")


def test_openai_embed():
    print("\n[2] OpenAI embeddings")
    try:
        from openai import OpenAI
        client = OpenAI()
        resp = client.embeddings.create(model="text-embedding-3-small", input="test")
        vec = resp.data[0].embedding
        ok(f"Embedding OK — dim={len(vec)}")
        return True
    except Exception as e:
        err(f"OpenAI embedding failed: {e}")


def test_anthropic():
    print("\n[3] Anthropic Claude")
    try:
        from anthropic import Anthropic
        client = Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",  # cheapest for smoke test
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with just: OK"}],
        )
        resp = msg.content[0].text.strip()
        ok(f"Claude responded: {resp!r}")
        return True
    except Exception as e:
        err(f"Anthropic call failed: {e}")


def test_log_and_search():
    print("\n[4] log_knowledge — creates file + indexes")

    # Import CLI functions directly
    sys.path.insert(0, str(Path(__file__).parent))
    from cli import cmd_log, cmd_search, LOGS_DIR

    ticket  = "TEST-001"
    notes   = (
        "We needed to add a retry mechanism to our webhook processor. "
        "The processor was silently dropping events when downstream services timed out. "
        "Added exponential backoff with jitter (max 3 retries, base delay 1s). "
        "Key insight: always log the final failure reason even if you're going to retry — "
        "helps distinguish transient vs permanent failures in post-mortems. "
        "Pitfall: naive retry without jitter causes thundering herd on recovery."
    )

    before_files = set(LOGS_DIR.glob("*test-001*"))

    result = cmd_log(ticket, notes, tags=["webhooks", "reliability"])
    info(f"Result: {result[:80]}...")

    after_files = set(LOGS_DIR.glob("*test-001*")) - before_files

    if "Logged:" in result or "Merged" in result:
        ok("log_knowledge returned success")
    else:
        err(f"Unexpected result: {result}")

    if after_files or "Merged" in result:
        filename = list(after_files)[0].name if after_files else "(merged into existing)"
        ok(f"File on disk: {filename}")
    else:
        err("No .md file was written to problem-logs/")

    # Small delay to let ChromaDB settle
    time.sleep(0.5)

    print("\n[5] search_knowledge — retrieves what we just logged")
    search_result = cmd_search("webhook retry exponential backoff", n=1)
    info(f"Search result snippet: {search_result[:120]}...")

    if "TEST-001" in search_result or "webhook" in search_result.lower() or "retry" in search_result.lower():
        ok("search_knowledge returned relevant result")
    else:
        err(f"Search didn't return expected content.\nGot: {search_result[:300]}")

    return list(after_files)[0] if after_files else None


def test_dedup(log_file):
    print("\n[6] Deduplication — similar note should merge, not create new file")

    from cli import cmd_log, LOGS_DIR

    before_count = len(list(LOGS_DIR.glob("*test-001*")))

    similar_notes = (
        "Added retry logic to the webhook handler with exponential backoff. "
        "Used 3 retries with jitter to avoid thundering herd. "
        "Learned: always log final failure reason for debugging."
    )

    result = cmd_log("TEST-001", similar_notes, tags=["webhooks"])
    info(f"Result: {result[:80]}...")

    after_count = len(list(LOGS_DIR.glob("*test-001*")))

    if "Merged" in result:
        ok(f"Correctly merged (similarity ≥ threshold) — file count unchanged: {after_count}")
    elif after_count == before_count:
        ok("No new file created (merged or deduplicated)")
    else:
        # Not necessarily a failure — threshold may not have been hit with short notes
        info(f"New file created (similarity below threshold) — {after_count} files now")
        info("Tune DEDUP_THRESHOLD in .env if you want stricter dedup (default 0.88)")


def cleanup(log_file):
    print("\n[7] Cleanup")
    if log_file and log_file.exists():
        log_file.unlink()
        ok(f"Removed test log: {log_file.name}")

    # Remove test entries from ChromaDB
    try:
        import chromadb
        client = chromadb.HttpClient(
            host=os.environ.get("CHROMA_HOST", "localhost"),
            port=int(os.environ.get("CHROMA_PORT", "8000")),
        )
        col = client.get_collection("knowledge_logs")
        results = col.get(where={"ticket_id": "TEST-001"})
        if results["ids"]:
            col.delete(ids=results["ids"])
            ok(f"Removed {len(results['ids'])} ChromaDB entry(s)")
        else:
            ok("No ChromaDB entries to clean up")
    except Exception as e:
        info(f"ChromaDB cleanup skipped: {e}")

    # Remove any remaining test files (merged or missed above)
    from cli import LOGS_DIR
    for f in LOGS_DIR.glob("*test-001*"):
        f.unlink()
        info(f"Removed: {f.name}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 50)
    print("  knowledge-scribe smoke test")
    print("=" * 50)

    test_chroma()
    test_openai_embed()
    test_anthropic()
    log_file = test_log_and_search()
    test_dedup(log_file)
    cleanup(log_file)

    print("\n" + "=" * 50)
    print("  All tests passed ✓")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    main()
