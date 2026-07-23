from __future__ import annotations

import asyncio
import logging
import struct
from abc import ABC, abstractmethod

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class TranscriptionError(RuntimeError):
    """Audio could not be transcribed. Reported to the caller, never a 500."""


def wav_duration_seconds(data: bytes) -> float | None:
    """Exact duration for RIFF/WAVE, or None for any other container.

    Compressed formats would need a decoder to measure; for those the byte cap
    and the request timeout are what bound the work.
    """
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    offset = 12
    byte_rate = 0
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        (chunk_size,) = struct.unpack_from("<I", data, offset + 4)
        if chunk_id == b"fmt " and offset + 16 <= len(data):
            (byte_rate,) = struct.unpack_from("<I", data, offset + 16)
        elif chunk_id == b"data" and byte_rate:
            return chunk_size / byte_rate
        offset += 8 + chunk_size + (chunk_size & 1)
    return None


class STTProvider(ABC):
    name: str

    @abstractmethod
    async def transcribe(self, data: bytes, filename: str) -> str:
        """Return the transcript, or raise TranscriptionError."""


class GroqSTTProvider(STTProvider):
    """Groq's OpenAI-compatible audio transcription endpoint."""

    name = "groq"

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self._url = f"{settings.groq_base_url.rstrip('/')}/audio/transcriptions"

    async def transcribe(self, data: bytes, filename: str) -> str:
        try:
            response = await self._client.post(
                self._url,
                headers={"Authorization": f"Bearer {self._settings.groq_api_key}"},
                files={"file": (filename, data)},
                data={"model": self._settings.groq_stt_model, "response_format": "json"},
                timeout=self._settings.stt_timeout_s,
            )
        except httpx.HTTPError as exc:
            raise TranscriptionError("The transcription service is unreachable.") from exc

        if response.status_code >= 400:
            logger.warning("groq stt failed status=%d", response.status_code)
            raise TranscriptionError("The recording could not be transcribed.")
        return str(response.json().get("text", "")).strip()


class LocalWhisperProvider(STTProvider):
    """faster-whisper, imported only when this provider is actually selected.

    The import lives inside the method so that the hosted image never needs the
    package installed, and the model is loaded on first use so that startup stays
    fast even in local mode.
    """

    name = "local"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: object | None = None
        self._lock = asyncio.Lock()

    async def _ensure_model(self) -> object:
        async with self._lock:
            if self._model is None:
                try:
                    from faster_whisper import WhisperModel
                except ImportError as exc:
                    raise TranscriptionError(
                        "Local speech recognition is not installed on this server."
                    ) from exc
                logger.info("loading faster-whisper model=%s", self._settings.local_whisper_model)
                self._model = await asyncio.to_thread(
                    WhisperModel,
                    self._settings.local_whisper_model,
                    device="cpu",
                    compute_type=self._settings.local_whisper_compute_type,
                )
            return self._model

    def _transcribe_sync(self, model: object, path: str) -> str:
        segments, _ = model.transcribe(path, beam_size=1, vad_filter=True)
        limit = self._settings.max_audio_seconds
        return " ".join(segment.text for segment in segments if segment.start <= limit).strip()

    async def transcribe(self, data: bytes, filename: str) -> str:
        import tempfile
        from pathlib import Path

        model = await self._ensure_model()
        suffix = Path(filename).suffix or ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as handle:
            handle.write(data)
            handle.flush()
            try:
                return await asyncio.to_thread(self._transcribe_sync, model, handle.name)
            except Exception as exc:
                # Decoder boundary: faster-whisper raises a wide range of types.
                raise TranscriptionError("The recording could not be transcribed.") from exc


def build_stt_provider(settings: Settings, client: httpx.AsyncClient) -> STTProvider | None:
    if settings.stt_provider == "groq":
        if not settings.groq_api_key:
            logger.warning("GROQ_API_KEY unset; audio input disabled")
            return None
        return GroqSTTProvider(client, settings)
    if settings.stt_provider == "local":
        return LocalWhisperProvider(settings)
    return None
