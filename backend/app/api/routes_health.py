from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.contracts import (
    AdvisoryHealth,
    ClassifierHealth,
    HealthResponse,
    OCRHealth,
    ProviderHealth,
    TTSHealth,
)
from app.state import AppContext, get_context

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(ctx: AppContext = Depends(get_context)) -> HealthResponse:
    settings = ctx.settings
    engine = ctx.engine
    explainer = ctx.explainer

    llm_configured = (
        bool(settings.groq_api_key) if settings.llm_provider == "groq" else settings.llm_provider != "none"
    )
    stt_configured = (
        bool(settings.groq_api_key) if settings.stt_provider == "groq" else settings.stt_provider != "none"
    )

    classifier_loaded = bool(engine and engine.classifier.loaded)
    ocr = ctx.ocr

    # Tiers 1 and 2 are what "up" means here. A missing LLM key is reported as
    # degraded but the service still answers every request correctly.
    status = "ok" if engine and explainer else "degraded"
    if not llm_configured:
        status = "degraded"

    return HealthResponse(
        status=status,
        version=settings.app_version,
        mode=settings.mode,
        uptime_s=round(ctx.uptime_s, 1),
        llm=ProviderHealth(
            provider=settings.llm_provider,
            model=settings.llm_model if settings.llm_provider != "none" else None,
            configured=llm_configured,
        ),
        stt=ProviderHealth(
            provider=settings.stt_provider,
            model=(
                settings.groq_stt_model if settings.stt_provider == "groq" else settings.local_whisper_model
            ),
            configured=stt_configured,
        ),
        classifier=ClassifierHealth(loaded=classifier_loaded, path=str(settings.model_path)),
        ocr=OCRHealth(
            available=bool(ocr and ocr.available),
            langs=list(ocr.langs) if ocr else [],
        ),
        advisories=AdvisoryHealth(
            documents=explainer.retriever.document_count if explainer else 0,
            chunks=explainer.retriever.chunk_count if explainer else 0,
        ),
        tts=(
            ctx.speech.health()
            if ctx.speech is not None
            else TTSHealth(
                provider="none",
                available=False,
                voices_discovered=False,
                cache_entries=0,
                cache_bytes=0,
            )
        ),
        lexicons_loaded=len(engine.rules.tactics) if engine else 0,
        templates_loaded=explainer.templates.language_count if explainer else 0,
    )
