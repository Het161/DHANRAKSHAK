from __future__ import annotations

import logging
import sys

_NOISY_LOGGERS = ("httpx", "httpcore", "PIL", "urllib3")


def configure_logging(level: str) -> None:
    """Install a single stdout handler.

    Nothing in this application ever logs user content: analyse events log the
    verdict, tier and latency only. See `app.api.routes_analyze`.
    """
    root = logging.getLogger()
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-7s %(name)-28s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )
    root.addHandler(handler)
    root.setLevel(level.upper())

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
