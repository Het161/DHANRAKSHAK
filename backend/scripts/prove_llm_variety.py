"""Prove the LLM (primary) path varies too, against live Groq.

Run from backend/ with GROQ_API_KEY set (loaded from .env):
    python3 scripts/prove_llm_variety.py [persona] [lang]

Runs five real sessions through the roleplay LLM. The opening and tactic order
come from the per-session seed, so they must differ across sessions. The turn
lines come from the LLM at high temperature - they must both actually use the
LLM path (source == "llm") and read differently across sessions.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.config import get_settings
from app.explain.providers import build_roleplay_provider
from app.schemas.contracts import StartRequest, TurnRequest
from app.simulator.service import SimulatorService

SESSIONS = 5
TURNS = 3
USER_REPLY = "Who are you? I do not believe you. I will not share anything."


async def main(persona: str, lang: str) -> int:
    settings = get_settings()
    if not settings.groq_api_key:
        print("GROQ_API_KEY not set - cannot prove the live LLM path.")
        return 2

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))
    provider = build_roleplay_provider(settings, client)
    simulator = SimulatorService.build(settings, provider)

    openings: list[str] = []
    orders: list[tuple[str, ...]] = []
    per_session_lines: list[list[str]] = []
    sources: list[str] = []
    try:
        for n in range(SESSIONS):
            start = simulator.start(StartRequest(persona=persona, lang=lang))
            openings.append(start.scammer_text)
            orders.append(tuple(start.plan["tactic_order"]) if start.plan else ())
            lines: list[str] = []
            for _ in range(TURNS):
                result = await simulator.turn(TurnRequest(session_id=start.session_id, message=USER_REPLY))
                lines.append(result.scammer_text)
                sources.append(result.source)
                if result.finished:
                    break
            per_session_lines.append(lines)
            print(f"session {n + 1}: seed={start.seed}")
            print(f"  opening: {start.scammer_text}")
            print(f"  tactics: {' > '.join(orders[-1])}")
            for i, line in enumerate(lines):
                print(f"  turn {i + 1} [{sources[len(sources) - len(lines) + i]}]: {line}")
    finally:
        await client.aclose()

    uniq_openings = len(set(openings))
    uniq_orders = len(set(orders))
    llm_turns = sum(1 for s in sources if s == "llm")
    # Flatten every LLM line; high-temp roleplay should rarely repeat verbatim.
    all_lines = [line for lines in per_session_lines for line in lines]
    uniq_lines = len(set(all_lines))

    print("\nsummary:")
    print(f"  unique openings: {uniq_openings}/{SESSIONS}")
    print(f"  unique tactic orders: {uniq_orders}/{SESSIONS}")
    print(f"  LLM-sourced turns: {llm_turns}/{len(sources)}")
    print(f"  unique turn lines: {uniq_lines}/{len(all_lines)}")

    ok = (
        uniq_openings >= SESSIONS - 1
        and uniq_orders >= SESSIONS - 1
        and llm_turns >= len(sources) * 0.6  # LLM is primary; some fallback tolerated
        and uniq_lines >= len(all_lines) * 0.8
    )
    print("\n" + ("LLM VARIETY PROVEN" if ok else "LLM VARIETY WEAK - review output above"))
    return 0 if ok else 1


if __name__ == "__main__":
    persona = sys.argv[1] if len(sys.argv) > 1 else "digital_arrest"
    lang = sys.argv[2] if len(sys.argv) > 2 else "en"
    sys.exit(asyncio.run(main(persona, lang)))
