from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.detection.classifier import ScamClassifier
from app.detection.fusion import fuse
from app.detection.rules import RuleEngine
from app.detection.upi import UpiAnalyzer
from app.detection.urls import UrlAnalyzer
from app.schemas.contracts import Language, Signals

logger = logging.getLogger(__name__)


class DetectionEngine:
    """Tier 1 of the degradation ladder.

    Pure Python over in-memory artifacts: no network, no I/O, no LLM. This is the
    component that decides. Everything downstream only rephrases what it says.
    """

    def __init__(
        self,
        settings: Settings,
        rules: RuleEngine,
        urls: UrlAnalyzer,
        upi: UpiAnalyzer,
        classifier: ScamClassifier,
    ) -> None:
        self.settings = settings
        self.rules = rules
        self.urls = urls
        self.upi = upi
        self.classifier = classifier

    @classmethod
    def build(cls, settings: Settings) -> DetectionEngine:
        return cls(
            settings=settings,
            rules=RuleEngine.from_directory(settings.lexicon_dir),
            urls=UrlAnalyzer.from_file(settings.lexicon_dir / "bank_domains.json"),
            upi=UpiAnalyzer.from_file(settings.lexicon_dir / "upi_context.json"),
            classifier=ScamClassifier.load(settings.model_path),
        )

    def analyze_sync(self, text: str, lang: Language) -> Signals:
        return fuse(
            tactics=self.rules.detect(text),
            url_flags=self.urls.analyze(text),
            upi_flags=self.upi.analyze(text),
            classifier_score=self.classifier.predict(text),
            lang=lang,
            settings=self.settings,
        )

    async def analyze(self, text: str, lang: Language) -> Signals:
        # Regex scanning and LightGBM inference are CPU-bound; keeping them off
        # the event loop is what lets one instance serve concurrent SSE streams.
        return await asyncio.to_thread(self.analyze_sync, text, lang)
