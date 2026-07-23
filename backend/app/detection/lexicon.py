from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_ASCII_ONLY = re.compile(r"^[\x00-\x7f]+$")
_TERM_KEYS = ("en", "hi", "gu", "translit")

# Latin terms are matched as whole words with a few common inflections so that a
# lexicon does not have to list block/blocked/blocking separately. Indic scripts
# take agglutinative suffixes, so those terms anchor at the start only.
_ASCII_TEMPLATE = r"(?<!\w){body}(?:s|es|ed|ing)?(?!\w)"
_INDIC_TEMPLATE = r"(?<!\w){body}"


class LexiconError(ValueError):
    pass


def _term_to_pattern(term: str) -> str:
    words = term.strip().split()
    if not words:
        raise LexiconError("empty term")
    body = r"\s+".join(re.escape(word) for word in words)
    template = _ASCII_TEMPLATE if _ASCII_ONLY.match(term) else _INDIC_TEMPLATE
    return template.format(body=body)


def _compile_alternation(patterns: list[str], origin: str) -> re.Pattern[str] | None:
    if not patterns:
        return None
    try:
        return re.compile("|".join(patterns), re.IGNORECASE | re.UNICODE)
    except re.error as exc:
        raise LexiconError(f"{origin}: {exc}") from exc


def _collect_patterns(payload: dict, origin: str) -> list[str]:
    terms = payload.get("terms") or {}
    patterns = [_term_to_pattern(term) for key in _TERM_KEYS for term in terms.get(key, [])]
    for raw in payload.get("patterns", []):
        try:
            re.compile(raw)
        except re.error as exc:
            raise LexiconError(f"{origin}: bad pattern {raw!r}: {exc}") from exc
        patterns.append(raw)
    return patterns


@dataclass(frozen=True, slots=True)
class CompositeGroup:
    name: str
    matcher: re.Pattern[str]


@dataclass(frozen=True, slots=True)
class TacticDefinition:
    """A compiled tactic detector.

    `groups` is empty for a simple lexicon tactic and populated for a composite
    one, where at least `min_groups` distinct concept groups must co-occur.
    """

    name: str
    weight: float
    matcher: re.Pattern[str] | None = None
    veto: re.Pattern[str] | None = None
    groups: tuple[CompositeGroup, ...] = ()
    min_groups: int = 1

    @property
    def is_composite(self) -> bool:
        return bool(self.groups)


def _build_tactic(payload: dict, origin: str) -> TacticDefinition:
    name = payload["tactic"]
    weight = float(payload["weight"])
    if not 0.0 < weight <= 1.0:
        raise LexiconError(f"{origin}: weight {weight} outside (0, 1]")

    veto = _compile_alternation(payload.get("veto_patterns", []), f"{origin}.veto_patterns")

    if payload.get("type") == "composite":
        groups = tuple(
            CompositeGroup(
                name=group["name"],
                matcher=_compile_alternation(_collect_patterns(group, f"{origin}.{group['name']}"), origin),
            )
            for group in payload["groups"]
        )
        groups = tuple(group for group in groups if group.matcher is not None)
        min_groups = int(payload.get("min_groups", 2))
        if min_groups > len(groups):
            raise LexiconError(f"{origin}: min_groups {min_groups} exceeds {len(groups)} groups")
        return TacticDefinition(name=name, weight=weight, veto=veto, groups=groups, min_groups=min_groups)

    matcher = _compile_alternation(_collect_patterns(payload, origin), origin)
    if matcher is None:
        raise LexiconError(f"{origin}: no terms or patterns")
    return TacticDefinition(name=name, weight=weight, matcher=matcher, veto=veto)


def load_tactics(directory: Path) -> list[TacticDefinition]:
    """Load every tactic definition in `directory`.

    A malformed file is skipped with a warning rather than failing startup: the
    engine degrades to the tactics it could load, and /api/health reports the count.
    """
    if not directory.is_dir():
        logger.warning("lexicon directory missing path=%s", directory)
        return []

    tactics: list[TacticDefinition] = []
    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("lexicon unreadable file=%s error=%s", path.name, exc)
            continue
        if not isinstance(payload, dict) or "tactic" not in payload:
            continue
        try:
            tactics.append(_build_tactic(payload, path.name))
        except (LexiconError, KeyError, TypeError, ValueError) as exc:
            logger.warning("lexicon invalid file=%s error=%s", path.name, exc)

    logger.info("lexicons loaded count=%d dir=%s", len(tactics), directory)
    return tactics


def load_json_config(path: Path) -> dict:
    """Load a non-tactic support file, returning {} if it is missing or broken."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("config unreadable file=%s error=%s", path.name, exc)
        return {}
    return payload if isinstance(payload, dict) else {}
