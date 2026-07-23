from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_analyze, routes_health, routes_simulator, routes_tts
from app.api.errors import register_exception_handlers
from app.api.limits import register_rate_limiting
from app.bootstrap import build_context, shutdown_context, warm_providers
from app.config import get_settings
from app.logging_setup import configure_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    app.state.ctx = await build_context(settings)

    # Warming happens off the startup path: the instance must pass its health
    # check immediately, even when the provider is slow or unreachable.
    warmup = asyncio.create_task(warm_providers(app.state.ctx))
    try:
        yield
    finally:
        warmup.cancel()
        with suppress(asyncio.CancelledError):
            await warmup
        await shutdown_context(app.state.ctx)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Scam detection and plain-language explanation for first-time digital banking users.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    register_rate_limiting(app)
    register_exception_handlers(app)

    app.include_router(routes_health.router, prefix="/api")
    app.include_router(routes_analyze.router, prefix="/api")
    app.include_router(routes_simulator.router, prefix="/api")
    app.include_router(routes_tts.router, prefix="/api")
    return app


app = create_app()
