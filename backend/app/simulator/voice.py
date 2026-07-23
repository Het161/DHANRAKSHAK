from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.config import Settings
from app.explain.providers import LLMProvider, ProviderError
from app.schemas.contracts import Gender, Language, SentencePayload, VoiceDonePayload
from app.simulator.coach import evaluate
from app.simulator.personas import Persona
from app.simulator.service import PersonaNotFound, SessionNotFound, SimulatorService
from app.simulator.session import Session
from app.util.sentences import take_sentence

logger = logging.getLogger(__name__)

_LANGUAGE_INSTRUCTION: dict[Language, str] = {
    "gu": "Reply in spoken Gujarati, in Gujarati script.",
    "hi": "Reply in spoken Hindi, in Devanagari script.",
    "en": "Reply in simple spoken Indian English.",
}

_VOICE_RULES = """This is a live phone call and your words are read aloud immediately.

- One or two short sentences. Never more. A real caller talks in short pressured bursts.
- Spoken register only: no lists, no bullet points, no formatting, no emoji, no stage directions.
- Do not repeat what you just said. Add pressure, or react to what the person just told you.
- Never break character and never give safety advice."""


@dataclass(frozen=True, slots=True)
class VoiceEvent:
    type: str
    payload: dict


class VoiceCallService:
    """Voice turns for the simulator.

    The scripted line goes out first and is already synthesised on disk, so the
    caller starts speaking in well under a second. The model's reaction is
    generated while that line is still playing and queued behind it. Everything
    the text simulator does about sessions, scoring and coaching is reused
    unchanged; only the delivery differs.
    """

    def __init__(
        self, settings: Settings, simulator: SimulatorService, provider: LLMProvider | None
    ) -> None:
        self.settings = settings
        self.simulator = simulator
        self.provider = provider

    async def stream_turn(
        self, session_id: str, message: str, gender: Gender
    ) -> AsyncIterator[VoiceEvent]:
        started = time.perf_counter()
        session = self.simulator.sessions.get(session_id)
        if session is None:
            raise SessionNotFound(session_id)
        persona = self.simulator.personas.get(session.persona_id)
        if persona is None:
            raise PersonaNotFound(session.persona_id)

        coach = evaluate(persona, message, session.lang)
        session.record("user", message)
        session.score = max(0, session.score + coach.score_delta)
        session.turn += 1
        finished = session.turn >= self.settings.simulator_max_turns

        scripted = (
            persona.closing.get(session.lang)
            if finished
            else persona.scripted_turn(session.lang, session.turn - 1)
        )

        seq = 0
        spoken: list[str] = []
        if scripted:
            spoken.append(scripted)
            yield VoiceEvent(
                "sentence", SentencePayload(text=scripted, seq=seq, source="script").model_dump()
            )
            seq += 1
        first_sentence_ms = (time.perf_counter() - started) * 1000

        # Visual only. Speaking the coach in the scammer's voice would break the
        # illusion the whole exercise depends on.
        yield VoiceEvent("coach", coach.model_dump())

        if not finished:
            async for sentence in self._react(persona, session, message, scripted):
                spoken.append(sentence)
                yield VoiceEvent(
                    "sentence", SentencePayload(text=sentence, seq=seq, source="llm").model_dump()
                )
                seq += 1

        full_text = " ".join(spoken).strip()
        session.record("scammer", full_text)
        if finished:
            self.simulator.sessions.drop(session.id)

        total_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "voice turn persona=%s lang=%s gender=%s turn=%d sentences=%d "
            "first_sentence_ms=%d total_ms=%d tier=%s",
            persona.id,
            session.lang,
            gender,
            session.turn,
            seq,
            int(first_sentence_ms),
            total_ms,
            "script+llm" if seq > 1 else "script",
        )

        yield VoiceEvent(
            "done",
            VoiceDonePayload(
                full_text=full_text,
                finished=finished,
                score=session.score,
                turn=session.turn,
            ).model_dump(),
        )

    async def _react(
        self, persona: Persona, session: Session, message: str, scripted: str | None
    ) -> AsyncIterator[str]:
        """One short follow-up, cut at the first sentence boundary as it streams."""
        if self.provider is None:
            return

        system = "\n\n".join(
            part
            for part in (
                persona.system_prompt,
                persona.voice_prompt,
                _VOICE_RULES,
                _LANGUAGE_INSTRUCTION.get(session.lang, ""),
            )
            if part
        )
        transcript = "\n".join(f"{role}: {text}" for role, text in session.transcript[-4:])
        user = (
            f"Call so far:\n{transcript}\n\n"
            f"You have just said: {scripted or '(nothing yet)'}\n"
            f"They replied: {message}\n\n"
            "Say one short follow-up sentence that reacts to their reply. Do not repeat yourself."
        )

        buffer = ""
        emitted = 0
        try:
            async with asyncio.timeout(self.settings.voice_llm_timeout_s):
                async for chunk in self.provider.stream(system, user):
                    buffer += chunk
                    while emitted < self.settings.voice_max_sentences:
                        sentence, buffer = take_sentence(buffer)
                        if sentence is None:
                            break
                        emitted += 1
                        yield sentence
                    if emitted >= self.settings.voice_max_sentences:
                        return
        except asyncio.CancelledError:
            raise
        except (TimeoutError, ProviderError) as exc:
            logger.warning("voice reaction degraded reason=%s", exc)
        except Exception:
            # Provider boundary: the scripted line already went out, so the call
            # continues with no reaction rather than dropping.
            logger.exception("voice reaction failed")

        if emitted < self.settings.voice_max_sentences:
            tail, _ = take_sentence(buffer, flush=True)
            if tail:
                yield tail
