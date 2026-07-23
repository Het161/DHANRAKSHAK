from __future__ import annotations

import asyncio
import logging
import time

import httpx

from app.config import Settings
from app.detection.engine import DetectionEngine
from app.explain.providers import build_voice_provider
from app.explain.service import ExplanationService
from app.pipelines.audio import build_stt_provider
from app.pipelines.ocr import OcrEngine
from app.simulator.service import SimulatorService
from app.simulator.voice import VoiceCallService
from app.state import AppContext
from app.tts.service import SpeechService
from app.util.cache import ResponseCache

logger = logging.getLogger(__name__)


def _build_http_client(settings: Settings) -> httpx.AsyncClient:
    # One client for the whole process: connection reuse is the difference
    # between a 400ms and a 40ms handshake on every provider call.
    limits = httpx.Limits(max_connections=32, max_keepalive_connections=16)
    timeout = httpx.Timeout(settings.llm_timeout_s, connect=settings.llm_connect_timeout_s)
    return httpx.AsyncClient(limits=limits, timeout=timeout, follow_redirects=False)


async def build_context(settings: Settings) -> AppContext:
    """Load every artifact once, before the first request arrives.

    Lexicons, the classifier, the BM25 index and the templates are all read from
    disk here so that no request path ever touches the filesystem.
    """
    started = time.perf_counter()
    client = _build_http_client(settings)

    engine, explainer = await asyncio.gather(
        asyncio.to_thread(DetectionEngine.build, settings),
        asyncio.to_thread(ExplanationService.build, settings, client),
    )
    simulator = SimulatorService.build(settings, explainer.provider)
    ctx = AppContext(
        settings=settings,
        http=client,
        engine=engine,
        explainer=explainer,
        simulator=simulator,
        ocr=OcrEngine.detect(settings),
        stt=build_stt_provider(settings, client),
        cache=ResponseCache(settings.cache_size, settings.cache_ttl_s),
        speech=await SpeechService.build(settings) if settings.tts_enabled else None,
        voice=VoiceCallService(settings, simulator, build_voice_provider(settings, client)),
    )

    logger.info(
        "context ready mode=%s llm=%s stt=%s tactics=%d advisories=%d load_ms=%d",
        settings.mode,
        settings.llm_provider,
        settings.stt_provider,
        len(engine.rules.tactics),
        explainer.retriever.document_count,
        int((time.perf_counter() - started) * 1000),
    )
    return ctx


async def warm_providers(ctx: AppContext) -> None:
    """Pay the cold-start cost before a user does, without blocking readiness.

    The speech cache matters most: live synthesis costs about a second, so every
    line the caller can be predicted to say is on disk before the first call.
    """
    if ctx.explainer is not None:
        await ctx.explainer.warmup()
    if ctx.speech is not None and ctx.simulator is not None and ctx.settings.tts_prewarm_enabled:
        await ctx.speech.prewarm(ctx.simulator.speakable_lines())


async def shutdown_context(ctx: AppContext) -> None:
    await ctx.http.aclose()
