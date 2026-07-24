from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from cachetools import TTLCache

from app.schemas.contracts import Language

if TYPE_CHECKING:
    from app.simulator.scenario import ScenarioPlan


@dataclass(slots=True)
class Session:
    id: str
    persona_id: str
    lang: Language
    seed: int
    plan: ScenarioPlan
    turn: int = 0
    score: int = 0
    transcript: list[tuple[str, str]] = field(default_factory=list)

    def record(self, role: str, text: str) -> None:
        self.transcript.append((role, text))


class SessionStore:
    """In-memory, bounded, self-expiring.

    Nothing about a training session is worth a database: sessions are anonymous,
    short, and losing one on a restart costs the user a single click.
    """

    def __init__(self, max_sessions: int, ttl_s: int) -> None:
        self._sessions: TTLCache[str, Session] = TTLCache(maxsize=max_sessions, ttl=ttl_s)

    def create(self, persona_id: str, lang: Language, seed: int, plan: ScenarioPlan) -> Session:
        session = Session(
            id=secrets.token_urlsafe(12),
            persona_id=persona_id,
            lang=lang,
            seed=seed,
            plan=plan,
        )
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
