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


# --- transaction-alert classifier veto -------------------------------------

# Genuine bank alerts the spam-trained classifier misreads (P(scam)~0.99). With no
# rule/URL/UPI signal, the classifier's vote is vetoed and these must read SAFE.
GENUINE_ALERTS = [
    "INR 280.00 debited\nA/c no. XX9670\nUPI/P2M/658182359589/Mahakali petroleum\n"
    "Not you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    "Rs 500 credited to A/c XX1234 on 03-08-26 by UPI/P2A/1234/Rahul. -HDFC Bank",
    "Rs.45000.00 credited to A/c XXXX3321 by NEFT salary. Avl Bal Rs.51203.22. -ICICI",
    "Rs 199 debited for Netflix autopay from A/c XX5566. -Kotak Bank",
    # account notices with no debit/credit verb, and an OTP delivery
    "Dear Customer, the available balance in your Canara Bank A/c XXXX8890 is Rs 12,340.55.",
    "Mini statement A/c X9670: 01Aug Cr 45000.00; 02Aug Dr 280.00. -Axis Bank",
    "123456 is your OTP for login. Do not share your OTP with anyone. -HDFC Bank",
]

# Scams wearing an alert's clothes: each carries a real signal (link / OTP request /
# threat / UPI trap), so the veto must NOT silence them - they stay flagged.
DISGUISED_SCAMS = [
    "INR 50000 debited from A/c XX1234. If not you, click http://axis-reverse.xyz/cancel now",
    "Rs 9999 debited without approval. Call 9876543210 and share the OTP to reverse it.",
    "Your account will be blocked. Rs 2000 debited. Complete KYC at http://sbi-kyc.top to unblock",
    "Rs 5000 credited as reward! Enter your UPI PIN to receive the cashback in your account",
]


@pytest.mark.parametrize("text", GENUINE_ALERTS)
def test_genuine_transaction_alert_reads_safe(engine: DetectionEngine, text: str) -> None:
    signals = engine.analyze_sync(text, "en")
    assert signals.label == "safe", f"scored {signals.risk_score} on {sorted(signal_names(signals))}"
    assert signals.classifier_score is None  # the vote was vetoed


@pytest.mark.parametrize("text", DISGUISED_SCAMS)
def test_alert_shaped_scam_still_flagged(engine: DetectionEngine, text: str) -> None:
    signals = engine.analyze_sync(text, "en")
    assert signals.label != "safe", f"alert-shaped scam slipped through: {text[:60]}"


def test_veto_only_fires_on_a_real_alert_shape() -> None:
    from app.detection.transaction import is_benign_alert

    assert is_benign_alert("INR 280.00 debited A/c no. XX9670 UPI/P2M/1 Axis Bank")
    assert is_benign_alert("Rs.45000 credited to A/c XXXX3321 by NEFT")
    assert is_benign_alert("Available balance in your A/c XXXX8890 is Rs 12,340")
    assert is_benign_alert("Mini statement A/c X9670: 01Aug Cr 45000.00; 02Aug Dr 280.00")
    assert is_benign_alert("123456 is your OTP for login. Do not share it with anyone.")
    # Scams are not benign alerts, so the veto never applies to them.
    assert not is_benign_alert("Congratulations you won a lottery, share your OTP to claim")
    assert not is_benign_alert("Your OTP is 4499, please share this OTP with our bank executive")
    assert not is_benign_alert("hello how are you, see you at 5pm")
