from __future__ import annotations

import random
from pathlib import Path

from app.config import get_settings
from app.schemas.contracts import StartRequest, TurnRequest
from app.simulator.personas import PersonaLibrary
from app.simulator.scenario import _pick_avoiding, build_plan
from app.simulator.service import SimulatorService

PERSONA_DIR = Path(get_settings().persona_dir)
TURNS = 6


def _persona(persona_id: str = "digital_arrest"):
    persona = PersonaLibrary.load(PERSONA_DIR).get(persona_id)
    assert persona is not None
    return persona


def test_same_seed_is_deterministic() -> None:
    persona = _persona()
    a = build_plan(persona, "en", 12345, TURNS)
    b = build_plan(persona, "en", 12345, TURNS)
    assert a.opening == b.opening
    assert a.tactic_order == b.tactic_order
    assert a.turn_lines == b.turn_lines
    assert a.slots == b.slots


def test_different_seeds_diverge() -> None:
    persona = _persona()
    plans = [build_plan(persona, "en", seed, TURNS) for seed in range(20)]
    openings = {plan.opening for plan in plans}
    orders = {plan.tactic_order for plan in plans}
    # With eight opening variants and a shuffled order, 20 seeds should spread wide.
    assert len(openings) >= 5
    assert len(orders) >= 5


def test_slots_are_filled() -> None:
    persona = _persona()
    plan = build_plan(persona, "en", 999, TURNS)
    assert "{" not in plan.opening
    for line in plan.turn_lines:
        assert "{" not in line
    # The chosen slot values are among the persona's pools.
    assert plan.slots["officer_name"] in persona.slots["officer_name"]["en"]


def test_pick_avoiding_never_repeats() -> None:
    rng = random.Random(7)
    last = 0
    for _ in range(200):
        index = _pick_avoiding(rng, 5, last)
        assert index != last or 5 == 1
        last = index


def test_service_start_varies_across_sessions() -> None:
    simulator = SimulatorService.build(get_settings(), None)
    starts = [simulator.start(StartRequest(persona="digital_arrest", lang="en")) for _ in range(6)]
    openings = {start.scammer_text for start in starts}
    seeds = {start.seed for start in starts}
    assert len(seeds) == 6
    assert len(openings) >= 4


async def test_coach_is_unaffected_by_line_variation() -> None:
    """Whatever the caller's randomized wording, the coach still scores the user's
    own reply the same way, because it keys off the user's text, not the caller's."""
    simulator = SimulatorService.build(get_settings(), None)
    deltas = []
    for _ in range(4):
        start = simulator.start(StartRequest(persona="digital_arrest", lang="en"))
        result = await simulator.turn(
            TurnRequest(session_id=start.session_id, message="I will not share my OTP with you.")
        )
        deltas.append((result.coach.score_delta, result.coach.tactic_revealed))
    assert len(set(deltas)) == 1  # identical coaching for an identical user reply
    assert deltas[0][0] > 0
