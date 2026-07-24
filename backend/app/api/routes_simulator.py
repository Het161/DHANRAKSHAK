import asyncio
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from app.api import sse
from app.api.limits import limiter
from app.config import get_settings
from app.schemas.contracts import (
    ErrorPayload,
    StartRequest,
    StartResponse,
    TurnRequest,
    TurnResponse,
    VoiceTurnRequest,
)
from app.simulator.service import PersonaNotFound, SessionNotFound
from app.state import AppContext, get_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/simulator", tags=["simulator"])

_settings = get_settings()


@router.post("/start", response_model=StartResponse)
@limiter.limit(_settings.rate_limit_simulator)
async def start(
    request: Request,
    response: Response,
    payload: StartRequest,
    ctx: AppContext = Depends(get_context),
) -> StartResponse:
    try:
        started = ctx.simulator.start(payload)
    except PersonaNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That training scenario is not available.") from exc

    # Warm the rest of this scenario's lines while the user reads the opening.
    # By the time they answer, every scripted reply is already on disk.
    if ctx.speech is not None and ctx.settings.tts_prewarm_enabled:
        for gender in ("male", "female"):
            lines = ctx.simulator.plan_lines(started.session_id, gender)
            _background(ctx.speech.prewarm(lines))
    return started


@router.post("/turn", response_model=TurnResponse)
@limiter.limit(_settings.rate_limit_simulator)
async def turn(
    request: Request,
    response: Response,
    payload: TurnRequest,
    ctx: AppContext = Depends(get_context),
) -> TurnResponse:
    try:
        return await ctx.simulator.turn(payload)
    except SessionNotFound as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This practice session has expired. Please start a new one."
        ) from exc
    except PersonaNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That training scenario is not available.") from exc


def _background(coroutine) -> None:
    """Fire and forget, keeping a reference so the task is not garbage collected."""
    task = asyncio.create_task(coroutine)
    _PREWARM_TASKS.add(task)
    task.add_done_callback(_PREWARM_TASKS.discard)


_PREWARM_TASKS: set[asyncio.Task] = set()


@router.post("/voice-turn")
@limiter.limit(_settings.rate_limit_simulator)
async def voice_turn(
    request: Request, payload: VoiceTurnRequest, ctx: AppContext = Depends(get_context)
) -> StreamingResponse:
    """One spoken turn, streamed sentence by sentence.

    The first event is the scripted line, whose audio is already cached, so the
    client can start playing it immediately instead of waiting for the model.
    """
    if ctx.voice is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Voice calls are not available.")

    # Resolve session problems before the stream opens so they stay real HTTP codes.
    if ctx.simulator is None or ctx.simulator.sessions.get(payload.session_id) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This practice call has ended. Please start a new one."
        )

    speech_available = ctx.speech is not None and ctx.speech.health().available

    async def events() -> AsyncIterator[str]:
        if not speech_available:
            # The client speaks the sentences with on-device speech instead.
            yield sse.encode("tts_unavailable", {})
        try:
            async for event in ctx.voice.stream_turn(payload.session_id, payload.message, payload.gender):
                yield sse.encode(event.type, event.payload)
        except (SessionNotFound, PersonaNotFound):
            yield sse.encode(
                "error", ErrorPayload(code="session_gone", message="This practice call has ended.")
            )
        except Exception:
            logger.exception("voice turn failed")
            yield sse.encode("error", ErrorPayload(code="turn_failed", message="The call hit a problem."))

    return StreamingResponse(events(), media_type="text/event-stream", headers=sse.SSE_HEADERS)
