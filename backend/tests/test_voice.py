from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from app.config import get_settings
from app.tts.cache import AudioCache
from app.tts.registry import VoiceRegistry, _select
from app.util.sentences import split_sentences, take_sentence


class TestSentenceCutting:
    """Cutting the model's stream at the first sentence is what starts speech
    before generation finishes, so the boundary rules matter."""

    def test_waits_for_a_complete_sentence(self) -> None:
        assert take_sentence("Do not disconnect the")[0] is None

    def test_cuts_at_the_first_boundary(self) -> None:
        sentence, rest = take_sentence("Do not disconnect the call. An officer is coming.")
        assert sentence == "Do not disconnect the call."
        assert rest == "An officer is coming."

    @pytest.mark.parametrize(
        "text",
        [
            "તમે પૈસા નહીં મોકલો તો ધરપકડ થશે. હમણાં જ ભરો.",
            "आप पैसे नहीं भेजेंगे तो गिरफ्तारी होगी। अभी भरिए।",
        ],
    )
    def test_handles_the_danda_and_full_stop(self, text: str) -> None:
        sentence, rest = take_sentence(text)
        assert sentence and rest
        assert sentence != text

    def test_does_not_cut_on_an_abbreviation(self) -> None:
        # Too short to be a sentence, so it keeps accumulating instead of
        # speaking two syllables on their own.
        assert take_sentence("Rs. 5000 is pending")[0] is None

    def test_flush_returns_the_tail(self) -> None:
        sentence, rest = take_sentence("no punctuation here at all", flush=True)
        assert sentence == "no punctuation here at all"
        assert rest == ""

    def test_long_run_without_punctuation_is_cut_anyway(self) -> None:
        # A model that never punctuates must not stall the call forever.
        sentence, _ = take_sentence("word " * 60)
        assert sentence is not None

    def test_split_keeps_every_part(self) -> None:
        parts = split_sentences("First one. Second one! Third one without an end")
        assert len(parts) == 3
        assert parts[-1] == "Third one without an end"


class TestVoiceRegistry:
    CATALOGUE: ClassVar[list[dict[str, str]]] = [
        {"ShortName": "gu-IN-NiranjanNeural", "Locale": "gu-IN", "Gender": "Male"},
        {"ShortName": "gu-IN-DhwaniNeural", "Locale": "gu-IN", "Gender": "Female"},
        {"ShortName": "en-IN-NeerjaNeural", "Locale": "en-IN", "Gender": "Female"},
        {"ShortName": "en-IN-NeerjaExpressiveNeural", "Locale": "en-IN", "Gender": "Female"},
    ]

    def test_selects_by_locale_and_gender(self) -> None:
        assert _select(self.CATALOGUE, "gu-IN", "male") == "gu-IN-NiranjanNeural"
        assert _select(self.CATALOGUE, "gu-IN", "female") == "gu-IN-DhwaniNeural"

    def test_preference_order_breaks_ties(self) -> None:
        assert _select(self.CATALOGUE, "en-IN", "female") == "en-IN-NeerjaExpressiveNeural"

    def test_missing_combination_returns_none(self) -> None:
        assert _select(self.CATALOGUE, "en-IN", "male") is None

    def test_health_shape(self) -> None:
        registry = VoiceRegistry(voices={("gu", "male"): "gu-IN-NiranjanNeural"}, discovered=True)
        assert registry.resolve("gu", "male") == "gu-IN-NiranjanNeural"
        assert registry.resolve("hi", "male") is None
        assert registry.as_health() == {"gu:male": "gu-IN-NiranjanNeural"}


class TestAudioCache:
    def test_round_trip(self, tmp_path: Path) -> None:
        cache = AudioCache(tmp_path, max_bytes=1_000_000)
        assert cache.get("hello", "voice-a") is None
        cache.put("hello", "voice-a", b"audio-bytes")
        stored = cache.get("hello", "voice-a")
        assert stored is not None and stored.read_bytes() == b"audio-bytes"

    def test_key_separates_voices(self, tmp_path: Path) -> None:
        cache = AudioCache(tmp_path, max_bytes=1_000_000)
        cache.put("hello", "voice-a", b"a")
        assert cache.get("hello", "voice-b") is None

    def test_eviction_respects_the_cap(self, tmp_path: Path) -> None:
        cache = AudioCache(tmp_path, max_bytes=100)
        for index in range(12):
            cache.put(f"line {index}", "voice-a", b"x" * 40)
        assert cache.total_bytes() <= 100

    def test_empty_payload_is_not_cached(self, tmp_path: Path) -> None:
        cache = AudioCache(tmp_path, max_bytes=1_000)
        assert cache.put("hello", "voice-a", b"") is None


def test_personas_expose_a_voice_prompt() -> None:
    from app.simulator.personas import PersonaLibrary

    library = PersonaLibrary.load(Path(get_settings().persona_dir))
    personas = library.all()
    assert len(personas) == 4
    for persona in personas:
        assert persona.voice_prompt.strip(), persona.id


def test_speakable_lines_cover_every_persona_language_and_gender() -> None:
    from app.explain.providers import build_llm_provider  # noqa: F401  (import cycle guard)
    from app.simulator.service import SimulatorService

    simulator = SimulatorService.build(get_settings(), None)
    lines = simulator.speakable_lines()
    # Four personas, three languages, two voices.
    assert len(lines) == 4 * 3 * 2
    assert all(text.strip() for text, _, _ in lines)
