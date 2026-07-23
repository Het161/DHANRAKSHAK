from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)


class TTSUnavailable(RuntimeError):
    """Speech could not be synthesised. The caller degrades, never fails."""


class EdgeTTSProvider:
    """Microsoft neural voices over edge-tts.

    Every synthesis opens its own connection and costs roughly a second before
    the first byte, measured, and it does not improve with repeat calls. That is
    why predictable lines are pre-synthesised into the cache and this path is
    reserved for text we could not know in advance.
    """

    name = "edge-tts"

    def __init__(self, timeout_s: float) -> None:
        self._timeout_s = timeout_s
        self._healthy = True

    @property
    def healthy(self) -> bool:
        return self._healthy

    async def stream(self, text: str, voice: str) -> AsyncIterator[bytes]:
        """Yield mp3 chunks as they arrive, so the client can start playing."""
        try:
            import edge_tts
        except ImportError as exc:
            self._healthy = False
            raise TTSUnavailable("edge-tts is not installed") from exc

        try:
            async with asyncio.timeout(self._timeout_s):
                async for chunk in edge_tts.Communicate(text, voice).stream():
                    if chunk["type"] == "audio" and chunk["data"]:
                        yield chunk["data"]
            self._healthy = True
        except asyncio.CancelledError:
            raise
        except TimeoutError as exc:
            self._healthy = False
            raise TTSUnavailable(f"synthesis exceeded {self._timeout_s}s") from exc
        except Exception as exc:
            # Third-party network boundary: any failure degrades to on-device speech.
            self._healthy = False
            raise TTSUnavailable(str(exc)) from exc

    async def synthesize(self, text: str, voice: str) -> bytes:
        """Whole clip in one buffer, for pre-warming the cache."""
        return b"".join([chunk async for chunk in self.stream(text, voice)])
