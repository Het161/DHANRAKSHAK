from __future__ import annotations

import hashlib
import logging

from cachetools import TTLCache

from app.schemas.contracts import AnalyzeResponse, Language

logger = logging.getLogger(__name__)


class ResponseCache:
    """Bounded in-memory cache of completed analyses.

    Purpose is cost and latency: a judge pasting the same demo message twice must
    not spend Groq quota twice. Entries live in RAM only, expire on a timer, and
    are never written to disk; set CACHE_SIZE=0 to switch the cache off entirely.
    """

    def __init__(self, size: int, ttl_s: int) -> None:
        self._enabled = size > 0
        self._cache: TTLCache[str, tuple[AnalyzeResponse, str, str]] = TTLCache(
            maxsize=max(size, 1), ttl=ttl_s
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    @staticmethod
    def key(text: str, lang: Language) -> str:
        return hashlib.sha256(f"{lang}\x00{text}".encode()).hexdigest()

    def get(self, key: str) -> tuple[AnalyzeResponse, str, str] | None:
        if not self._enabled:
            return None
        return self._cache.get(key)

    def put(self, key: str, response: AnalyzeResponse, explanation: str, source: str) -> None:
        if self._enabled:
            self._cache[key] = (response, explanation, source)
