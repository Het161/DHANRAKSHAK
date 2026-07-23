from __future__ import annotations

import logging

from app.schemas.contracts import Language, LanguageHint

logger = logging.getLogger(__name__)

_GUJARATI = range(0x0A80, 0x0B00)
_DEVANAGARI = range(0x0900, 0x0980)
# Below this share of letters, an Indic word is a loanword inside English text
# rather than the language of the message.
_SCRIPT_SHARE = 0.15

try:
    from langdetect import DetectorFactory, LangDetectException, detect

    DetectorFactory.seed = 0
    _LANGDETECT_AVAILABLE = True
except ImportError:  # pragma: no cover - langdetect is a hard requirement in practice
    _LANGDETECT_AVAILABLE = False
    logger.warning("langdetect unavailable; falling back to script detection only")


def _script_language(text: str) -> Language | None:
    letters = gujarati = devanagari = 0
    for char in text:
        if not char.isalpha():
            continue
        letters += 1
        code = ord(char)
        if code in _GUJARATI:
            gujarati += 1
        elif code in _DEVANAGARI:
            devanagari += 1
    if not letters:
        return None
    if gujarati / letters >= _SCRIPT_SHARE:
        return "gu"
    if devanagari / letters >= _SCRIPT_SHARE:
        return "hi"
    return None


def detect_language(text: str, hint: LanguageHint = "auto") -> Language:
    """Resolve the language to answer in.

    Script ranges settle Gujarati and Hindi without any model, which covers the
    cases that matter most. Romanized Hinglish is indistinguishable from English
    to any cheap detector, so it resolves to English and the lexicons carry it.
    """
    if hint != "auto":
        return hint
    if (script := _script_language(text)) is not None:
        return script
    if _LANGDETECT_AVAILABLE and len(text.strip()) >= 20:
        try:
            detected = detect(text)
        except LangDetectException:
            return "en"
        if detected in ("hi", "mr", "ne"):
            return "hi"
        if detected == "gu":
            return "gu"
    return "en"
