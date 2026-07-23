from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.schemas.contracts import Gender, Language

logger = logging.getLogger(__name__)

_LOCALES: dict[Language, str] = {"gu": "gu-IN", "hi": "hi-IN", "en": "en-IN"}

# Preference order within a locale and gender. Selection still happens against
# the live voice list; these only break ties, so a renamed or withdrawn voice
# falls through to whatever Microsoft currently offers for that locale.
_PREFERRED: dict[tuple[str, Gender], tuple[str, ...]] = {
    ("gu-IN", "male"): ("gu-IN-NiranjanNeural",),
    ("gu-IN", "female"): ("gu-IN-DhwaniNeural",),
    ("hi-IN", "male"): ("hi-IN-MadhurNeural",),
    ("hi-IN", "female"): ("hi-IN-SwaraNeural",),
    # The expressive variant carries the urgency a scam caller uses; the plain
    # one is the fallback if it disappears.
    ("en-IN", "male"): ("en-IN-PrabhatNeural",),
    ("en-IN", "female"): ("en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural"),
}

# Used only when the voice list cannot be fetched at all, so that a network
# blip at startup does not leave the product mute.
_LAST_RESORT: dict[tuple[str, Gender], str] = {
    ("gu-IN", "male"): "gu-IN-NiranjanNeural",
    ("gu-IN", "female"): "gu-IN-DhwaniNeural",
    ("hi-IN", "male"): "hi-IN-MadhurNeural",
    ("hi-IN", "female"): "hi-IN-SwaraNeural",
    ("en-IN", "male"): "en-IN-PrabhatNeural",
    ("en-IN", "female"): "en-IN-NeerjaNeural",
}


@dataclass(frozen=True, slots=True)
class VoiceRegistry:
    """Which neural voice speaks for each language and gender."""

    voices: dict[tuple[Language, Gender], str]
    discovered: bool

    def resolve(self, lang: Language, gender: Gender) -> str | None:
        return self.voices.get((lang, gender))

    def as_health(self) -> dict[str, str]:
        return {f"{lang}:{gender}": name for (lang, gender), name in sorted(self.voices.items())}


def _select(catalogue: list[dict], locale: str, gender: Gender) -> str | None:
    wanted = gender.capitalize()
    available = {
        voice["ShortName"]
        for voice in catalogue
        if voice.get("Locale") == locale and voice.get("Gender") == wanted
    }
    if not available:
        return None
    for preferred in _PREFERRED.get((locale, gender), ()):
        if preferred in available:
            return preferred
    return sorted(available)[0]


async def discover(timeout_s: float) -> VoiceRegistry:
    """Build the registry from the live voice list, falling back to known names."""
    catalogue: list[dict] = []
    try:
        import edge_tts

        async with asyncio.timeout(timeout_s):
            catalogue = await edge_tts.list_voices()
    except Exception as exc:  # noqa: BLE001 - startup must not depend on a third party
        logger.warning("tts voice discovery failed error=%s; using known voice names", exc)

    voices: dict[tuple[Language, Gender], str] = {}
    for lang, locale in _LOCALES.items():
        for gender in ("male", "female"):
            typed_gender: Gender = gender  # type: ignore[assignment]
            chosen = _select(catalogue, locale, typed_gender) if catalogue else None
            chosen = chosen or _LAST_RESORT.get((locale, typed_gender))
            if chosen:
                voices[(lang, typed_gender)] = chosen

    registry = VoiceRegistry(voices=voices, discovered=bool(catalogue))
    logger.info(
        "tts voices resolved discovered=%s count=%d %s",
        registry.discovered,
        len(voices),
        registry.as_health(),
    )
    return registry
