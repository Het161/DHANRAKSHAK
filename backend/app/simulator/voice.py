from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.config import Settings
from app.explain.providers import LLMProvider, ProviderError
from app.schemas.contracts import Gender, Language, SentencePayload, VoiceDonePayload
from app.simulator.coach import evaluate
from app.simulator.personas import Persona
from app.simulator.react import TranscriptClass, classify
from app.simulator.service import (
    _TACTIC_FOCUS,
    PersonaNotFound,
    SessionNotFound,
    SimulatorService,
)
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
- Your reply MUST directly address what they just said - acknowledge it, deflect it, or turn it
  into pressure, using their own words. Never answer with an unrelated, off-topic line.
- Do not repeat your opener or anything you already said. Stay in character; never give safety advice."""

# How the caller should treat each kind of reply. Steers the reaction toward the
# learner's intent instead of marching through a fixed script.
_CLASS_GUIDANCE: dict[TranscriptClass, str] = {
    "refusal": "They are refusing you. Do not accept it - push back harder and raise the stakes.",
    "question": "They asked you a question. Do not answer it plainly - deflect and pivot back to pressure.",
    "stall": "They are stalling or want to bring in someone else. Cut it off - there is no time.",
    "compliance": "They are going along with it. Acknowledge it briefly and push the very next step at once.",
    "other": "They said something off-topic. Brush it aside and drag them back to the matter at hand.",
    "silence": "",
}

# Built-in safety nets, used only if a persona ships no pools for these.
_DEFAULT_BRIDGE: dict[Language, str] = {
    "en": "Listen to me carefully.",
    "hi": "मेरी बात ध्यान से सुनिए।",
    "gu": "મારી વાત ધ્યાનથી સાંભળો.",
}
_DEFAULT_SILENCE: dict[Language, str] = {
    "en": "Hello? Are you listening? Answer me quickly.",
    "hi": "हैलो? आप सुन रहे हैं? जल्दी जवाब दीजिए।",
    "gu": "હેલો? તમે સાંભળો છો? જલદી જવાબ આપો.",
}
_DEFAULT_FALLBACK: dict[Language, str] = {
    "en": "Do not test my patience. Do exactly as I say, right now.",
    "hi": "मेरा सब्र मत आज़माइए। जो कहता हूं वही कीजिए, अभी।",
    "gu": "મારી ધીરજ ન અજમાવો. હું કહું એમ જ કરો, હમણાં જ.",
}


@dataclass(frozen=True, slots=True)
class VoiceEvent:
    type: str
    payload: dict


def _pick(
    rng: random.Random, pool: dict[Language, tuple[str, ...]] | None, lang: Language, default: str
) -> str:
    options = (pool or {}).get(lang) or (pool or {}).get("en") or ()
    return rng.choice(options) if options else default


class VoiceCallService:
    """Voice turns for the simulator.

    A short content-neutral bridge line goes out first (already synthesised on
    disk) so the caller starts speaking in well under a second. The LLM then
    generates the real reaction - conditioned on the whole conversation and on
    what the learner just said - while the bridge is still playing. Sessions,
    scoring and coaching are reused from the text simulator unchanged.
    """

    def __init__(self, settings: Settings, simulator: SimulatorService, provider: LLMProvider | None) -> None:
        self.settings = settings
        self.simulator = simulator
        self.provider = provider

    async def stream_turn(self, session_id: str, message: str, gender: Gender) -> AsyncIterator[VoiceEvent]:
        started = time.perf_counter()
        session = self.simulator.sessions.get(session_id)
        if session is None:
            raise SessionNotFound(session_id)
        persona = self.simulator.personas.get(session.persona_id)
        if persona is None:
            raise PersonaNotFound(session.persona_id)

        cls = classify(message)
        # Vary the picked bridge/fallback per turn without repeating, but keep it
        # deterministic for a given session+turn.
        rng = random.Random(session.seed ^ (session.turn * 0x9E3779B1))

        # Silence: the mic caught nothing. Prod them in character and re-open the
        # mic; never advance the script as if they had answered.
        if cls == "silence":
            line = _pick(rng, persona.silence_lines, session.lang, _DEFAULT_SILENCE[session.lang])
            yield VoiceEvent("sentence", SentencePayload(text=line, seq=0, source="script").model_dump())
            logger.info(
                "voice turn persona=%s lang=%s turn=%d SILENCE", persona.id, session.lang, session.turn
            )
            yield VoiceEvent(
                "done",
                VoiceDonePayload(
                    full_text=line,
                    finished=False,
                    score=session.score,
                    turn=session.turn,
                    debug={
                        "transcript": "",
                        "class": "silence",
                        "bridge": line,
                        "path": "silence",
                        "history_len": len(session.transcript),
                        "reply": line,
                    },
                ).model_dump(),
            )
            return

        coach = evaluate(persona, message, session.lang)
        session.record("user", message)
        session.score = max(0, session.score + coach.score_delta)
        session.turn += 1
        finished = session.turn >= self.settings.simulator_max_turns

        seq = 0
        spoken: list[str] = []
        # Finished: just wrap up with the closing. Otherwise a neutral bridge that
        # buys a second while the reaction is generated.
        if finished:
            bridge = session.plan.closing
        else:
            bridge = _pick(rng, persona.bridges, session.lang, _DEFAULT_BRIDGE[session.lang])
        if bridge:
            spoken.append(bridge)
            yield VoiceEvent("sentence", SentencePayload(text=bridge, seq=seq, source="script").model_dump())
            seq += 1
        first_sentence_ms = (time.perf_counter() - started) * 1000

        # Visual only. Speaking the coach in the scammer's voice would break the
        # illusion the whole exercise depends on.
        yield VoiceEvent("coach", coach.model_dump())

        path = "fallback"
        reply: list[str] = []
        messages_len = 0
        if not finished:
            # The full conversation as a chat array, so the reply conditions on
            # everything said so far, not a flattened prompt.
            messages = self._build_messages(persona, session, message, bridge, cls)
            messages_len = len(messages)
            async for sentence in self._react(messages):
                reply.append(sentence)
                spoken.append(sentence)
                yield VoiceEvent(
                    "sentence", SentencePayload(text=sentence, seq=seq, source="llm").model_dump()
                )
                seq += 1
            if reply:
                path = "llm"
            else:
                # LLM unavailable: react to the CLASS of their reply, not a fixed
                # line. It is a scripted line, so it is tagged "script".
                line = _pick(rng, persona.fallbacks.get(cls), session.lang, _DEFAULT_FALLBACK[session.lang])
                reply.append(line)
                spoken.append(line)
                yield VoiceEvent(
                    "sentence", SentencePayload(text=line, seq=seq, source="script").model_dump()
                )
                seq += 1

        full_text = " ".join(spoken).strip()
        session.record("scammer", full_text)
        if finished:
            self.simulator.sessions.drop(session.id)

        total_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "voice turn persona=%s lang=%s gender=%s turn=%d class=%s path=%s sentences=%d "
            "first_sentence_ms=%d total_ms=%d transcript=%r",
            persona.id,
            session.lang,
            gender,
            session.turn,
            cls,
            path,
            seq,
            int(first_sentence_ms),
            total_ms,
            message[:80],
        )

        yield VoiceEvent(
            "done",
            VoiceDonePayload(
                full_text=full_text,
                finished=finished,
                score=session.score,
                turn=session.turn,
                debug={
                    "transcript": message,
                    "class": cls,
                    "bridge": bridge,
                    "path": path,
                    "messages_len": messages_len,
                    "history_len": len(session.transcript),
                    "reply": " ".join(reply).strip() or bridge,
                },
            ).model_dump(),
        )

    def _system_prompt(self, persona: Persona, session: Session, cls: TranscriptClass) -> str:
        plan = session.plan
        tactic = plan.tactic_for_turn(session.turn - 1)
        facts = (
            f"Fixed details for this call, use them exactly: {plan.facts_for_prompt()}."
            if plan.facts_for_prompt()
            else ""
        )
        focus = f"Your aim this moment: {_TACTIC_FOCUS[tactic]}." if tactic in _TACTIC_FOCUS else ""
        examples = persona.reaction_examples.get(session.lang) or persona.reaction_examples.get("en") or ()
        examples_block = (
            "Examples of reacting in character (do not copy them; react to THIS call):\n"
            + "\n".join(examples)
            if examples
            else ""
        )
        return "\n\n".join(
            part
            for part in (
                persona.system_prompt,
                persona.voice_prompt,
                _VOICE_RULES,
                facts,
                focus,
                examples_block,
                _LANGUAGE_INSTRUCTION.get(session.lang, ""),
            )
            if part
        )

    def _build_messages(
        self, persona: Persona, session: Session, message: str, bridge: str, cls: TranscriptClass
    ) -> list[dict[str, str]]:
        """system + the real conversation (alternating turns) + a final framing
        turn carrying the learner's exact words, the bridge already spoken, and
        how to react to this class of reply. The last user message just recorded
        is excluded from history so it is not duplicated by the framing turn."""
        messages: list[dict[str, str]] = [
            {"role": "system", "content": self._system_prompt(persona, session, cls)}
        ]
        history = session.transcript[:-1][-self.settings.voice_history_messages :]
        for role, text in history:
            messages.append({"role": "user" if role == "user" else "assistant", "content": text})

        guidance = _CLASS_GUIDANCE.get(cls, "")
        framing = (
            f'They just said to you: "{message}".\n'
            f'You have already started replying out loud with: "{bridge}".\n'
            f"{guidance}\n"
            "Continue in the same breath: one or two short spoken sentences, in character, that "
            "clearly react to what they said. Do not repeat your opener and do not narrate."
        )
        messages.append({"role": "user", "content": framing})
        return messages

    async def _react(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        """One short follow-up, cut at the first sentence boundary as it streams."""
        if self.provider is None:
            return

        buffer = ""
        emitted = 0
        # Hold the stream explicitly so it can be closed cleanly when we stop early
        # (returning mid-iteration would let the httpx stream be GC-closed while
        # still running, which logs an async-generator aclose error).
        stream = self.provider.stream_chat(messages)
        try:
            async with asyncio.timeout(self.settings.voice_llm_timeout_s):
                async for chunk in stream:
                    buffer += chunk
                    while emitted < self.settings.voice_max_sentences:
                        sentence, buffer = take_sentence(buffer)
                        if sentence is None:
                            break
                        emitted += 1
                        yield sentence
                    if emitted >= self.settings.voice_max_sentences:
                        break
        except asyncio.CancelledError:
            raise
        except (TimeoutError, ProviderError) as exc:
            logger.warning("voice reaction degraded reason=%s", exc)
        except Exception:
            # Provider boundary: the bridge already went out, so the caller falls
            # back to a reactive scripted line rather than dropping the call.
            logger.exception("voice reaction failed")
        finally:
            await stream.aclose()

        if emitted < self.settings.voice_max_sentences:
            tail, _ = take_sentence(buffer, flush=True)
            if tail:
                yield tail
