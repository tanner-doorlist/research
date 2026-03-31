#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> knowledge-scribe setup"

# 1. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env — fill in ANTHROPIC_API_KEY and OPENAI_API_KEY"
else
  echo "    .env already exists, skipping"
fi

# 2. Python deps
echo "==> Installing Python dependencies"
pip install -r requirements.txt --quiet

# 3. Start ChromaDB
echo "==> Starting ChromaDB (Docker)"
docker compose up -d
echo "    Waiting for ChromaDB to be ready..."
until curl -sf http://localhost:8000/api/v1/heartbeat > /dev/null; do
  sleep 1
done
echo "    ChromaDB is up"

# 4. Index existing logs
echo "==> Indexing existing problem logs"
python3 index_existing.py

echo ""
echo "Done. Add this to your Cursor MCP config (.cursor/mcp.json):"
echo ""
cat cursor-mcp-config.json
echo ""
