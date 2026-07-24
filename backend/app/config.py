from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent

LLMProviderName = Literal["ollama", "groq", "none"]
STTProviderName = Literal["groq", "local", "none"]


class Settings(BaseSettings):
    """Single source of truth for runtime configuration.

    The LOCAL/HOSTED distinction is not a code branch anywhere in the app; it is
    entirely a consequence of which provider names are configured here.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # `model_path` and friends would otherwise collide with pydantic's
        # protected `model_` namespace.
        protected_namespaces=(),
    )

    app_name: str = "DhanRakshak"
    app_version: str = "1.0.0"
    log_level: str = "INFO"

    llm_provider: LLMProviderName = "groq"
    stt_provider: STTProviderName = "groq"

    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "llama-3.3-70b-versatile"
    groq_fallback_model: str = "llama-3.1-8b-instant"
    groq_stt_model: str = "whisper-large-v3-turbo"

    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b"

    local_whisper_model: str = "small"
    local_whisper_compute_type: str = "int8"

    # Tier 3 is best effort by definition: the budget is a hard ceiling, not a
    # target. Exceeding it drops to templates rather than delaying the response.
    llm_timeout_s: float = 8.0
    llm_connect_timeout_s: float = 3.0
    llm_max_tokens: int = 400
    llm_temperature: float = 0.2
    llm_warmup_enabled: bool = True

    stt_timeout_s: float = 30.0
    ocr_timeout_s: float = 15.0

    # Voice mode runs on the smallest fast model: a phone scammer speaks in
    # short bursts, and short replies are also what keeps the turn under a second.
    groq_voice_model: str = "llama-3.1-8b-instant"
    # Indic scripts cost far more tokens per word than English; too tight a cap
    # truncates the reply mid-sentence. Cutting happens at the sentence
    # boundary anyway, so a higher ceiling costs no latency.
    voice_llm_max_tokens: int = 160
    voice_llm_timeout_s: float = 6.0
    # Roleplay wants variation, so the simulator runs hot. This is separate from
    # llm_temperature (kept low), which the detection explainer uses.
    persona_temperature: float = 0.9
    # Two short bursts is how a caller actually talks, and it bounds the turn.
    voice_max_sentences: int = 2

    tts_enabled: bool = True
    tts_timeout_s: float = 5.0
    tts_discovery_timeout_s: float = 8.0
    tts_cache_dir: Path = Path("/tmp/tts-cache")
    tts_cache_max_bytes: int = 200 * 1024 * 1024
    tts_prewarm_enabled: bool = True
    tts_prewarm_concurrency: int = 8
    rate_limit_tts: str = "120/minute"

    # NoDecode stops pydantic-settings from JSON-parsing the raw env value, which
    # would reject the comma-separated form before the validator below can split it.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"]
    )

    rate_limit_enabled: bool = True
    rate_limit_default: str = "60/minute"
    rate_limit_analyze: str = "20/minute"
    rate_limit_simulator: str = "40/minute"

    max_text_chars: int = 10_000
    max_image_bytes: int = 5 * 1024 * 1024
    max_audio_bytes: int = 10 * 1024 * 1024
    max_audio_seconds: int = 90

    cache_size: int = 500
    cache_ttl_s: int = 900

    # Fusion thresholds. Named here so tuning never means editing detection code.
    risk_suspicious_threshold: int = 35
    risk_scam_threshold: int = 65
    # Ceiling on how much risk the classifier alone may contribute, so a model
    # trained on public spam data can raise suspicion but never drive the verdict.
    classifier_weight: float = 0.50
    # P(scam) below this is treated as no evidence at all. See fusion.py.
    classifier_min_prob: float = 0.85

    simulator_max_sessions: int = 500
    simulator_session_ttl_s: int = 900
    simulator_max_turns: int = 6

    data_dir: Path = BACKEND_ROOT / "data"
    model_path: Path = BACKEND_ROOT / "models" / "scam_clf.joblib"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        # Render and most PaaS UIs only take flat strings, so the comma-separated
        # form has to work. NoDecode means this validator owns both spellings.
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"CORS_ORIGINS is not valid JSON: {exc}") from exc
        return [origin.strip() for origin in stripped.split(",") if origin.strip()]

    @field_validator("data_dir", "model_path", "tts_cache_dir", mode="before")
    @classmethod
    def _resolve_path(cls, value: object) -> object:
        if isinstance(value, str) and not Path(value).is_absolute():
            return BACKEND_ROOT / value
        return value

    @property
    def mode(self) -> Literal["local", "hosted"]:
        return "local" if self.llm_provider == "ollama" else "hosted"

    @property
    def llm_model(self) -> str:
        return self.ollama_model if self.llm_provider == "ollama" else self.groq_model

    @property
    def lexicon_dir(self) -> Path:
        return self.data_dir / "lexicons"

    @property
    def advisory_dir(self) -> Path:
        return self.data_dir / "advisories"

    @property
    def template_dir(self) -> Path:
        return self.data_dir / "templates"

    @property
    def persona_dir(self) -> Path:
        return self.data_dir / "personas"


@lru_cache
def get_settings() -> Settings:
    return Settings()
