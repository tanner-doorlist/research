"""
Database package for knowledge-scribe.

Exports the PostgresDB implementation and the parse_frontmatter utility.
"""

from .base import KnowledgeDB
from .postgres import PostgresDB, parse_frontmatter

# Default singleton instance
_default_db: PostgresDB | None = None


def get_db() -> PostgresDB:
    """Get the default PostgresDB singleton."""
    global _default_db
    if _default_db is None:
        _default_db = PostgresDB()
    return _default_db


__all__ = ["KnowledgeDB", "PostgresDB", "parse_frontmatter", "get_db"]
