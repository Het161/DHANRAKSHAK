from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# The artifact is fitted on Latin-script SMS (UCI plus the romanized seed rows).
# Devanagari and Gujarati are effectively out of distribution for it: measured on
# the seed corpus it returns confident nonsense there, including 0.99 for a
# harmless family message. Outside these bounds the rules tier answers alone,
# which costs nothing because the rules already carry those scripts.
_MIN_CHARS = 25
_MIN_LATIN_SHARE = 0.6


def _in_distribution(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if len(text.strip()) < _MIN_CHARS or not letters:
        return False
    return sum(1 for char in letters if char.isascii()) / len(letters) >= _MIN_LATIN_SHARE


class ScamClassifier:
    """Wraps the committed TF-IDF + LightGBM artifact.

    A missing or unloadable artifact is a degraded state, not a fatal one: the
    rules tier alone still produces a verdict, so the process starts either way
    and /api/health reports `classifier.loaded = false`.
    """

    def __init__(self, pipeline: Any | None, path: Path) -> None:
        self._pipeline = pipeline
        self.path = path

    @property
    def loaded(self) -> bool:
        return self._pipeline is not None

    @classmethod
    def load(cls, path: Path) -> ScamClassifier:
        if not path.is_file():
            logger.warning("classifier artifact missing path=%s; running rules-only", path)
            return cls(None, path)
        try:
            import joblib

            pipeline = joblib.load(path)
        except Exception as exc:  # noqa: BLE001 - any failure here must degrade, not crash
            logger.warning("classifier artifact unusable path=%s error=%s", path, exc)
            return cls(None, path)

        if not hasattr(pipeline, "predict_proba"):
            logger.warning("classifier artifact has no predict_proba path=%s", path)
            return cls(None, path)

        logger.info("classifier loaded path=%s", path)
        return cls(pipeline, path)

    def predict(self, text: str) -> float | None:
        """P(scam) for `text`, or None when the model cannot speak to this input.

        CPU-bound. Callers on the request path run this in a worker thread.
        """
        if self._pipeline is None or not _in_distribution(text):
            return None
        try:
            proba = self._pipeline.predict_proba([text])
        except Exception as exc:  # noqa: BLE001 - a bad artifact must not break analyse
            logger.warning("classifier inference failed error=%s", exc)
            return None
        return float(proba[0][1])
