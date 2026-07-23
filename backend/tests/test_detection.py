from __future__ import annotations

import pytest
from samples import ALL_SAMPLES, SAFE_SAMPLES, SCAM_SAMPLES, Sample

from app.config import get_settings
from app.detection.engine import DetectionEngine
from app.detection.upi import parse_upi_intents
from app.detection.urls import extract_urls, registrable_domain
from app.schemas.contracts import Signals


@pytest.fixture(scope="module")
def engine() -> DetectionEngine:
    return DetectionEngine.build(get_settings())


def signal_names(signals: Signals) -> set[str]:
    return (
        {tactic.name for tactic in signals.tactics}
        | {flag.reason for flag in signals.url_flags}
        | {flag.reason for flag in signals.upi_flags}
    )


@pytest.mark.parametrize("sample", SCAM_SAMPLES, ids=lambda sample: sample.id)
def test_scam_samples_are_flagged(engine: DetectionEngine, sample: Sample) -> None:
    signals = engine.analyze_sync(sample.text, sample.lang)
    assert signals.label == "scam", f"{sample.id} scored {signals.risk_score} ({signals.label})"
    assert signal_names(signals) & set(sample.expect_any_of), (
        f"{sample.id} matched {sorted(signal_names(signals))}, expected one of {sorted(sample.expect_any_of)}"
    )


@pytest.mark.parametrize("sample", SAFE_SAMPLES, ids=lambda sample: sample.id)
def test_safe_samples_are_not_flagged(engine: DetectionEngine, sample: Sample) -> None:
    signals = engine.analyze_sync(sample.text, sample.lang)
    assert signals.label == "safe", (
        f"{sample.id} scored {signals.risk_score} on {sorted(signal_names(signals))}"
    )


@pytest.mark.parametrize("sample", ALL_SAMPLES, ids=lambda sample: sample.id)
def test_evidence_spans_are_inside_the_input(engine: DetectionEngine, sample: Sample) -> None:
    signals = engine.analyze_sync(sample.text, sample.lang)
    for tactic in signals.tactics:
        start, end = tactic.evidence_span
        assert 0 <= start < end <= len(sample.text)
        assert sample.text[start:end].strip()


def test_engine_never_raises_on_hostile_input(engine: DetectionEngine) -> None:
    for text in ("", " ", "\x00\x01", "a" * 10_000, "😀" * 200, "upi://", "http://", "@@@"):
        signals = engine.analyze_sync(text, "en")
        assert 0 <= signals.risk_score <= 100


def test_empty_input_is_safe(engine: DetectionEngine) -> None:
    signals = engine.analyze_sync("", "en")
    assert signals.label == "safe"
    assert signals.risk_score == 0 or signals.classifier_score is not None


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("www.onlinesbi.sbi", "onlinesbi.sbi"),
        ("retail.hdfcbank.com", "hdfcbank.com"),
        ("secure.login.sbi.co.in", "sbi.co.in"),
        ("npci.org.in", "npci.org.in"),
    ],
)
def test_registrable_domain(host: str, expected: str) -> None:
    assert registrable_domain(host) == expected


def test_amounts_are_not_mistaken_for_urls() -> None:
    assert extract_urls("Rs.2500 debited, bal Rs.18340.50") == []


def test_upi_collect_intent_is_parsed() -> None:
    intents = parse_upi_intents("upi://collect?pa=refund@ybl&pn=Refund&am=5000")
    assert len(intents) == 1
    assert intents[0].is_collect
    assert intents[0].vpa == "refund@ybl"
    assert intents[0].amount == "5000"
