from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.errors import error_response
from app.config import get_settings

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """Identify the caller behind Render's proxy.

    `request.client.host` is the load balancer there, so every visitor would
    share one bucket. The left-most X-Forwarded-For entry is the real client.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


_settings = get_settings()

limiter = Limiter(
    key_func=client_ip,
    default_limits=[_settings.rate_limit_default],
    enabled=_settings.rate_limit_enabled,
    headers_enabled=True,
)


async def _handle_rate_limit(request: Request, exc: RateLimitExceeded):
    logger.info("rate limited path=%s", request.url.path)
    return error_response(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "rate_limited",
        "Too many requests from this device. Please wait a minute and try again.",
    )


def register_rate_limiting(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _handle_rate_limit)
    app.add_middleware(SlowAPIMiddleware)
