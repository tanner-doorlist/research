"""
Backwards-compatibility shim.

All DB logic has moved to knowledge_scribe.db.
This module re-exports the same interface so existing imports keep working.
"""

from knowledge_scribe.db import get_db, parse_frontmatter

_db = get_db()

# Re-export functions matching the old module-level API
get_conn = lambda: _db.get_conn_raw()
get_log_by_filename = _db.get_log_by_filename
upsert_log = _db.upsert_log
update_embedding = _db.update_log_embedding
nearest_logs = _db.nearest_logs
mark_log_merged = lambda filename, merged_into: None  # unused in current code
get_unprocessed_logs = _db.get_unprocessed_logs
mark_log_processed = _db.mark_cards_generated
insert_card = _db.insert_card

__all__ = [
    "get_conn",
    "get_log_by_filename",
    "upsert_log",
    "update_embedding",
    "nearest_logs",
    "mark_log_merged",
    "get_unprocessed_logs",
    "mark_log_processed",
    "insert_card",
    "parse_frontmatter",
]
