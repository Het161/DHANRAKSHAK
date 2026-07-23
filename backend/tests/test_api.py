from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.explain.providers import LLMProvider, ProviderError
from app.main import create_app

SCAM_TEXT = (
    "Dear Customer, your SBI account will be blocked today due to incomplete KYC. "
    "Share the OTP sent on your mobile with our executive immediately."
)


class FakeProvider(LLMProvider):
    name = "fake"

    def __init__(self, chunks: list[str] | None = None, error: Exception | None = None) -> None:
        self._chunks = chunks or []
        self._error = error

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        if self._error is not None:
            raise self._error
        for chunk in self._chunks:
            yield chunk

    async def warmup(self) -> bool:
        return True


class HangingProvider(LLMProvider):
    name = "hanging"

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        await asyncio.sleep(30)
        yield "never"

    async def warmup(self) -> bool:
        return True


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def sse_events(response) -> list[dict]:
    return [
        json.loads(line[len("data: ") :]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def analyze(client: TestClient, text: str = SCAM_TEXT) -> list[dict]:
    response = client.post("/api/analyze", json={"input_type": "text", "content": text})
    assert response.status_code == 200
    return sse_events(response)


def set_provider(client: TestClient, provider: LLMProvider | None, timeout_s: float | None = None) -> None:
    explainer = client.app.state.ctx.explainer
    explainer.provider = provider
    if timeout_s is not None:
        explainer.settings = explainer.settings.model_copy(update={"llm_timeout_s": timeout_s})


@pytest.fixture(autouse=True)
def clear_cache(client: TestClient) -> None:
    # Each test needs a fresh analysis, not a replay of the previous tier.
    client.app.state.ctx.cache._cache.clear()


def test_health_reports_loaded_components(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["classifier"]["loaded"] is True
    assert body["lexicons_loaded"] >= 7
    assert body["templates_loaded"] == 3
    assert body["advisories"]["documents"] == 5


def test_verdict_arrives_before_any_token(client: TestClient) -> None:
    set_provider(client, FakeProvider(["This ", "message ", "asks for your OTP, which is the giveaway."]))
    events = analyze(client)
    types = [event["type"] for event in events]

    assert types[0] == "verdict"
    assert types[-1] == "done"
    assert types.index("verdict") < types.index("token")


def test_verdict_event_is_a_complete_answer_on_its_own(client: TestClient) -> None:
    set_provider(client, None)
    verdict = analyze(client)[0]["payload"]

    assert verdict["verdict"] == "scam"
    assert verdict["risk_score"] >= 65
    assert verdict["flags"] and verdict["actions"]
    assert verdict["explanation"].strip()
    assert verdict["analyzed_text"] == SCAM_TEXT


def test_llm_tier_replaces_the_wording(client: TestClient) -> None:
    reply = "This message is a scam because it asks you to share your OTP with a stranger."
    set_provider(client, FakeProvider([reply]))
    done = analyze(client)[-1]["payload"]

    assert done["explanation_source"] == "llm"
    assert "OTP" in done["explanation"]


def test_provider_failure_degrades_to_templates(client: TestClient) -> None:
    set_provider(client, FakeProvider(error=ProviderError("groq 503")))
    events = analyze(client)
    done = events[-1]["payload"]

    assert [event["type"] for event in events].count("error") == 0
    assert done["explanation_source"] == "template"
    assert done["explanation"].strip()


def test_provider_timeout_degrades_to_templates(client: TestClient) -> None:
    set_provider(client, HangingProvider(), timeout_s=0.2)
    done = analyze(client)[-1]["payload"]

    assert done["explanation_source"] == "template"
    assert done["explanation"].strip()


def test_truncated_llm_output_falls_back(client: TestClient) -> None:
    set_provider(client, FakeProvider(["ok"]))
    done = analyze(client)[-1]["payload"]

    assert done["explanation_source"] == "template"


def test_language_is_honoured(client: TestClient) -> None:
    set_provider(client, None)
    response = client.post(
        "/api/analyze",
        json={
            "input_type": "text",
            "content": "તમે લોટરીમાં 25 લાખ રૂપિયા જીત્યા છો. ઇનામ મેળવવા માટે ફી ભરો.",
        },
    )
    verdict = sse_events(response)[0]["payload"]

    assert verdict["lang"] == "gu"
    assert any("઀" <= char <= "૿" for char in verdict["explanation"])


def test_safe_message_gets_no_advisory(client: TestClient) -> None:
    set_provider(client, None)
    verdict = analyze(
        client, "Rs.2500.00 debited from A/c XXXX1234. Avl Bal Rs.18340.50. Not you? Call 18001234567."
    )[0]["payload"]

    assert verdict["verdict"] == "safe"
    assert verdict["flags"] == []
    assert verdict["advisory"] is None


def test_oversized_text_is_rejected_cleanly(client: TestClient) -> None:
    response = client.post("/api/analyze", json={"input_type": "text", "content": "a" * 10_001})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_unknown_session_is_not_a_server_error(client: TestClient) -> None:
    response = client.post("/api/simulator/turn", json={"session_id": "gone", "message": "no"})

    assert response.status_code == 404
    assert "error" in response.json()


def test_simulator_runs_without_a_provider(client: TestClient) -> None:
    client.app.state.ctx.simulator.provider = None
    started = client.post("/api/simulator/start", json={"persona": "lottery", "lang": "en"}).json()
    assert started["scammer_text"].strip()

    turn = client.post(
        "/api/simulator/turn",
        json={"session_id": started["session_id"], "message": "I will not pay any fee."},
    ).json()

    assert turn["scammer_text"].strip()
    assert turn["coach"]["tip"].strip()
    assert turn["turn"] == 1
