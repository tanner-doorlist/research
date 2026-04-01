"""
Centralized configuration for knowledge-scribe.

All settings are read from environment variables with sensible defaults.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the knowledge-mcp directory
load_dotenv(Path(__file__).parent.parent / ".env")


def _float_env(key: str, default: str) -> float:
    raw = os.environ.get(key, default)
    try:
        val = float(raw)
    except (ValueError, TypeError):
        val = float(default)
    if not 0.0 <= val <= 1.0:
        val = float(default)
    return val


# AI models
EMBED_MODEL = os.environ.get("EMBED_MODEL", "text-embedding-3-small")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")

# Dedup
DEDUP_THRESHOLD = _float_env("DEDUP_THRESHOLD", "0.88")

# Database
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/study_notifier",
)

# API keys (read by SDK clients from env automatically, but exposed here for validation)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
