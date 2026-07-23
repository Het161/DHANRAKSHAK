from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Iterable
from pathlib import Path

from app.config import Settings
from app.schemas.contracts import Gender, Language, TTSHealth
from app.tts.cache import AudioCache
from app.tts.provider import EdgeTTSProvider, TTSUnavailable
from app.tts.registry import VoiceRegistry, discover

logger = logging.getLogger(__name__)

_READ_CHUNK = 16 * 1024


class SpeechService:
    """Cache-first speech synthesis.

    A cache hit is the difference between a call that feels like a phone call
    and one that feels like a web form, so every line we can predict is
    synthesised ahead of time and this class prefers disk over the network.
    """

    def __init__(
        self,
        settings: Settings,
        provider: EdgeTTSProvider,
        cache: AudioCache,
        registry: VoiceRegistry,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.cache = cache
        self.registry = registry

    @classmethod
    async def build(cls, settings: Settings) -> SpeechService:
        registry = await discover(settings.tts_discovery_timeout_s)
        return cls(
            settings=settings,
            provider=EdgeTTSProvider(settings.tts_timeout_s),
            cache=AudioCache(Path(settings.tts_cache_dir), settings.tts_cache_max_bytes),
            registry=registry,
        )

    def voice_for(self, lang: Language, gender: Gender) -> str | None:
        return self.registry.resolve(lang, gender)

    def is_cached(self, text: str, lang: Language, gender: Gender) -> bool:
        voice = self.voice_for(lang, gender)
        return bool(voice) and self.cache.get(text, voice) is not None

    async def stream(self, text: str, lang: Language, gender: Gender) -> AsyncIterator[bytes]:
        """Yield mp3 bytes, from disk when possible.

        Raises TTSUnavailable so the caller can tell the client to fall back to
        on-device speech rather than dropping the call.
        """
        voice = self.voice_for(lang, gender)
        if voice is None:
            raise TTSUnavailable(f"no voice for {lang}/{gender}")

        cached = self.cache.get(text, voice)
        if cached is not None:
            async for chunk in self._read(cached):
                yield chunk
            return

        started = time.perf_counter()
        buffered = bytearray()
        first_byte_ms: float | None = None
        async for chunk in self.provider.stream(text, voice):
            if first_byte_ms is None:
                first_byte_ms = (time.perf_counter() - started) * 1000
            buffered.extend(chunk)
            yield chunk

        logger.info(
            "tts synth lang=%s gender=%s chars=%d first_byte_ms=%s total_ms=%d",
            lang,
            gender,
            len(text),
            f"{first_byte_ms:.0f}" if first_byte_ms is not None else "-",
            int((time.perf_counter() - started) * 1000),
        )
        await asyncio.to_thread(self.cache.put, text, voice, bytes(buffered))

    @staticmethod
    async def _read(path: Path) -> AsyncIterator[bytes]:
        data = await asyncio.to_thread(path.read_bytes)
        for offset in range(0, len(data), _READ_CHUNK):
            yield data[offset : offset + _READ_CHUNK]

    async def prewarm(self, items: Iterable[tuple[str, Language, Gender]]) -> int:
        """Synthesise and cache lines we already know the caller will say.

        Runs in the background, never on a request path. Each clip costs about a
        second, so they go out concurrently; failures are logged and skipped,
        because a missing entry only costs that one line a live synthesis later.
        """
        pending = [
            (text, lang, gender, voice)
            for text, lang, gender in items
            if (voice := self.voice_for(lang, gender)) is not None
            and self.cache.get(text, voice) is None
        ]
        if not pending:
            return 0

        limit = asyncio.Semaphore(self.settings.tts_prewarm_concurrency)
        started = time.perf_counter()

        async def one(text: str, lang: Language, gender: Gender, voice: str) -> bool:
            async with limit:
                try:
                    audio = await self.provider.synthesize(text, voice)
                except TTSUnavailable as exc:
                    logger.warning("tts prewarm failed lang=%s gender=%s error=%s", lang, gender, exc)
                    return False
                return bool(await asyncio.to_thread(self.cache.put, text, voice, audio))

        results = await asyncio.gather(*(one(*item) for item in pending), return_exceptions=True)
        warmed = sum(1 for result in results if result is True)
        logger.info(
            "tts prewarm cached=%d/%d entries=%d elapsed_ms=%d",
            warmed,
            len(pending),
            self.cache.entry_count(),
            int((time.perf_counter() - started) * 1000),
        )
        return warmed

    def health(self) -> TTSHealth:
        return TTSHealth(
            provider=self.provider.name,
            available=self.provider.healthy and bool(self.registry.voices),
            voices_discovered=self.registry.discovered,
            voices=self.registry.as_health(),
            cache_entries=self.cache.entry_count(),
            cache_bytes=self.cache.total_bytes(),
        )
