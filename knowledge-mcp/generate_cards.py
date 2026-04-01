#!/usr/bin/env python3
"""
generate_cards.py — Convert unprocessed problem logs into study cards.

This is now a thin wrapper around knowledge_scribe.services.cards.
Can be called as a module (from server.py / cli.py) or standalone:
    python3 generate_cards.py
"""

from knowledge_scribe.services.cards import process_unprocessed_logs

if __name__ == "__main__":
    result = process_unprocessed_logs()
    print(result)
