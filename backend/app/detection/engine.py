from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.detection.classifier import ScamClassifier
from app.detection.fusion import fuse
from app.detection.rules import RuleEngine
from app.detection.transaction import is_benign_alert
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
        tactics = self.rules.detect(text)
        url_flags = self.urls.analyze(text)
        upi_flags = self.upi.analyze(text)
        classifier_score = self.classifier.predict(text)

        # Veto the classifier on a genuine transaction alert. The spam-trained model
        # misreads terse Indian bank SMS (P(scam)=0.99 on a real debit alert), and
        # when NOTHING deterministic has fired the classifier is the only voter - so
        # its overconfidence alone would cry wolf on a message banks send constantly.
        # A scam disguised as an alert still trips a tactic/URL/UPI signal above and
        # is therefore never silenced here.
        if not tactics and not url_flags and not upi_flags and is_benign_alert(text):
            classifier_score = None

        return fuse(
            tactics=tactics,
            url_flags=url_flags,
            upi_flags=upi_flags,
            classifier_score=classifier_score,
            lang=lang,
            settings=self.settings,
        )

    async def analyze(self, text: str, lang: Language) -> Signals:
        # Regex scanning and LightGBM inference are CPU-bound; keeping them off
        # the event loop is what lets one instance serve concurrent SSE streams.
        return await asyncio.to_thread(self.analyze_sync, text, lang)
