"""Classify what the learner just said, so the caller reacts to its intent.

Rule-based and multilingual (English, Hindi, Gujarati and romanized forms). Used
to pick a reactive scripted fallback when the LLM is unavailable, and to detect
silence so the caller prods instead of advancing the script as if answered.
"""

from __future__ import annotations

import re
from typing import Literal

TranscriptClass = Literal["silence", "refusal", "question", "stall", "compliance", "other"]

# Below this, the mic caught nothing worth reacting to; treat it as silence.
_MIN_MEANINGFUL_CHARS = 2

_REFUSAL = re.compile(
    r"\b(no|not|won'?t|will not|never|refuse|refusing|reject|don'?t|cannot|can'?t|"
    r"nahi|nahin|nai|nathi|mat|na)\b"
    r"|नह\S{0,3}|\bमत\b|\bना\b|નહ\S{0,3}|\bના\b|\bનથ\S{0,2}",
    re.IGNORECASE | re.UNICODE,
)
_QUESTION = re.compile(
    r"\?|\b(who|which|what|why|where|how|whom|whose)\b"
    r"|\b(kaun|kaunsa|kaunsi|kyun|kyu|kya|kaha|kahan|kaise|kis|konu|kyo|kyaru)\b"
    r"|कौन|कौन\S*|क्यों|क्या|कहा\S*|कैसे|किस|किसक\S*"
    r"|કોણ|કયો|કયું|કઈ|શા|શું|ક્યાં|કેમ|કોના",
    re.IGNORECASE | re.UNICODE,
)
_STALL = re.compile(
    r"\b(wait|hold on|later|call back|call my|let me|check with|talk to|"
    r"my son|my wife|my husband|my bank|my family|one minute|ek minute|ruk|thoda|thodi|baad)\b"
    r"|बाद में|रुक\S*|थोड़\S*|बेटे|पति|पत्नी|बैंक से पूछ|परिवार"
    r"|પછી|ઊભા? રહો|થોડ\S*|દીકરા|પતિ|પત્ની|બેંક ને પૂછ|પરિવાર",
    re.IGNORECASE | re.UNICODE,
)
_COMPLIANCE = re.compile(
    r"\d{3,}"
    r"|\b(ok|okay|yes|yeah|sure|fine|sending|sent|done|theek|thik|haan|han|ha|bara?bar)\b"
    r"|हाँ|हां|ठीक|भेज\S*|कर दिय\S*"
    r"|હા|બરાબર|ઠીક|મોકલ\S*|કરી દીધ\S*",
    re.IGNORECASE | re.UNICODE,
)


def classify(message: str) -> TranscriptClass:
    """The learner's intent this turn. Order encodes priority: a refusal is the
    most useful thing for the caller to push back on, then a question to deflect,
    then a stall, then compliance to pounce on; anything else is off-topic."""
    text = message.strip()
    if len(text) < _MIN_MEANINGFUL_CHARS:
        return "silence"
    if _REFUSAL.search(text):
        return "refusal"
    if _QUESTION.search(text):
        return "question"
    if _STALL.search(text):
        return "stall"
    if _COMPLIANCE.search(text):
        return "compliance"
    return "other"
