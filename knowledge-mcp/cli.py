#!/usr/bin/env python3
"""
cli.py — Direct CLI interface to knowledge-scribe.

Used by Claude (Cowork) to log, search, and generate cards
without going through the MCP stdio protocol.

Commands:
    log      --ticket DLE-123 --notes "..." [--tags tag1,tag2]
    search   --query "..." [--n 3]
    generate

Exit codes: 0 = success, 1 = error
Output: plain text to stdout (suitable for reading back in conversation)
"""

import argparse
import sys

from knowledge_scribe.services.cards import process_unprocessed_logs
from knowledge_scribe.services.knowledge import log_knowledge, search_knowledge


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="cli.py")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # log
    p_log = sub.add_parser("log", help="Log knowledge from a ticket")
    p_log.add_argument("--ticket", required=True, help="Ticket ID, e.g. DLE-123")
    p_log.add_argument("--notes", required=True, help="Raw notes (verbose)")
    p_log.add_argument("--tags", default="", help="Comma-separated tags")

    # search
    p_search = sub.add_parser("search", help="Semantic search over logs")
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--n", type=int, default=3)

    # generate
    sub.add_parser("generate", help="Generate study cards from new logs")

    args = parser.parse_args()

    try:
        if args.cmd == "log":
            tags = [t.strip() for t in args.tags.split(",") if t.strip()]
            result = log_knowledge(args.ticket, args.notes, tags)
        elif args.cmd == "search":
            result = search_knowledge(args.query, args.n)
        elif args.cmd == "generate":
            result = process_unprocessed_logs()
        else:
            result = "Unknown command"

        print(result)
        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
