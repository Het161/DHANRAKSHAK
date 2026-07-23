from __future__ import annotations

from app.schemas.contracts import Advisory, Flag, Language, Signals

_LANGUAGE_INSTRUCTION: dict[Language, str] = {
    "gu": "Write your entire answer in Gujarati, using Gujarati script.",
    "hi": "Write your entire answer in Hindi, using Devanagari script.",
    "en": "Write your entire answer in simple English.",
}

SYSTEM_PROMPT = """You explain a scam-detection result to someone in rural India who is using \
digital banking for the first time. They may be frightened. They are not stupid.

Rules you must follow:
- Use ONLY the signals and the advisory text given to you. Nothing else is known.
- The verdict has already been decided. Never argue with it, soften it, or change it.
- Never invent a fact, a rule, a bank name, a phone number, a law, or an advisory.
- Write about the message the user received. Never mention the analysis, the system, \
the signals, the score, or the fact that a result was produced. The user does not care \
how the answer was reached.
- Address the reader as "you". Do not greet, do not introduce yourself, do not sign off.
- Plain sentences only. No headings, no bullet points, no dashes, no bold, no emojis.

Structure your answer as:
1. Repeat the sentence given to you as OPENING, word for word, as your first sentence.
2. Then one short sentence per signal, in the order given, saying what the trick is.

Do NOT list the recommended actions. The app already shows them to the user as their own
checklist, and repeating them here shows the same advice twice. They are given to you
only so that nothing you write contradicts them.

Keep the whole answer under 90 words."""


def _flag_lines(flags: list[Flag]) -> str:
    return "\n".join(f"- {flag.name}: {flag.detail}" for flag in flags) or "- none"


def build_user_prompt(
    signals: Signals,
    flags: list[Flag],
    advisory: Advisory | None,
    actions: list[str],
    opening: str,
) -> str:
    """Assemble the grounding block.

    The evidence is passed as engine output, never as the original message: the
    model's job is to translate a decision, and giving it the raw text invites it
    to re-decide.

    `opening` is the reviewed native sentence for this verdict. Handing the model
    its first sentence rather than asking it to compose one is what keeps the most
    important line in the answer from depending on the model's Gujarati.
    """
    sections = [
        _LANGUAGE_INSTRUCTION.get(signals.lang, _LANGUAGE_INSTRUCTION["en"]),
        f"VERDICT: {signals.label}\nRISK SCORE: {signals.risk_score} out of 100",
        f"OPENING (use this exact sentence first):\n{opening}",
        f"SIGNALS FOUND:\n{_flag_lines(flags)}",
    ]
    if advisory is not None:
        sections.append(f"ADVISORY ({advisory.source}):\n{advisory.snippet}")
    if actions:
        sections.append("RECOMMENDED ACTIONS:\n" + "\n".join(f"- {action}" for action in actions))
    return "\n\n".join(sections)
