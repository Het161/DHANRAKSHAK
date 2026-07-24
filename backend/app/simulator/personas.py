from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from app.schemas.contracts import Language, LocalizedText

logger = logging.getLogger(__name__)

_LANGUAGES: tuple[Language, ...] = ("en", "hi", "gu")


def _localized(payload: dict | None) -> LocalizedText:
    payload = payload or {}
    return LocalizedText(**{lang: str(payload.get(lang, "")) for lang in _LANGUAGES})


def _localized_list(payload: dict | None) -> dict[Language, tuple[str, ...]]:
    """A {en:[...], hi:[...], gu:[...]} block into a per-language tuple map."""
    payload = payload or {}
    return {
        lang: tuple(str(item) for item in payload.get(lang, []) if str(item).strip())
        for lang in _LANGUAGES
    }


def _slot_pools(payload: dict | None) -> dict[str, dict[Language, tuple[str, ...]]]:
    """Slot value pools. A slot is either language-neutral (a flat list, reused
    across languages) or per-language (a {en/hi/gu} block)."""
    payload = payload or {}
    slots: dict[str, dict[Language, tuple[str, ...]]] = {}
    for name, value in payload.items():
        if isinstance(value, list):
            shared = tuple(str(item) for item in value if str(item).strip())
            slots[name] = dict.fromkeys(_LANGUAGES, shared)
        elif isinstance(value, dict):
            slots[name] = _localized_list(value)
    return slots


def _line_pools(payload: dict | None) -> dict[str, dict[Language, tuple[str, ...]]]:
    """Per-tactic line variant pools: tactic -> {en/hi/gu} -> variants."""
    payload = payload or {}
    return {str(tactic): _localized_list(block) for tactic, block in payload.items()}


@dataclass(frozen=True, slots=True)
class EvaluationRule:
    id: str
    weight: int
    matcher: re.Pattern[str]
    tactic_revealed: str | None
    tip: LocalizedText


@dataclass(frozen=True, slots=True)
class Persona:
    id: str
    title: LocalizedText
    tactics: tuple[str, ...]
    opening: LocalizedText
    closing: LocalizedText
    system_prompt: str
    voice_prompt: str
    scripted_turns: dict[Language, tuple[str, ...]]
    openings: dict[Language, tuple[str, ...]]
    lines: dict[str, dict[Language, tuple[str, ...]]]
    slots: dict[str, dict[Language, tuple[str, ...]]]
    filler: dict[Language, tuple[str, ...]]
    closings: dict[Language, tuple[str, ...]]
    good: tuple[EvaluationRule, ...]
    bad: tuple[EvaluationRule, ...]
    neutral_tip: LocalizedText

    def scripted_turn(self, lang: Language, index: int) -> str:
        turns = self.scripted_turns.get(lang) or self.scripted_turns.get("en") or ()
        if not turns:
            return self.closing.get(lang)
        return turns[min(index, len(turns) - 1)]


def _build_rules(entries: list[dict] | None, origin: str) -> tuple[EvaluationRule, ...]:
    rules: list[EvaluationRule] = []
    for entry in entries or []:
        patterns = [pattern for pattern in entry.get("patterns", []) if pattern]
        compiled: list[str] = []
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as exc:
                logger.warning("persona rule pattern invalid origin=%s error=%s", origin, exc)
                continue
            compiled.append(pattern)
        if not compiled:
            continue
        rules.append(
            EvaluationRule(
                id=str(entry.get("id", "rule")),
                weight=int(entry.get("weight", 0)),
                matcher=re.compile("|".join(compiled), re.IGNORECASE | re.UNICODE),
                tactic_revealed=entry.get("tactic_revealed") or None,
                tip=_localized(entry.get("tip")),
            )
        )
    return tuple(rules)


def _build_persona(payload: dict, origin: str) -> Persona:
    scripted = {
        lang: tuple(str(turn) for turn in payload.get("scripted_turns", {}).get(lang, []))
        for lang in _LANGUAGES
    }
    evaluation = payload.get("evaluation", {})
    return Persona(
        id=str(payload["id"]),
        title=_localized(payload.get("title")),
        tactics=tuple(str(tactic) for tactic in payload.get("tactics", [])),
        opening=_localized(payload.get("opening")),
        closing=_localized(payload.get("closing")),
        system_prompt=str(payload.get("system_prompt", "")),
        voice_prompt=str(payload.get("voice", "")),
        scripted_turns={lang: turns for lang, turns in scripted.items() if turns},
        openings=_localized_list(payload.get("openings")),
        lines=_line_pools(payload.get("lines")),
        slots=_slot_pools(payload.get("slots")),
        filler=_localized_list(payload.get("filler")),
        closings=_localized_list(payload.get("closings")),
        good=_build_rules(evaluation.get("good"), f"{origin}.good"),
        bad=_build_rules(evaluation.get("bad"), f"{origin}.bad"),
        neutral_tip=_localized(evaluation.get("neutral_tip")),
    )


class PersonaLibrary:
    """Personas are data, not code, so a new scam script is a new JSON file."""

    def __init__(self, personas: dict[str, Persona]) -> None:
        self._personas = personas

    def get(self, persona_id: str) -> Persona | None:
        return self._personas.get(persona_id)

    def all(self) -> list[Persona]:
        return list(self._personas.values())

    @classmethod
    def load(cls, directory: Path) -> PersonaLibrary:
        personas: dict[str, Persona] = {}
        if not directory.is_dir():
            logger.warning("persona directory missing path=%s", directory)
            return cls(personas)
        for path in sorted(directory.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                persona = _build_persona(payload, path.name)
            except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                logger.warning("persona unusable file=%s error=%s", path.name, exc)
                continue
            personas[persona.id] = persona
        logger.info("personas loaded count=%d", len(personas))
        return cls(personas)
