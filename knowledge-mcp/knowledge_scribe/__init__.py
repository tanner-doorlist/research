"""
knowledge_scribe — Core package for the knowledge-scribe system.
"""

from . import ai, config, core
from .core import (
    embed,
    extract_problem_line,
    extract_sections,
    format_with_claude,
    merge_with_claude,
    parse_tags,
    slugify,
)
from .config import CLAUDE_MODEL, DEDUP_THRESHOLD, EMBED_MODEL

__all__ = [
    "ai",
    "config",
    "core",
    "embed",
    "extract_problem_line",
    "extract_sections",
    "format_with_claude",
    "merge_with_claude",
    "parse_tags",
    "slugify",
    "CLAUDE_MODEL",
    "DEDUP_THRESHOLD",
    "EMBED_MODEL",
]
