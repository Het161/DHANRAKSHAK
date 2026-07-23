from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from app.schemas.contracts import Language, LocalizedText, Signals, Verdict

logger = logging.getLogger(__name__)

_LANGUAGES: tuple[Language, ...] = ("en", "hi", "gu")
_FALLBACK_LANGUAGE: Language = "en"
_MAX_EXPLAINED_FLAGS = 4


@dataclass(frozen=True, slots=True)
class FlagText:
    why: str
    do: str


class TemplateLibrary:
    """Tier-3 fallback wording, and the source of every flag's one-line explanation.

    These strings are not a placeholder for the LLM: when a provider is down they
    are what the user reads, so they are written to stand alone.
    """

    def __init__(self, payloads: dict[Language, dict]) -> None:
        self._payloads = payloads

    @property
    def language_count(self) -> int:
        return len(self._payloads)

    @classmethod
    def load(cls, directory: Path) -> TemplateLibrary:
        payloads: dict[Language, dict] = {}
        for lang in _LANGUAGES:
            path = directory / f"explanations.{lang}.json"
            try:
                payloads[lang] = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("templates unreadable lang=%s error=%s", lang, exc)
        if _FALLBACK_LANGUAGE not in payloads:
            logger.error("english templates missing in %s; explanations will be sparse", directory)
        logger.info("templates loaded languages=%s", sorted(payloads))
        return cls(payloads)

    def _lookup(self, lang: Language, *path: str) -> str:
        for candidate in (lang, _FALLBACK_LANGUAGE):
            node: object = self._payloads.get(candidate)
            for key in path:
                if not isinstance(node, dict):
                    node = None
                    break
                node = node.get(key)
            if isinstance(node, str) and node:
                return node
        return ""

    def flag_text(self, name: str, lang: Language) -> FlagText:
        return FlagText(
            why=self._lookup(lang, "flags", name, "why"),
            do=self._lookup(lang, "flags", name, "do"),
        )

    def localized_flag(self, name: str) -> LocalizedText:
        return LocalizedText(**{lang: self.flag_text(name, lang).why for lang in _LANGUAGES})

    def verdict_intro(self, verdict: Verdict, lang: Language) -> str:
        return self._lookup(lang, "verdict_intro", verdict)

    def no_flags(self, lang: Language) -> str:
        return self._lookup(lang, "no_flags")

    def actions(self, verdict: Verdict, lang: Language) -> list[str]:
        for candidate in (lang, _FALLBACK_LANGUAGE):
            payload = self._payloads.get(candidate, {})
            actions = payload.get("actions", {}).get(verdict)
            if isinstance(actions, list) and actions:
                return [str(action) for action in actions]
        return []

    def render(self, signals: Signals, flag_names: list[str]) -> str:
        """Compose the narrative half of the answer, without any model involvement.

        Deliberately not the whole answer: `actions` and `advisory` travel as
        structured fields and are rendered separately, so repeating them here
        would print the same guidance to the user twice.
        """
        lang = signals.lang
        parts = [self.verdict_intro(signals.label, lang)]

        reasons = [
            why for name in flag_names[:_MAX_EXPLAINED_FLAGS] if (why := self.flag_text(name, lang).why)
        ]
        parts.append("\n".join(reasons) if reasons else self.no_flags(lang))

        return "\n\n".join(part for part in parts if part).strip()
