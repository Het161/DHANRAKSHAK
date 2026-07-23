from __future__ import annotations

import pytest

from app.config import Settings


def build() -> Settings:
    # Never read the developer's .env: these assertions are about how env vars
    # are parsed, not about whatever happens to be configured on this machine.
    return Settings(_env_file=None)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # The comma-separated form is what Render's dashboard produces, and it is
        # what the deploy instructions tell people to paste.
        ("https://a.vercel.app,https://b.vercel.app", ["https://a.vercel.app", "https://b.vercel.app"]),
        (" https://a.vercel.app , https://b.vercel.app ", ["https://a.vercel.app", "https://b.vercel.app"]),
        ('["https://a.vercel.app"]', ["https://a.vercel.app"]),
        ("https://a.vercel.app", ["https://a.vercel.app"]),
        ("", []),
    ],
)
def test_cors_origins_accepts_both_spellings(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: list[str]
) -> None:
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert build().cors_origins == expected


def test_cors_origins_defaults_to_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert build().cors_origins == ["http://localhost:3000", "http://localhost:5173"]


def test_malformed_json_origins_is_reported_clearly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "[not json")
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        build()
