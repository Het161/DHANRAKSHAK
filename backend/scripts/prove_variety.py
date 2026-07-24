"""Prove practice sessions vary, and that persona pools are well-formed.

Run from backend/:  python3 scripts/prove_variety.py
Structural checks (every {token} is a slot; lines cover every tactic; all three
languages present) run for every persona. Then the fallback path is exercised
for real: fresh seeds per persona/lang must yield distinct openings and tactic
orders. No network, no LLM - this is the degraded path, which must still vary.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.schemas.contracts import StartRequest
from app.simulator.personas import PersonaLibrary
from app.simulator.scenario import build_plan
from app.simulator.service import SimulatorService

LANGS = ("en", "hi", "gu")
SLOT_RE = re.compile(r"\{(\w+)\}")
TURNS = 6
SESSIONS = 5


def structural_check(persona) -> list[str]:
    problems: list[str] = []
    slot_names = set(persona.slots)

    # Every tactic must have a line block.
    for tactic in persona.tactics:
        block = persona.lines.get(tactic, {})
        for lang in LANGS:
            if not block.get(lang):
                problems.append(f"{persona.id}: lines[{tactic}][{lang}] empty")

    # Every {token} used anywhere must be a defined slot.
    texts: list[str] = []
    for lang in LANGS:
        texts += list(persona.openings.get(lang, ()))
        texts += list(persona.closings.get(lang, ()))
        texts += list(persona.filler.get(lang, ()))
        for tactic in persona.tactics:
            texts += list(persona.lines.get(tactic, {}).get(lang, ()))
    for text in texts:
        for token in SLOT_RE.findall(text):
            if token not in slot_names:
                problems.append(f"{persona.id}: undefined slot {{{token}}} in {text!r}")

    # Three languages present for the language-scoped pools.
    for lang in LANGS:
        if not persona.openings.get(lang):
            problems.append(f"{persona.id}: no openings for {lang}")
    return problems


def variety_check(persona) -> list[str]:
    problems: list[str] = []
    for lang in LANGS:
        # Distinct seeds, exactly how the service seeds real sessions.
        plans = [build_plan(persona, lang, 1000 + i * 7919, TURNS) for i in range(SESSIONS)]
        openings = {p.opening for p in plans}
        orders = {p.tactic_order for p in plans}
        for p in plans:
            leftover = [line for line in (p.opening, *p.turn_lines, p.closing) if "{" in line]
            if leftover:
                problems.append(f"{persona.id}/{lang}: unfilled slot in {leftover[0]!r}")
        if len(openings) < 2:
            problems.append(f"{persona.id}/{lang}: openings not varying ({len(openings)}/{SESSIONS})")
        if len(orders) < 2 and len(persona.tactics) > 1:
            problems.append(f"{persona.id}/{lang}: tactic order not varying ({len(orders)}/{SESSIONS})")
    return problems


def service_proof() -> list[str]:
    """Five real fallback sessions per persona (LLM off): all openings differ."""
    problems: list[str] = []
    simulator = SimulatorService.build(get_settings(), None)  # None provider = fallback
    for persona in PERSONAS:
        starts = [simulator.start(StartRequest(persona=persona.id, lang="en")) for _ in range(SESSIONS)]
        seeds = {s.seed for s in starts}
        openings = {s.scammer_text for s in starts}
        if len(seeds) != SESSIONS:
            problems.append(f"{persona.id}: seeds repeated across sessions")
        if len(openings) < SESSIONS - 1:
            problems.append(f"{persona.id}: fallback openings barely vary ({len(openings)}/{SESSIONS})")
        print(f"  {persona.id:16} seeds={len(seeds)}/{SESSIONS} openings={len(openings)}/{SESSIONS}")
    return problems


if __name__ == "__main__":
    library = PersonaLibrary.load(Path(get_settings().persona_dir))
    PERSONAS = library.all()

    all_problems: list[str] = []
    print("structural checks:")
    for persona in PERSONAS:
        probs = structural_check(persona)
        all_problems += probs
        print(f"  {persona.id:16} tactics={len(persona.tactics)} {'OK' if not probs else 'FAIL'}")

    print("\nfallback variety (build_plan across seeds, all langs):")
    for persona in PERSONAS:
        probs = variety_check(persona)
        all_problems += probs
        print(f"  {persona.id:16} {'OK' if not probs else 'FAIL'}")

    print("\nservice fallback proof (5 real sessions/persona, LLM off):")
    all_problems += service_proof()

    print()
    if all_problems:
        print(f"FAILED ({len(all_problems)} problems):")
        for p in all_problems:
            print("  -", p)
        sys.exit(1)
    print("ALL VARIETY CHECKS PASSED")
