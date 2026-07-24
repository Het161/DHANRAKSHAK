"""Diagnostic: drive the CURRENT voice-turn flow and show what the caller says.

Run from backend/ with GROQ_API_KEY set:  python scripts/diag_voice.py
Prints, per turn, the user's line and each caller sentence tagged script|llm, so
we can see whether replies react to the user or recite pre-built lines.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.config import get_settings
from app.explain.providers import build_voice_provider
from app.schemas.contracts import StartRequest
from app.simulator.service import SimulatorService
from app.simulator.voice import VoiceCallService

USER_TURNS = [
    "Which bank are you calling from?",
    "I will not give you my OTP.",
    "Wait, let me call my son first.",
    "The weather is nice today, isn't it?",
]


async def main() -> int:
    settings = get_settings()
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))
    simulator = SimulatorService.build(settings, None)
    voice = VoiceCallService(settings, simulator, build_voice_provider(settings, client))
    try:
        start = simulator.start(StartRequest(persona="digital_arrest", lang="en"))
        print(f"OPENING: {start.scammer_text}\n")
        for i, line in enumerate(USER_TURNS, 1):
            print(f"USER {i}: {line}")
            async for event in voice.stream_turn(start.session_id, line, "male"):
                if event.type == "sentence":
                    print(f"  CALLER [{event.payload['source']}]: {event.payload['text']}")
                elif event.type == "done":
                    d = event.payload.get("debug") or {}
                    print(
                        f"  debug: class={d.get('class')} path={d.get('path')} "
                        f"history_len={d.get('history_len')} bridge={d.get('bridge')!r}"
                    )
                    print()
    finally:
        await client.aclose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
