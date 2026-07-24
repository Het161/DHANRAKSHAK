from __future__ import annotations

import asyncio
import logging
import re
import secrets
from collections import defaultdict, deque
from collections.abc import Iterator
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
from app.simulator.scenario import build_plan
from app.simulator.session import Session, SessionStore

logger = logging.getLogger(__name__)

_MAX_REPLY_WORDS = 45
_LANGUAGES: tuple[Language, ...] = ("gu", "hi", "en")
_GENDERS: tuple[Gender, ...] = ("male", "female")
_SPEAKER_PREFIX_RE = re.compile(r"^\s*(scammer|caller|officer|agent|me)\s*[:\-]\s*", re.IGNORECASE)
# Per persona, how many recent openings to steer away from on the next start.
_RECENT_OPENINGS = 4

_LANGUAGE_INSTRUCTION: dict[Language, str] = {
    "gu": "Reply in spoken Gujarati, in Gujarati script.",
    "hi": "Reply in spoken Hindi, in Devanagari script.",
    "en": "Reply in simple spoken Indian English.",
}

_TACTIC_FOCUS: dict[str, str] = {
    "authority_impersonation": "sound like the official you are pretending to be",
    "digital_arrest": "push the arrest or investigation threat and keep them on the line",
    "urgency_threat": "add time pressure, a deadline or a consequence",
    "credential_request": "steer toward getting an OTP, PIN or card detail",
    "prize_bait": "dangle the prize and the fee needed to release it",
    "loan_app_threat": "threaten to contact their family or leak their photos",
    "remote_access_tool": "push them to install an app or share their screen",
}

# The roleplay rules that force short, varied, in-character replies.
_VARY_RULES = """This is a live scam-practice call and you are the caller. Rules:
- One or two short spoken sentences. Never more. Speak in short, pressured bursts.
- Stay in character. Never break it, never give safety advice, never mention that this is practice.
- Use the fixed details below exactly and consistently. Do not invent different names or amounts.
- Vary your wording. Do not reuse a stock opening or repeat a line you already said.
- React to what the person just said; do not ignore their reply."""


class SessionNotFound(LookupError):
    pass


class PersonaNotFound(LookupError):
    pass


class SimulatorService:
    """Training mode.

    Every session is planned server-side from a fresh random seed, so two runs -
    two phones, or one phone twice - always differ. The LLM voices the scammer by
    default; when it is unavailable, lines are assembled from the persona's
    variant pools using the same seed, so even offline sessions still differ.
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
        self._recent_openings: dict[str, deque[str]] = defaultdict(lambda: deque(maxlen=_RECENT_OPENINGS))

    @classmethod
    def build(cls, settings: Settings, provider: LLMProvider | None) -> SimulatorService:
        return cls(
            settings=settings,
            personas=PersonaLibrary.load(Path(settings.persona_dir)),
            provider=provider,
            sessions=SessionStore(settings.simulator_max_sessions, settings.simulator_session_ttl_s),
        )

    @staticmethod
    def _reusable_lines(persona: Persona, lang: Language) -> Iterator[str]:
        """Every line a persona might voice in one language, before slot-filling."""
        yield from persona.openings.get(lang, ())
        for variants in persona.lines.values():
            yield from variants.get(lang, ())
        yield from persona.filler.get(lang, ())
        yield from persona.closings.get(lang, ())

    def speakable_lines(self) -> list[tuple[str, Language, Gender]]:
        """The slot-free lines a caller reuses verbatim across every session.

        A slotted line (most openings) is filled with random values per session,
        so its exact text is only known once a call starts; those are warmed then
        in ``plan_lines``. Everything slot-free - most closings and pressure
        fillers, plus any fixed line variants - recurs unchanged, so it is warmed
        here at startup and its audio is already cached the first time any session
        speaks it. Prewarm runs in the background, so covering the whole reusable
        set costs no readiness time. Deduped across personas that share a line.
        """
        seen: set[tuple[str, Language]] = set()
        lines: list[tuple[str, Language, Gender]] = []
        for persona in self.personas.all():
            for lang in _LANGUAGES:
                for text in self._reusable_lines(persona, lang):
                    if text and "{" not in text and (text, lang) not in seen:
                        seen.add((text, lang))
                        lines.extend((text, lang, gender) for gender in _GENDERS)
        return lines

    def plan_lines(self, session_id: str, gender: Gender) -> list[tuple[str, Language, Gender]]:
        """Every line this specific session could voice, for just-in-time warming."""
        session = self.sessions.get(session_id)
        if session is None:
            return []
        return [(text, session.lang, gender) for text in session.plan.speakable_lines()]

    def start(self, request: StartRequest) -> StartResponse:
        persona = self.personas.get(request.persona)
        if persona is None:
            raise PersonaNotFound(request.persona)

        seed = secrets.randbits(63)
        plan = build_plan(
            persona,
            request.lang,
            seed,
            self.settings.simulator_max_turns,
            avoid_openings=frozenset(self._recent_openings[persona.id]),
        )
        self._recent_openings[persona.id].append(plan.opening)

        session = self.sessions.create(persona.id, request.lang, seed, plan)
        session.record("scammer", plan.opening)
        logger.info("simulator start persona=%s lang=%s seed=%d", persona.id, request.lang, seed)
        return StartResponse(
            session_id=session.id,
            scammer_text=plan.opening,
            persona=persona.id,
            lang=request.lang,
            seed=seed,
            plan=plan.as_debug(),
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
        if finished:
            scammer_text, source = session.plan.closing, "fallback"
        else:
            scammer_text, source = await self._next_scammer_line(persona, session)
        session.record("scammer", scammer_text)
        if finished:
            self.sessions.drop(session.id)

        return TurnResponse(
            scammer_text=scammer_text,
            coach=Coach(**coach.model_dump()),
            finished=finished,
            score=session.score,
            turn=session.turn,
            source=source,
        )

    async def _next_scammer_line(self, persona: Persona, session: Session) -> tuple[str, str]:
        """The LLM voices the caller by default; the plan's line is the fallback."""
        fallback = session.plan.scripted_line(session.turn - 1)
        if self.provider is None:
            return fallback, "fallback"
        generated = await self._generate(persona, session)
        if generated:
            return generated, "llm"
        return fallback, "fallback"

    async def _generate(self, persona: Persona, session: Session) -> str | None:
        system = self._system_prompt(persona, session)
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
            # Provider boundary: the plan's scripted line is always available.
            logger.exception("simulator provider failed")
            return None
        return _tidy_reply("".join(chunks))

    def _system_prompt(self, persona: Persona, session: Session) -> str:
        """Persona prompt plus this session's plan, so the LLM stays consistent
        within a call and diverges between calls."""
        plan = session.plan
        tactic = plan.tactic_for_turn(session.turn - 1)
        parts = [
            persona.system_prompt,
            _VARY_RULES,
            _LANGUAGE_INSTRUCTION.get(session.lang, ""),
        ]
        if plan.facts_for_prompt():
            parts.append(f"Fixed details for this call, use them exactly: {plan.facts_for_prompt()}.")
        if tactic in _TACTIC_FOCUS:
            parts.append(f"Right now, {_TACTIC_FOCUS[tactic]}.")
        return "\n\n".join(part for part in parts if part).strip()


def _tidy_reply(raw: str) -> str | None:
    text = _SPEAKER_PREFIX_RE.sub("", raw.strip().strip('"')).strip()
    if not text:
        return None
    words = text.split()
    return " ".join(words[:_MAX_REPLY_WORDS])
