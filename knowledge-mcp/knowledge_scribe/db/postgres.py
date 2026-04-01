"""
Postgres + pgvector implementation of KnowledgeDB.
"""

import logging
import re

import psycopg2
import psycopg2.extras
import psycopg2.pool

from ..config import DATABASE_URL
from .base import KnowledgeDB

logger = logging.getLogger(__name__)


def _vec_to_str(embedding: list[float]) -> str:
    """Convert a list of floats to a pgvector-compatible string."""
    return "[" + ",".join(str(v) for v in embedding) + "]"


def parse_frontmatter(content: str) -> dict:
    """Extract frontmatter fields from a markdown problem log."""
    fm = {}
    m = re.match(r"^---\n([\s\S]*?)\n---", content)
    if m:
        for line in m.group(1).split("\n"):
            idx = line.find(": ")
            if idx > 0:
                fm[line[:idx].strip()] = line[idx + 2:].strip()
    return fm


class PostgresDB(KnowledgeDB):
    """Postgres + pgvector knowledge store with connection pooling."""

    def __init__(self, database_url: str | None = None):
        self._database_url = database_url or DATABASE_URL
        self._pool = psycopg2.pool.SimpleConnectionPool(
            minconn=1, maxconn=5, dsn=self._database_url,
        )

    def _get_conn(self):
        return self._pool.getconn()

    def _put_conn(self, conn):
        self._pool.putconn(conn)

    def ensure_schema(self) -> None:
        """No-op — schema is managed by the Electron app / migrations."""
        pass

    def get_log_by_filename(self, filename: str) -> dict | None:
        conn = self._get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("SELECT * FROM problem_logs WHERE filename = %s", (filename,))
                row = cur.fetchone()
                return dict(row) if row else None
        except Exception:
            logger.exception("get_log_by_filename failed for %s", filename)
            raise
        finally:
            self._put_conn(conn)

    def upsert_log(self, filename: str, date: str | None, log_type: str,
                   problem: str, tags: list[str], content: str,
                   embedding: list[float] | None = None,
                   repo: str | None = None) -> None:
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                if embedding is not None:
                    vec_str = _vec_to_str(embedding)
                    cur.execute(
                        """INSERT INTO problem_logs (filename, date, type, problem, tags, content, embedding, repo)
                           VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)
                           ON CONFLICT (filename) DO UPDATE SET
                             date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
                             tags = EXCLUDED.tags, content = EXCLUDED.content, embedding = EXCLUDED.embedding,
                             repo = COALESCE(EXCLUDED.repo, problem_logs.repo)""",
                        (filename, date, log_type, problem, tags, content, vec_str, repo),
                    )
                else:
                    cur.execute(
                        """INSERT INTO problem_logs (filename, date, type, problem, tags, content, repo)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)
                           ON CONFLICT (filename) DO UPDATE SET
                             date = EXCLUDED.date, type = EXCLUDED.type, problem = EXCLUDED.problem,
                             tags = EXCLUDED.tags, content = EXCLUDED.content,
                             repo = COALESCE(EXCLUDED.repo, problem_logs.repo)""",
                        (filename, date, log_type, problem, tags, content, repo),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("upsert_log failed for %s", filename)
            raise
        finally:
            self._put_conn(conn)

    def update_log_embedding(self, filename: str, embedding: list[float]) -> None:
        vec_str = _vec_to_str(embedding)
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE problem_logs SET embedding = %s::vector WHERE filename = %s",
                    (vec_str, filename),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("update_log_embedding failed for %s", filename)
            raise
        finally:
            self._put_conn(conn)

    def nearest_logs(self, embedding: list[float], n: int = 1) -> list[dict]:
        vec_str = _vec_to_str(embedding)
        conn = self._get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """SELECT *, 1 - (embedding <=> %s::vector) AS similarity
                       FROM problem_logs
                       WHERE embedding IS NOT NULL AND merged_into IS NULL
                       ORDER BY embedding <=> %s::vector
                       LIMIT %s""",
                    (vec_str, vec_str, n),
                )
                return [dict(r) for r in cur.fetchall()]
        except Exception:
            logger.exception("nearest_logs failed")
            raise
        finally:
            self._put_conn(conn)

    def search_logs(self, embedding: list[float], n: int = 3) -> list[dict]:
        return self.nearest_logs(embedding, n=n)

    def get_unprocessed_logs(self) -> list[dict]:
        conn = self._get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """SELECT id, filename, content, repo FROM problem_logs
                       WHERE merged_into IS NULL AND cards_generated = false
                       ORDER BY date ASC"""
                )
                return [dict(r) for r in cur.fetchall()]
        except Exception:
            logger.exception("get_unprocessed_logs failed")
            raise
        finally:
            self._put_conn(conn)

    def mark_cards_generated(self, filename: str) -> None:
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE problem_logs SET cards_generated = true WHERE filename = %s",
                    (filename,),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("mark_cards_generated failed for %s", filename)
            raise
        finally:
            self._put_conn(conn)

    def insert_card(self, card_id: str, card_type: str, front: str, back: str,
                    tags: list[str], when_to_use: str = "",
                    how_it_works: str = "", example: str = "",
                    repo: str | None = None) -> None:
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO cards (id, type, front, back, tags, when_to_use, how_it_works, example, repo)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT DO NOTHING""",
                    (card_id, card_type, front, back, tags, when_to_use, how_it_works, example, repo),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("insert_card failed for %s", card_id)
            raise
        finally:
            self._put_conn(conn)

    def get_conn_raw(self):
        """Get a raw psycopg2 connection (for scripts that need direct access)."""
        return self._get_conn()

    def put_conn_raw(self, conn):
        """Return a raw connection to the pool."""
        self._put_conn(conn)
