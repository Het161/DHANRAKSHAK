from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.pipelines.language import detect_language
from app.schemas.contracts import InputType, Language, LanguageHint

# Zero-width and bidirectional control characters are a cheap way to break
# keyword matching while looking identical on screen.
_INVISIBLE_RE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WHITESPACE_RE = re.compile("[ \\t\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True, slots=True)
class CleanInput:
    """The single shape every input type collapses to before detection runs."""

    text: str
    lang: Language
    source: InputType


def clean_text(raw: str) -> str:
    text = unicodedata.normalize("NFC", raw)
    text = _INVISIBLE_RE.sub("", text)
    text = _CONTROL_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text)
    text = _BLANK_LINES_RE.sub("\n\n", text)
    return text.strip()


def normalize(raw: str, hint: LanguageHint, source: InputType) -> CleanInput:
    """Clean the text and resolve its language.

    Evidence spans are computed against the cleaned text, which is why every
    response echoes it back as `analyzed_text`.
    """
    text = clean_text(raw)
    return CleanInput(text=text, lang=detect_language(text, hint), source=source)
