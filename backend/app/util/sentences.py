from __future__ import annotations

import re

# Latin full stop plus the Devanagari and Gujarati danda.
_BOUNDARY = re.compile(r"[.!?।॥]+[\"')\]]*(?=\s|$)")

# Short but real sentences ("Listen to me.") are common in speech, so length
# alone cannot decide. Abbreviations are recognised by the token in front of the
# stop instead, which is what actually distinguishes "Rs." from "one."
_MIN_SENTENCE_CHARS = 8
_ABBREVIATIONS = frozenset({"rs", "mr", "mrs", "ms", "dr", "no", "vs", "smt", "sh", "st", "a/c"})
# Above this we cut anyway: a model that never punctuates must not stall speech.
_MAX_PENDING_CHARS = 180


def _ends_in_abbreviation(candidate: str) -> bool:
    """True when the stop belongs to a word like "Rs." or a single initial."""
    head = candidate.rstrip(".!?।॥\"')]}")
    token = head.rsplit(" ", 1)[-1].lower() if head else ""
    return token in _ABBREVIATIONS or (len(token) == 1 and token.isalpha())


def take_sentence(buffer: str, *, flush: bool = False) -> tuple[str | None, str]:
    """Pull the first speakable sentence out of a growing buffer.

    Returns the sentence and what is left. This is what turns a token stream
    into speech that can start before the model has finished thinking.
    """
    text = buffer.lstrip()
    if not text:
        return None, ""

    for match in _BOUNDARY.finditer(text):
        end = match.end()
        if end >= _MIN_SENTENCE_CHARS and not _ends_in_abbreviation(text[:end]):
            return text[:end].strip(), text[end:].lstrip()

    if flush:
        return text.strip(), ""

    if len(text) >= _MAX_PENDING_CHARS:
        head, separator, tail = text.rpartition(" ")
        if separator and len(head) >= _MIN_SENTENCE_CHARS:
            return head.strip(), tail
    return None, text


def split_sentences(text: str) -> list[str]:
    """Split a complete string into speakable sentences, keeping the tail."""
    sentences: list[str] = []
    remainder = text
    while remainder.strip():
        sentence, remainder = take_sentence(remainder)
        if sentence is None:
            sentence, remainder = take_sentence(remainder, flush=True)
        if sentence is None:
            break
        sentences.append(sentence)
    return sentences
