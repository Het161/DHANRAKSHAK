from __future__ import annotations

from pathlib import Path

import pytest

from app.config import get_settings
from app.schemas.contracts import Language, PersonaId
from app.simulator.coach import evaluate
from app.simulator.personas import PersonaLibrary


@pytest.fixture(scope="module")
def personas() -> PersonaLibrary:
    return PersonaLibrary.load(Path(get_settings().persona_dir))


def coach(personas: PersonaLibrary, persona_id: PersonaId, message: str, lang: Language = "en"):
    persona = personas.get(persona_id)
    assert persona is not None, persona_id
    return evaluate(persona, message, lang)


@pytest.mark.parametrize(
    ("persona_id", "lang", "message"),
    [
        ("digital_arrest", "en", "Who are you? I will not send any money."),
        ("digital_arrest", "en", "I will not share my OTP with you."),
        ("digital_arrest", "hi", "मैं पैसे नहीं भेजूंगा, मैं 1930 पर शिकायत करूंगा।"),
        ("digital_arrest", "hi", "मैं ओटीपी नहीं बताऊंगा।"),
        ("lottery", "gu", "હું પ્રોસેસિંગ ફી નહીં ભરું."),
        ("fake_kyc", "en", "I am not installing AnyDesk on my phone."),
        ("loan_app", "en", "I will not pay you anything. I am reporting this."),
    ],
)
def test_correct_refusals_are_rewarded(
    personas: PersonaLibrary, persona_id: PersonaId, lang: Language, message: str
) -> None:
    result = coach(personas, persona_id, message, lang)
    assert result.score_delta > 0, f"{message!r} scored {result.score_delta}"
    assert result.tip.strip()


@pytest.mark.parametrize(
    ("persona_id", "message"),
    [
        ("digital_arrest", "Okay sir, my OTP is 456789"),
        ("loan_app", "I will pay the settlement amount right now."),
        ("fake_kyc", "I have installed AnyDesk, what is the code?"),
    ],
)
def test_mistakes_are_penalised(
    personas: PersonaLibrary, persona_id: PersonaId, message: str
) -> None:
    result = coach(personas, persona_id, message)
    assert result.score_delta < 0, f"{message!r} scored {result.score_delta}"


def test_refusing_to_pay_is_not_credited_as_a_credential_refusal(
    personas: PersonaLibrary,
) -> None:
    # The bare verb "send" used to match both, so refusing to pay money was
    # explained back to the user as if they had protected their OTP.
    result = coach(personas, "digital_arrest", "Who are you? I will not send any money.")
    assert result.tactic_revealed != "credential_request"


def test_negated_mistake_does_not_scold(personas: PersonaLibrary) -> None:
    refused = coach(personas, "fake_kyc", "I am not installing AnyDesk on my phone.")
    accepted = coach(personas, "fake_kyc", "I have installed AnyDesk, what is the code?")

    assert refused.score_delta > 0
    assert accepted.score_delta < 0
    assert refused.tip != accepted.tip


def test_unrecognised_reply_is_neutral(personas: PersonaLibrary) -> None:
    result = coach(personas, "lottery", "hmm ok")
    assert result.score_delta == 0
    assert result.tactic_revealed is None
    assert result.tip.strip()
