from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from app.config import Settings
from app.explain.providers import LLMProvider, ProviderError
from app.schemas.contracts import (
    Coach,
    Gender,
    Language,
    StartRequest,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.simulator.coach import evaluate
from app.simulator.personas import Persona, PersonaLibrary
from app.simulator.session import Session, SessionStore

logger = logging.getLogger(__name__)

_MAX_REPLY_WORDS = 45
_LANGUAGES: tuple[Language, ...] = ("gu", "hi", "en")
_GENDERS: tuple[Gender, ...] = ("male", "female")
_SPEAKER_PREFIX_RE = re.compile(r"^\s*(scammer|caller|officer|agent|me)\s*[:\-]\s*", re.IGNORECASE)
_LANGUAGE_INSTRUCTION: dict[Language, str] = {
    "gu": "Write your message in Gujarati, using Gujarati script.",
    "hi": "Write your message in Hindi, using Devanagari script.",
    "en": "Write your message in simple English.",
}


class SessionNotFound(LookupError):
    pass


class PersonaNotFound(LookupError):
    pass


class SimulatorService:
    """Training mode.

    Every persona ships a full scripted conversation, so the simulator behaves
    identically whether or not an LLM is reachable. The LLM only makes the
    scammer's wording react to what the learner actually said.
    """

    def __init__(
        self,
        settings: Settings,
        personas: PersonaLibrary,
        provider: LLMProvider | None,
        sessions: SessionStore,
    ) -> None:
        self.settings = settings
        self.personas = personas
        self.provider = provider
        self.sessions = sessions

    @classmethod
    def build(cls, settings: Settings, provider: LLMProvider | None) -> SimulatorService:
        return cls(
            settings=settings,
            personas=PersonaLibrary.load(Path(settings.persona_dir)),
            provider=provider,
            sessions=SessionStore(settings.simulator_max_sessions, settings.simulator_session_ttl_s),
        )

    def speakable_lines(self) -> list[tuple[str, Language, Gender]]:
        """Opening lines for every persona, language and voice.

        Only the openings are warmed at startup: they decide whether a call
        begins instantly. The rest of a persona's script is warmed in the
        background once a call actually starts, which keeps startup short and
        avoids synthesising scenarios nobody opens.
        """
        lines: list[tuple[str, Language, Gender]] = []
        for persona in self.personas.all():
            for lang in _LANGUAGES:
                text = persona.opening.get(lang)
                if text:
                    lines.extend((text, lang, gender) for gender in _GENDERS)
        return lines

    def call_lines(
        self, persona_id: str, lang: Language, gender: Gender
    ) -> list[tuple[str, Language, Gender]]:
        """Every remaining line one call could need, for just-in-time warming."""
        persona = self.personas.get(persona_id)
        if persona is None:
            return []
        texts = [*persona.scripted_turns.get(lang, ()), persona.closing.get(lang)]
        return [(text, lang, gender) for text in texts if text]

    def start(self, request: StartRequest) -> StartResponse:
        persona = self.personas.get(request.persona)
        if persona is None:
            raise PersonaNotFound(request.persona)
        session = self.sessions.create(persona.id, request.lang)
        opening = persona.opening.get(request.lang)
        session.record("scammer", opening)
        logger.info("simulator start persona=%s lang=%s", persona.id, request.lang)
        return StartResponse(
            session_id=session.id,
            scammer_text=opening,
            persona=persona.id,
            lang=request.lang,
        )

    async def turn(self, request: TurnRequest) -> TurnResponse:
        session = self.sessions.get(request.session_id)
        if session is None:
            raise SessionNotFound(request.session_id)
        persona = self.personas.get(session.persona_id)
        if persona is None:
            raise PersonaNotFound(session.persona_id)

        coach = evaluate(persona, request.message, session.lang)
        session.record("user", request.message)
        session.score = max(0, session.score + coach.score_delta)
        session.turn += 1

        finished = session.turn >= self.settings.simulator_max_turns
        scammer_text = (
            persona.closing.get(session.lang) if finished else await self._next_scammer_line(persona, session)
        )
        session.record("scammer", scammer_text)
        if finished:
            self.sessions.drop(session.id)

        return TurnResponse(
            scammer_text=scammer_text,
            coach=Coach(
                tactic_revealed=coach.tactic_revealed,
                tip=coach.tip,
                score_delta=coach.score_delta,
            ),
            finished=finished,
            score=session.score,
            turn=session.turn,
        )

    async def _next_scammer_line(self, persona: Persona, session: Session) -> str:
        scripted = persona.scripted_turn(session.lang, session.turn - 1)
        if self.provider is None:
            return scripted
        generated = await self._generate(persona, session)
        return generated or scripted

    async def _generate(self, persona: Persona, session: Session) -> str | None:
        system = f"{persona.system_prompt}\n\n{_LANGUAGE_INSTRUCTION.get(session.lang, '')}".strip()
        transcript = "\n".join(f"{role}: {text}" for role, text in session.transcript[-6:])
        user = f"Conversation so far:\n{transcript}\n\nWrite only your next message."

        chunks: list[str] = []
        try:
            async with asyncio.timeout(self.settings.llm_timeout_s):
                async for chunk in self.provider.stream(system, user):
                    chunks.append(chunk)
        except asyncio.CancelledError:
            raise
        except (TimeoutError, ProviderError) as exc:
            logger.warning("simulator falling back to script reason=%s", exc)
            return None
        except Exception:
            # Provider boundary: the scripted turn is always available as a fallback.
            logger.exception("simulator provider failed")
            return None
        return _tidy_reply("".join(chunks))


def _tidy_reply(raw: str) -> str | None:
    text = _SPEAKER_PREFIX_RE.sub("", raw.strip().strip('"')).strip()
    if not text:
        return None
    words = text.split()
    return " ".join(words[:_MAX_REPLY_WORDS])
