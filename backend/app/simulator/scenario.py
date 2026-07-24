from __future__ import annotations

import random
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.schemas.contracts import Language

if TYPE_CHECKING:
    from app.simulator.personas import Persona

_SLOT_RE = re.compile(r"\{(\w+)\}")
# How often a pressure filler is tacked onto a fallback line.
_FILLER_CHANCE = 0.35


def _fill(text: str, slots: dict[str, str]) -> str:
    """Replace {slot} tokens with this session's chosen values.

    An unknown token is left as-is rather than blanked, so a data typo shows up
    loudly instead of silently producing a gap in the caller's speech.
    """
    return _SLOT_RE.sub(lambda m: slots.get(m.group(1), m.group(0)), text)


@dataclass(frozen=True, slots=True)
class ScenarioPlan:
    """One session's randomized run of a persona.

    Built once from a server-side seed and then frozen, so two sessions - two
    phones, or the same phone twice - never get the same plan. The opening, the
    per-turn fallback lines and the facts handed to the LLM are all derived here,
    which is why variety holds across the whole session and across both the LLM
    and fallback paths. Everything is precomputed at build so nothing is stateful
    at request time, and cache-warming can read the exact lines a call will use.
    """

    seed: int
    lang: Language
    opening: str
    closing: str
    tactic_order: tuple[str, ...]
    turn_lines: tuple[str, ...]
    slots: dict[str, str]

    def scripted_line(self, turn_index: int) -> str:
        if not self.turn_lines:
            return self.closing
        return self.turn_lines[min(turn_index, len(self.turn_lines) - 1)]

    def tactic_for_turn(self, turn_index: int) -> str:
        if not self.tactic_order:
            return ""
        return self.tactic_order[turn_index % len(self.tactic_order)]

    def facts_for_prompt(self) -> str:
        """The session's fixed details, so the LLM keeps them consistent."""
        if not self.slots:
            return ""
        return "; ".join(f"{name}: {value}" for name, value in sorted(self.slots.items()))

    def speakable_lines(self) -> list[str]:
        """Every line this session could voice, for just-in-time cache warming."""
        return list(dict.fromkeys(line for line in (self.opening, *self.turn_lines, self.closing) if line))

    def as_debug(self) -> dict[str, object]:
        return {
            "seed": self.seed,
            "opening": self.opening,
            "tactic_order": list(self.tactic_order),
            "slots": dict(self.slots),
        }


def _choose_slots(persona: Persona, lang: Language, rng: random.Random) -> dict[str, str]:
    chosen: dict[str, str] = {}
    for name, per_lang in persona.slots.items():
        pool = per_lang.get(lang) or per_lang.get("en") or ()
        if pool:
            chosen[name] = rng.choice(pool)
    return chosen


def _shuffled_tactics(persona: Persona, rng: random.Random, length: int) -> tuple[str, ...]:
    """A shuffled tactic order, extended to cover every turn.

    Re-shuffling each pass, rather than repeating one order, stops later turns
    from marching in the same sequence every session.
    """
    tactics = list(persona.tactics)
    if not tactics:
        return ()
    order: list[str] = []
    while len(order) < length:
        block = tactics[:]
        rng.shuffle(block)
        order.extend(block)
    return tuple(order[:length])


def _pick_avoiding(rng: random.Random, count: int, last: int) -> int:
    """A random index that is never the same as the previous one."""
    index = rng.randrange(count)
    if count > 1 and index == last:
        index = (index + 1) % count
    return index


def build_plan(
    persona: Persona,
    lang: Language,
    seed: int,
    turns: int,
    avoid_openings: frozenset[str] = frozenset(),
) -> ScenarioPlan:
    """Create a session's plan from its seed.

    `avoid_openings` is a small set of this persona's recently used openings; the
    pick skips them when it can, so the same device does not see an opening twice
    in a row. That is a nicety only - the per-session seed is the real mechanism.
    """
    rng = random.Random(seed)
    slots = _choose_slots(persona, lang, rng)

    opening_pool = persona.openings.get(lang) or persona.openings.get("en") or ()
    if opening_pool:
        fresh = [text for text in opening_pool if _fill(text, slots) not in avoid_openings]
        opening = _fill(rng.choice(fresh or list(opening_pool)), slots)
    else:
        opening = persona.opening.get(lang)

    tactic_order = _shuffled_tactics(persona, rng, max(turns, 1))
    filler = persona.filler.get(lang) or persona.filler.get("en") or ()

    turn_lines: list[str] = []
    last_index: dict[str, int] = {}
    for turn in range(max(turns, 1)):
        tactic = tactic_order[turn % len(tactic_order)] if tactic_order else ""
        variants = persona.lines.get(tactic, {}).get(lang) or persona.lines.get(tactic, {}).get("en") or ()
        if not variants:
            continue
        index = _pick_avoiding(rng, len(variants), last_index.get(tactic, -1))
        last_index[tactic] = index
        line = _fill(variants[index], slots)
        if filler and rng.random() < _FILLER_CHANCE:
            line = f"{line} {_fill(rng.choice(filler), slots)}"
        turn_lines.append(line)

    closing_pool = persona.closings.get(lang) or persona.closings.get("en") or ()
    closing = _fill(rng.choice(closing_pool), slots) if closing_pool else persona.closing.get(lang)

    # Fall back to the legacy fixed script only when a persona ships no line pools.
    if not turn_lines:
        turn_lines = list(persona.scripted_turns.get(lang) or persona.scripted_turns.get("en") or ())

    return ScenarioPlan(
        seed=seed,
        lang=lang,
        opening=opening,
        closing=closing,
        tactic_order=tactic_order,
        turn_lines=tuple(turn_lines),
        slots=slots,
    )
