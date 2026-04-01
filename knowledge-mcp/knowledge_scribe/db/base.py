"""
Abstract base class for the knowledge database.
"""

from abc import ABC, abstractmethod


class KnowledgeDB(ABC):
    """Interface for knowledge storage backends."""

    @abstractmethod
    def get_log_by_filename(self, filename: str) -> dict | None:
        ...

    @abstractmethod
    def upsert_log(self, filename: str, date: str | None, log_type: str,
                   problem: str, tags: list[str], content: str,
                   embedding: list[float] | None = None) -> None:
        ...

    @abstractmethod
    def update_log_embedding(self, filename: str, embedding: list[float]) -> None:
        ...

    @abstractmethod
    def nearest_logs(self, embedding: list[float], n: int = 1) -> list[dict]:
        ...

    @abstractmethod
    def get_unprocessed_logs(self) -> list[dict]:
        ...

    @abstractmethod
    def mark_cards_generated(self, filename: str) -> None:
        ...

    @abstractmethod
    def insert_card(self, card_id: str, card_type: str, front: str, back: str,
                    tags: list[str], when_to_use: str = "",
                    how_it_works: str = "", example: str = "") -> None:
        ...

    @abstractmethod
    def search_logs(self, embedding: list[float], n: int = 3) -> list[dict]:
        """Alias for nearest_logs — semantic search over logs."""
        ...

    @abstractmethod
    def ensure_schema(self) -> None:
        """Ensure required tables/extensions exist."""
        ...
