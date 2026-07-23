from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_THINK_OPEN = re.compile(r"<think>", re.IGNORECASE)
_THINK_CLOSE = re.compile(r"</think>", re.IGNORECASE)


class ProviderError(RuntimeError):
    """Any failure to obtain text from an LLM. Always recoverable by the caller."""


async def without_thinking(stream: AsyncIterator[str]) -> AsyncIterator[str]:
    """Drop reasoning blocks that some open models emit before their answer.

    Buffering is bounded: only a partial `<think` prefix is ever held back, so a
    model that never emits one streams with no added latency.
    """
    buffer = ""
    inside = False
    async for chunk in stream:
        buffer += chunk
        while buffer:
            if inside:
                match = _THINK_CLOSE.search(buffer)
                if not match:
                    buffer = ""
                    break
                buffer = buffer[match.end() :]
                inside = False
                continue
            match = _THINK_OPEN.search(buffer)
            if match:
                if match.start():
                    yield buffer[: match.start()]
                buffer = buffer[match.end() :]
                inside = True
                continue
            # Hold back anything that could still turn into an opening tag.
            safe_upto = len(buffer)
            for size in range(min(len(buffer), 7), 0, -1):
                if "<think>".startswith(buffer[-size:].lower()):
                    safe_upto = len(buffer) - size
                    break
            if safe_upto:
                yield buffer[:safe_upto]
            buffer = buffer[safe_upto:]
            break
    if buffer and not inside:
        yield buffer


class LLMProvider(ABC):
    """Tier 3. Every implementation must either stream text or raise ProviderError."""

    name: str

    @abstractmethod
    def stream(self, system: str, user: str) -> AsyncIterator[str]:
        """Yield response fragments as they arrive."""

    @abstractmethod
    async def warmup(self) -> bool:
        """Best-effort connection and model warm-up. Never raises."""


class GroqProvider(LLMProvider):
    """OpenAI-compatible chat completions against Groq.

    A 429 is retried exactly once on the smaller fallback model. Anything beyond
    that is the caller's problem to degrade from, not something to retry into.
    """

    name = "groq"

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self._url = f"{settings.groq_base_url.rstrip('/')}/chat/completions"
        self._headers = {"Authorization": f"Bearer {settings.groq_api_key}"}

    def _body(self, system: str, user: str, model: str, stream: bool) -> dict:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self._settings.llm_temperature,
            "max_tokens": self._settings.llm_max_tokens,
            "stream": stream,
        }

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        try:
            async for chunk in self._stream_model(system, user, self._settings.groq_model):
                yield chunk
            return
        except _RateLimited:
            logger.warning("groq rate limited; retrying on %s", self._settings.groq_fallback_model)

        async for chunk in self._stream_model(system, user, self._settings.groq_fallback_model):
            yield chunk

    async def _stream_model(self, system: str, user: str, model: str) -> AsyncIterator[str]:
        body = self._body(system, user, model, stream=True)
        try:
            async with self._client.stream("POST", self._url, json=body, headers=self._headers) as response:
                if response.status_code == 429:
                    await response.aclose()
                    raise _RateLimited(model)
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", "replace")[:200]
                    raise ProviderError(f"groq {response.status_code}: {detail}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    if (content := _openai_delta(payload)) is not None:
                        yield content
        except httpx.HTTPError as exc:
            raise ProviderError(f"groq transport: {exc}") from exc

    async def warmup(self) -> bool:
        try:
            response = await self._client.post(
                self._url,
                json=self._body("You are a helper.", "ok", self._settings.groq_model, stream=False)
                | {"max_tokens": 1},
                headers=self._headers,
                timeout=self._settings.llm_connect_timeout_s + 2.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("groq warmup failed error=%s", exc)
            return False
        ok = response.status_code < 400
        logger.info("groq warmup status=%d model=%s", response.status_code, self._settings.groq_model)
        return ok


class OllamaProvider(LLMProvider):
    """Local Ollama chat endpoint, streaming NDJSON."""

    name = "ollama"

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self._url = f"{settings.ollama_url.rstrip('/')}/api/chat"

    def _body(self, system: str, user: str, stream: bool) -> dict:
        return {
            "model": self._settings.ollama_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": stream,
            # Reasoning models default to emitting a thinking block; the user is
            # waiting on the answer, not the deliberation.
            "think": False,
            "options": {
                "temperature": self._settings.llm_temperature,
                "num_predict": self._settings.llm_max_tokens,
            },
        }

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        async for chunk in without_thinking(self._raw_stream(system, user)):
            yield chunk

    async def _raw_stream(self, system: str, user: str) -> AsyncIterator[str]:
        try:
            async with self._client.stream(
                "POST", self._url, json=self._body(system, user, stream=True)
            ) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", "replace")[:200]
                    raise ProviderError(f"ollama {response.status_code}: {detail}")
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if content := event.get("message", {}).get("content"):
                        yield content
                    if event.get("done"):
                        return
        except httpx.HTTPError as exc:
            raise ProviderError(f"ollama transport: {exc}") from exc

    async def warmup(self) -> bool:
        try:
            response = await self._client.post(
                self._url,
                json=self._body("You are a helper.", "ok", stream=False),
                # A cold Ollama has to page the weights in from disk.
                timeout=60.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("ollama warmup failed error=%s", exc)
            return False
        ok = response.status_code < 400
        logger.info("ollama warmup status=%d model=%s", response.status_code, self._settings.ollama_model)
        return ok


class _RateLimited(ProviderError):
    pass


def _openai_delta(payload: str) -> str | None:
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        return None
    choices = event.get("choices") or []
    if not choices:
        return None
    return choices[0].get("delta", {}).get("content") or None


def build_voice_provider(settings: Settings, client: httpx.AsyncClient) -> LLMProvider | None:
    """The same providers, pointed at the smallest fast model.

    Voice turns are latency-bound, so they run on GROQ_VOICE_MODEL with a tight
    token ceiling. Local mode keeps the configured Ollama model unchanged.
    """
    if settings.llm_provider != "groq":
        return build_llm_provider(settings, client)
    if not settings.groq_api_key:
        return None
    voice_settings = settings.model_copy(
        update={
            "groq_model": settings.groq_voice_model,
            "llm_max_tokens": settings.voice_llm_max_tokens,
        }
    )
    return GroqProvider(client, voice_settings)


def build_llm_provider(settings: Settings, client: httpx.AsyncClient) -> LLMProvider | None:
    if settings.llm_provider == "groq":
        if not settings.groq_api_key:
            logger.warning("GROQ_API_KEY unset; explanations will use templates")
            return None
        return GroqProvider(client, settings)
    if settings.llm_provider == "ollama":
        return OllamaProvider(client, settings)
    return None
