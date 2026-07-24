import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.limits import limiter
from app.config import get_settings
from app.schemas.contracts import TTSRequest
from app.state import AppContext, get_context
from app.tts.provider import TTSUnavailable

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tts"])

_settings = get_settings()

_HEADERS = {
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
}


@router.post("/tts")
@limiter.limit(_settings.rate_limit_tts)
async def synthesize(
    request: Request, payload: TTSRequest, ctx: AppContext = Depends(get_context)
) -> StreamingResponse:
    speech = ctx.speech
    if speech is None or not ctx.settings.tts_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Speech is not available.")

    voice = speech.voice_for(payload.lang, payload.gender)
    if voice is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"No {payload.gender} voice is available for that language.",
        )

    cached = speech.is_cached(payload.text, payload.lang, payload.gender)
    stream = speech.stream(payload.text, payload.lang, payload.gender)

    # Pull the first chunk here so a synthesis failure is still a clean 503
    # rather than a truncated audio response the browser cannot recover from.
    try:
        first = await anext(stream)
    except StopAsyncIteration:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Speech synthesis returned nothing.") from None
    except TTSUnavailable as exc:
        logger.warning("tts unavailable lang=%s gender=%s reason=%s", payload.lang, payload.gender, exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Speech synthesis is unavailable.") from exc

    async def body():
        yield first
        try:
            async for chunk in stream:
                yield chunk
        except TTSUnavailable as exc:
            # Mid-stream failure: the client already has audio playing, so stop
            # cleanly instead of corrupting the tail.
            logger.warning("tts stream cut short reason=%s", exc)

    logger.info(
        "tts serve lang=%s gender=%s chars=%d cached=%s",
        payload.lang,
        payload.gender,
        len(payload.text),
        cached,
    )
    return StreamingResponse(body(), media_type="audio/mpeg", headers=_HEADERS)
