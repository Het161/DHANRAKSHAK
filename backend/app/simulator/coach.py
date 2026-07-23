from __future__ import annotations

import re

from app.schemas.contracts import Coach, Language
from app.simulator.personas import EvaluationRule, Persona

# One reply rarely deserves more than one lesson; the strongest match is the one
# worth teaching, and the rest only move the score.
_MAX_DELTA = 40

# "I am not installing that app" contains the same words as agreeing to install
# it. Without this, a learner doing exactly the right thing was scolded for it.
# The window is deliberately short so that a negation earlier in the sentence
# ("I did not think, I already sent the OTP") does not cancel a real mistake.
_NEGATION_WINDOW = 14
_NEGATION_RE = re.compile(
    r"(?:\b(?:not|won'?t|wont|never|refuse|refusing|cannot|can'?t|neither|nor)\b"
    r"|नह\S{0,3}|\bमत\b|નહ\S{0,3}|\bન\b|\bnahi\S*|\bnathi\b|\bmat\b)\W*$",
    re.IGNORECASE,
)


def _is_negated(message: str, start: int) -> bool:
    return _NEGATION_RE.search(message[max(0, start - _NEGATION_WINDOW) : start]) is not None


def _effective_spans(rule: EvaluationRule, message: str) -> list[tuple[int, int]]:
    """Matches that still count once negation is taken into account.

    Only mistakes are filtered: negating a good action ("I will not refuse") is
    vanishingly rare in practice, and dropping it would cost the learner credit.
    """
    spans = [(match.start(), match.end()) for match in rule.matcher.finditer(message)]
    if rule.weight >= 0:
        return spans
    return [span for span in spans if not _is_negated(message, span[0])]


def _longest(spans: list[tuple[int, int]]) -> int:
    return max((end - start for start, end in spans), default=0)


def evaluate(persona: Persona, message: str, lang: Language) -> Coach:
    """Score a learner's reply against the persona's refusal criteria.

    Rule-based on purpose: the coach must give the same feedback for the same
    answer every time, including when no LLM is reachable.
    """
    matched: list[tuple[EvaluationRule, int]] = []
    for rule in (*persona.bad, *persona.good):
        spans = _effective_spans(rule, message)
        if spans:
            matched.append((rule, _longest(spans)))

    if not matched:
        return Coach(tactic_revealed=None, tip=persona.neutral_tip.get(lang), score_delta=0)

    # A mistake is always the more useful thing to point out, even in a reply
    # that also did something right. Between rules of equal standing the longer
    # match wins: it is the one that understood more of the sentence.
    mistakes = [entry for entry in matched if entry[0].weight < 0]
    dominant = (
        min(mistakes, key=lambda entry: (entry[0].weight, -entry[1]))
        if mistakes
        else max(matched, key=lambda entry: (entry[1], entry[0].weight))
    )[0]

    delta = sum(rule.weight for rule, _ in matched)
    return Coach(
        tactic_revealed=dominant.tactic_revealed,
        tip=dominant.tip.get(lang) or persona.neutral_tip.get(lang),
        score_delta=max(-_MAX_DELTA, min(_MAX_DELTA, delta)),
    )
