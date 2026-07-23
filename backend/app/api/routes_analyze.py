import base64
import binascii
import logging
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api import sse
from app.api.limits import limiter
from app.config import get_settings
from app.pipelines.audio import TranscriptionError, wav_duration_seconds
from app.pipelines.normalize import CleanInput, normalize
from app.pipelines.ocr import OcrError
from app.schemas.contracts import AnalyzeRequest, DonePayload, ErrorPayload, LanguageHint
from app.state import AppContext, get_context

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analyze"])

_settings = get_settings()


def _stream(ctx: AppContext, clean: CleanInput) -> StreamingResponse:
    return StreamingResponse(
        _analyze_events(ctx, clean), media_type="text/event-stream", headers=sse.SSE_HEADERS
    )


async def _analyze_events(ctx: AppContext, clean: CleanInput) -> AsyncIterator[str]:
    """Emit verdict, then explanation tokens, then done.

    The verdict event is produced entirely by tiers 1 and 2 and carries a
    complete AnalyzeResponse including a template explanation. Everything after
    it is an upgrade: if the connection or the provider dies here, the client
    already has a correct answer.
    """
    started = time.perf_counter()
    cache_key = ctx.cache.key(clean.text, clean.lang) if ctx.cache is not None else None

    try:
        if cache_key and (hit := ctx.cache.get(cache_key)) is not None:
            response, explanation, source = hit
            yield sse.encode("verdict", response)
            for chunk in sse.replay_chunks(explanation):
                yield sse.encode("token", {"text": chunk})
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            yield sse.encode(
                "done",
                DonePayload(explanation=explanation, explanation_source=source, latency_ms=elapsed_ms),
            )
            _log_analyze(ctx, clean, response.verdict, response.risk_score, "cache", elapsed_ms)
            return

        signals = await ctx.engine.analyze(clean.text, clean.lang)
        response = await ctx.explainer.baseline(signals)
        response.analyzed_text = clean.text
        engine_ms = int((time.perf_counter() - started) * 1000)
        yield sse.encode("verdict", response)

        chunks: list[str] = []
        async for token in ctx.explainer.stream_tokens(signals, response):
            chunks.append(token)
            yield sse.encode("token", {"text": token})

        explanation = ctx.explainer.finalize("".join(chunks), response)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        yield sse.encode(
            "done",
            DonePayload(
                explanation=explanation.text,
                explanation_source=explanation.source,
                latency_ms=elapsed_ms,
            ),
        )
        if cache_key:
            ctx.cache.put(cache_key, response, explanation.text, explanation.source)
        _log_analyze(
            ctx, clean, response.verdict, response.risk_score, explanation.source, elapsed_ms, engine_ms
        )
    except Exception:
        # The stream is already open, so a 500 is no longer reachable. Report the
        # failure inside the stream instead of dropping the connection silently.
        logger.exception("analyze stream failed source=%s", clean.source)
        yield sse.encode(
            "error",
            ErrorPayload(code="stream_failed", message="The analysis could not be completed."),
        )


def _log_analyze(
    ctx: AppContext,
    clean: CleanInput,
    verdict: str,
    risk: int,
    tier: str,
    latency_ms: int,
    engine_ms: int | None = None,
) -> None:
    # Deliberately no message content, no transcript, no OCR text.
    logger.info(
        "analyze mode=%s input=%s lang=%s verdict=%s risk=%d tier=%s engine_ms=%s latency_ms=%d chars=%d",
        ctx.settings.mode,
        clean.source,
        clean.lang,
        verdict,
        risk,
        tier,
        engine_ms if engine_ms is not None else "-",
        latency_ms,
        len(clean.text),
    )


def _decode_base64(content: str, limit: int, label: str) -> bytes:
    payload = content.split(",", 1)[1] if content.startswith("data:") else content
    try:
        data = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"The {label} could not be decoded."
        ) from exc
    _enforce_size(len(data), limit, label)
    return data


def _enforce_size(size: int, limit: int, label: str) -> None:
    if size > limit:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"That {label} is larger than {limit // (1024 * 1024)} MB. Please send a smaller one.",
        )


async def _read_capped(upload: UploadFile, limit: int, label: str) -> bytes:
    # Read one byte past the cap so an oversized upload is rejected without ever
    # being held in memory in full.
    data = await upload.read(limit + 1)
    _enforce_size(len(data), limit, label)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The {label} was empty.")
    return data


async def _ocr_to_clean(ctx: AppContext, data: bytes, hint: LanguageHint) -> CleanInput:
    if ctx.ocr is None or not ctx.ocr.available:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Screenshot reading is not available on this server right now.",
        )
    try:
        text = await ctx.ocr.extract(data)
    except OcrError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return normalize(text, hint, "image")


async def _stt_to_clean(ctx: AppContext, data: bytes, filename: str, hint: LanguageHint) -> CleanInput:
    if ctx.stt is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Voice recordings cannot be read on this server right now.",
        )
    duration = wav_duration_seconds(data)
    if duration is not None and duration > ctx.settings.max_audio_seconds:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"That recording is longer than {ctx.settings.max_audio_seconds} seconds.",
        )
    try:
        text = await ctx.stt.transcribe(data, filename)
    except TranscriptionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if not text.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "No speech could be heard in that recording."
        )
    return normalize(text, hint, "audio")


async def _clean_from_request(ctx: AppContext, payload: AnalyzeRequest) -> CleanInput:
    if payload.input_type == "image":
        data = _decode_base64(payload.content, ctx.settings.max_image_bytes, "image")
        return await _ocr_to_clean(ctx, data, payload.language_hint)
    if payload.input_type == "audio":
        data = _decode_base64(payload.content, ctx.settings.max_audio_bytes, "recording")
        return await _stt_to_clean(ctx, data, "upload.wav", payload.language_hint)
    return normalize(payload.content, payload.language_hint, payload.input_type)


@router.post("/analyze")
@limiter.limit(_settings.rate_limit_analyze)
async def analyze(
    request: Request, payload: AnalyzeRequest, ctx: AppContext = Depends(get_context)
) -> StreamingResponse:
    return _stream(ctx, await _clean_from_request(ctx, payload))


@router.post("/analyze/image")
@limiter.limit(_settings.rate_limit_analyze)
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    language_hint: LanguageHint = Form("auto"),
    ctx: AppContext = Depends(get_context),
) -> StreamingResponse:
    data = await _read_capped(file, ctx.settings.max_image_bytes, "image")
    return _stream(ctx, await _ocr_to_clean(ctx, data, language_hint))


@router.post("/analyze/audio")
@limiter.limit(_settings.rate_limit_analyze)
async def analyze_audio(
    request: Request,
    file: UploadFile = File(...),
    language_hint: LanguageHint = Form("auto"),
    ctx: AppContext = Depends(get_context),
) -> StreamingResponse:
    data = await _read_capped(file, ctx.settings.max_audio_bytes, "recording")
    return _stream(ctx, await _stt_to_clean(ctx, data, file.filename or "upload.wav", language_hint))
