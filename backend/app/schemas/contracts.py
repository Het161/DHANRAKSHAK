from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

InputType = Literal["text", "url", "image", "audio"]
Language = Literal["gu", "hi", "en"]
LanguageHint = Literal["gu", "hi", "en", "auto"]
Verdict = Literal["safe", "suspicious", "scam"]
ExplanationSource = Literal["llm", "template"]
FlagKind = Literal["tactic", "url", "upi"]
Gender = Literal["male", "female"]

MAX_TEXT_CHARS = 10_000
# Base64 inflates by 4/3; the byte-level cap is enforced after decoding.
MAX_ENCODED_CHARS = 14_000_000
# One sentence of speech. Anything longer is a bug in the sentence splitter.
MAX_TTS_CHARS = 400


class LocalizedText(BaseModel):
    gu: str = ""
    hi: str = ""
    en: str = ""

    def get(self, lang: Language) -> str:
        return getattr(self, lang) or self.en


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_type: InputType = "text"
    content: str = Field(min_length=1, max_length=MAX_ENCODED_CHARS)
    language_hint: LanguageHint = "auto"

    @model_validator(mode="after")
    def _check_size_for_type(self) -> AnalyzeRequest:
        if self.input_type in ("text", "url") and len(self.content) > MAX_TEXT_CHARS:
            raise ValueError(f"text content exceeds {MAX_TEXT_CHARS} characters; send a shorter message")
        return self


class Tactic(BaseModel):
    """A manipulation pattern the engine found, anchored to the input text."""

    name: str
    evidence_span: tuple[int, int]
    weight: float
    explain: LocalizedText = Field(default_factory=LocalizedText)


class UrlFlag(BaseModel):
    url: str
    reason: str
    detail: str
    weight: float


class UpiFlag(BaseModel):
    reason: str
    detail: str
    weight: float
    vpa: str | None = None
    amount: str | None = None


class Signals(BaseModel):
    """Internal engine output. Deterministic, interpretable, no LLM involvement."""

    label: Verdict
    risk_score: int = Field(ge=0, le=100)
    tactics: list[Tactic] = Field(default_factory=list)
    url_flags: list[UrlFlag] = Field(default_factory=list)
    upi_flags: list[UpiFlag] = Field(default_factory=list)
    lang: Language = "en"
    classifier_score: float | None = None


class Flag(BaseModel):
    """A single signal, flattened and localized for the client.

    `name` is the stable machine code (safe to key an icon or a filter off);
    `detail` and `action` are already in the reader's language.
    """

    kind: FlagKind
    name: str
    detail: str
    action: str = ""
    weight: float
    evidence_span: tuple[int, int] | None = None


class Advisory(BaseModel):
    source: str
    ref: str
    snippet: str


class AnalyzeResponse(BaseModel):
    verdict: Verdict
    risk_score: int = Field(ge=0, le=100)
    flags: list[Flag] = Field(default_factory=list)
    advisory: Advisory | None = None
    actions: list[str] = Field(default_factory=list)
    lang: Language
    # The exact text the engine scored. Evidence spans index into this string,
    # and for image and audio input it is the only copy the client has.
    analyzed_text: str = ""
    explanation: str = ""
    explanation_source: ExplanationSource = "template"
    # Per-stage timings for ?debug=1 (image path populates OCR + engine timings).
    debug: dict[str, Any] | None = None


class DonePayload(BaseModel):
    explanation: str
    explanation_source: ExplanationSource
    latency_ms: int


class ErrorPayload(BaseModel):
    code: str
    message: str
    # A machine-readable next step, e.g. "paste_text" when OCR could not read the
    # screenshot, so the UI can offer a helpful path instead of a dead end.
    suggestion: str | None = None


SSEEventType = Literal["verdict", "token", "done", "error"]
# The voice call streams a different event family down the same envelope.
VoiceEventType = Literal["sentence", "coach", "tts_unavailable", "done", "error"]


class SSEEvent(BaseModel):
    type: SSEEventType
    payload: dict[str, Any]


PersonaId = Literal["digital_arrest", "fake_kyc", "lottery", "loan_app"]


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    persona: PersonaId
    lang: Language = "en"


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2_000)


class Coach(BaseModel):
    tactic_revealed: str | None = None
    tip: str
    score_delta: int


class StartResponse(BaseModel):
    session_id: str
    scammer_text: str
    persona: PersonaId
    lang: Language
    turn: int = 0
    # Debug only (populated for ?debug=1): the session seed and scenario plan,
    # so a tester can see that two sessions really were planned differently.
    seed: int | None = None
    plan: dict[str, Any] | None = None


class TTSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Synthesis is per sentence by design: a shorter clip starts playing sooner.
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    lang: Language = "en"
    gender: Gender = "male"


class VoiceTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2_000)
    gender: Gender = "male"


class SentencePayload(BaseModel):
    """One speakable sentence, emitted the moment it is known."""

    text: str
    seq: int
    source: Literal["script", "llm"]


class VoiceDonePayload(BaseModel):
    full_text: str
    finished: bool
    score: int
    turn: int
    # Debug only (?debug=1): the exact transcript received, the bridge line, the
    # class, the path (llm|fallback), history length and the final spoken reply.
    debug: dict[str, Any] | None = None


class TurnResponse(BaseModel):
    scammer_text: str
    coach: Coach | None = None
    finished: bool = False
    score: int = 0
    turn: int = 0
    # Which path produced this line, for the ?debug=1 overlay.
    source: Literal["llm", "fallback"] = "fallback"


class ProviderHealth(BaseModel):
    provider: str
    model: str | None = None
    configured: bool


class ClassifierHealth(BaseModel):
    loaded: bool
    path: str


class OCRHealth(BaseModel):
    available: bool
    langs: list[str] = Field(default_factory=list)


class AdvisoryHealth(BaseModel):
    documents: int
    chunks: int


class TTSHealth(BaseModel):
    provider: str
    available: bool
    voices_discovered: bool
    voices: dict[str, str] = Field(default_factory=dict)
    cache_entries: int
    cache_bytes: int


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    mode: Literal["local", "hosted"]
    uptime_s: float
    llm: ProviderHealth
    stt: ProviderHealth
    classifier: ClassifierHealth
    ocr: OCRHealth
    advisories: AdvisoryHealth
    lexicons_loaded: int
    templates_loaded: int
    tts: TTSHealth
