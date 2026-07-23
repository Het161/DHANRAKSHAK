from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import Settings
from app.explain.prompt import SYSTEM_PROMPT, build_user_prompt
from app.explain.providers import LLMProvider, ProviderError, build_llm_provider
from app.explain.rag import AdvisoryRetriever
from app.explain.templates import TemplateLibrary
from app.schemas.contracts import AnalyzeResponse, ExplanationSource, Flag, Signals

logger = logging.getLogger(__name__)

# Below this, a stream was cut short or returned noise; the template says more.
_MIN_USABLE_LLM_CHARS = 60


@dataclass(frozen=True, slots=True)
class Explanation:
    text: str
    source: ExplanationSource


class ExplanationService:
    """Tiers 2 and 3.

    The response returned by `baseline` is already complete and correct. The LLM
    only ever replaces its wording, which is why no provider failure can reduce
    what the caller receives.
    """

    def __init__(
        self,
        settings: Settings,
        provider: LLMProvider | None,
        retriever: AdvisoryRetriever,
        templates: TemplateLibrary,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.retriever = retriever
        self.templates = templates

    @classmethod
    def build(cls, settings: Settings, client: httpx.AsyncClient) -> ExplanationService:
        return cls(
            settings=settings,
            provider=build_llm_provider(settings, client),
            retriever=AdvisoryRetriever.load(Path(settings.advisory_dir)),
            templates=TemplateLibrary.load(Path(settings.template_dir)),
        )

    def flags_for(self, signals: Signals) -> list[Flag]:
        flags: list[Flag] = []
        for tactic in signals.tactics:
            text = self.templates.flag_text(tactic.name, signals.lang)
            flags.append(
                Flag(
                    kind="tactic",
                    name=tactic.name,
                    detail=text.why,
                    action=text.do,
                    weight=tactic.weight,
                    evidence_span=tactic.evidence_span,
                )
            )
        for url_flag in signals.url_flags:
            text = self.templates.flag_text(url_flag.reason, signals.lang)
            flags.append(
                Flag(
                    kind="url",
                    name=url_flag.reason,
                    # The analyser's English detail is the safety net for a flag
                    # the template files have not caught up with yet.
                    detail=text.why or url_flag.detail,
                    action=text.do,
                    weight=url_flag.weight,
                )
            )
        for upi_flag in signals.upi_flags:
            text = self.templates.flag_text(upi_flag.reason, signals.lang)
            flags.append(
                Flag(
                    kind="upi",
                    name=upi_flag.reason,
                    detail=text.why or upi_flag.detail,
                    action=text.do,
                    weight=upi_flag.weight,
                )
            )
        flags.sort(key=lambda flag: flag.weight, reverse=True)
        return flags

    async def baseline(self, signals: Signals) -> AnalyzeResponse:
        """The tier-1 + tier-2 answer: complete, localized, and free of any LLM call."""
        flags = self.flags_for(signals)
        names = [flag.name for flag in flags]
        advisory = await self.retriever.retrieve(names, signals.lang)
        return AnalyzeResponse(
            verdict=signals.label,
            risk_score=signals.risk_score,
            flags=flags,
            advisory=advisory,
            actions=self.templates.actions(signals.label, signals.lang),
            lang=signals.lang,
            explanation=self.templates.render(signals, names),
            explanation_source="template",
        )

    async def stream_tokens(self, signals: Signals, response: AnalyzeResponse) -> AsyncIterator[str]:
        """Yield explanation fragments, stopping silently if the provider fails.

        Never raises. A degraded tier 3 is an expected operating state, not an error.
        """
        if self.provider is None:
            return

        user_prompt = build_user_prompt(
            signals,
            response.flags,
            response.advisory,
            response.actions,
            self.templates.verdict_intro(signals.label, signals.lang),
        )
        try:
            async with asyncio.timeout(self.settings.llm_timeout_s):
                async for chunk in self.provider.stream(SYSTEM_PROMPT, user_prompt):
                    yield chunk
        except asyncio.CancelledError:
            raise
        except (TimeoutError, ProviderError) as exc:
            logger.warning("explanation degraded provider=%s reason=%s", self.provider.name, exc)
        except Exception:
            # Provider boundary: a bug in a third-party stream must not take the
            # request down when templates can still answer it.
            logger.exception("explanation provider failed provider=%s", self.provider.name)

    def finalize(self, streamed: str, response: AnalyzeResponse) -> Explanation:
        text = streamed.strip()
        if len(text) >= _MIN_USABLE_LLM_CHARS:
            return Explanation(text=text, source="llm")
        return Explanation(text=response.explanation, source="template")

    async def warmup(self) -> None:
        if self.provider is None or not self.settings.llm_warmup_enabled:
            return
        try:
            await self.provider.warmup()
        except Exception:  # noqa: BLE001 - warm-up is best effort by definition
            logger.warning("llm warmup raised provider=%s", self.provider.name)
