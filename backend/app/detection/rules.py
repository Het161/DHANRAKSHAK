from __future__ import annotations

import logging
import re
from pathlib import Path

from app.detection.lexicon import TacticDefinition, load_tactics
from app.schemas.contracts import Tactic

logger = logging.getLogger(__name__)


def _longest_span(matcher: re.Pattern[str], text: str) -> tuple[int, int] | None:
    best: tuple[int, int] | None = None
    for match in matcher.finditer(text):
        span = match.span()
        if best is None or (span[1] - span[0]) > (best[1] - best[0]):
            best = span
    return best


class RuleEngine:
    """Deterministic tactic detection over the raw input text.

    Every language's terms are matched against every input: real scam messages
    routinely mix Gujarati, Hindi, English and romanized forms in one SMS.
    """

    def __init__(self, tactics: list[TacticDefinition]) -> None:
        self.tactics = tactics

    @classmethod
    def from_directory(cls, directory: Path) -> RuleEngine:
        return cls(load_tactics(directory))

    def detect(self, text: str) -> list[Tactic]:
        found = [
            hit for definition in self.tactics if (hit := self._detect_one(definition, text)) is not None
        ]
        found.sort(key=lambda tactic: tactic.weight, reverse=True)
        return found

    def _detect_one(self, definition: TacticDefinition, text: str) -> Tactic | None:
        if definition.veto is not None and definition.veto.search(text):
            return None
        span = (
            self._composite_span(definition, text)
            if definition.is_composite
            else _longest_span(definition.matcher, text)
        )
        if span is None:
            return None
        return Tactic(name=definition.name, evidence_span=span, weight=definition.weight)

    def _composite_span(self, definition: TacticDefinition, text: str) -> tuple[int, int] | None:
        spans = [span for group in definition.groups if (span := _longest_span(group.matcher, text))]
        if len(spans) < definition.min_groups:
            return None
        # The evidence for a composite tactic is the stretch of text its parts
        # span, not any single phrase.
        return min(start for start, _ in spans), max(end for _, end in spans)
