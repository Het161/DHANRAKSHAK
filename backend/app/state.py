from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from fastapi import Request

from app.config import Settings

if TYPE_CHECKING:
    import httpx

    from app.detection.engine import DetectionEngine
    from app.explain.service import ExplanationService
    from app.pipelines.audio import STTProvider
    from app.pipelines.ocr import OcrEngine
    from app.simulator.service import SimulatorService
    from app.simulator.voice import VoiceCallService
    from app.tts.service import SpeechService
    from app.util.cache import ResponseCache


@dataclass(slots=True)
class AppContext:
    """Everything loaded once at startup and shared by every request.

    Components are optional so that a partially available deployment still boots
    and still serves: /api/health reports what is missing instead of the process
    refusing to start.
    """

    settings: Settings
    http: httpx.AsyncClient
    started_at: float = field(default_factory=time.monotonic)
    engine: DetectionEngine | None = None
    explainer: ExplanationService | None = None
    simulator: SimulatorService | None = None
    ocr: OcrEngine | None = None
    stt: STTProvider | None = None
    cache: ResponseCache | None = None
    speech: SpeechService | None = None
    voice: VoiceCallService | None = None

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self.started_at


def get_context(request: Request) -> AppContext:
    return request.app.state.ctx
