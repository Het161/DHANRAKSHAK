from __future__ import annotations

import json
from collections.abc import Iterator

from pydantic import BaseModel

from app.schemas.contracts import SSEEventType, VoiceEventType

# Long enough to be cheap, short enough that replayed text still animates.
_REPLAY_CHUNK_CHARS = 24

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Render and nginx buffer streamed responses unless told not to, which would
    # defeat the point of emitting the verdict first.
    "X-Accel-Buffering": "no",
}


def encode(event_type: SSEEventType | VoiceEventType, payload: BaseModel | dict) -> str:
    body = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return f"data: {json.dumps({'type': event_type, 'payload': body}, ensure_ascii=False)}\n\n"


def replay_chunks(text: str) -> Iterator[str]:
    for start in range(0, len(text), _REPLAY_CHUNK_CHARS):
        yield text[start : start + _REPLAY_CHUNK_CHARS]
