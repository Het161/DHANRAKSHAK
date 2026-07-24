from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass

from app.config import Settings
from app.schemas.contracts import LanguageHint

logger = logging.getLogger(__name__)

_FALLBACK_PACK = "eng"
_MAX_EDGE_PX = 1600
# Tesseract LSTM engine, "assume a uniform block of text" - the right mode for a
# screenshot of an SMS/chat, and far faster than the default layout analysis.
_TESSERACT_CONFIG = "--oem 1 --psm 6"

# The app's language is the overwhelming predictor of a screenshot's script, so
# we run at most the hint's pack plus English rather than all three at once.
# Running every pack together is what made OCR miss the budget on a 0.1 vCPU.
_HINT_PACKS: dict[LanguageHint, tuple[str, ...]] = {
    "gu": ("guj", "eng"),
    "hi": ("hin", "eng"),
    "en": ("eng",),
    "auto": ("eng",),
}


class OcrError(RuntimeError):
    """Base for any failure to turn a screenshot into text."""


class OcrUnavailable(OcrError):
    """No usable Tesseract on this server; screenshot input is disabled."""


class OcrTimedOut(OcrError):
    """OCR did not finish inside the budget."""


class OcrEmpty(OcrError):
    """OCR ran but found no readable text."""


@dataclass(slots=True)
class OcrResult:
    text: str
    langs: str
    bytes_in: int
    width: int
    height: int
    decode_ms: int
    preprocess_ms: int
    ocr_ms: int
    cached: bool = False

    def debug(self) -> dict[str, object]:
        return {
            "ocr_langs": self.langs,
            "image_bytes_in": self.bytes_in,
            "image_dims": f"{self.width}x{self.height}",
            "decode_ms": self.decode_ms,
            "preprocess_ms": self.preprocess_ms,
            "ocr_ms": self.ocr_ms,
            "ocr_cached": self.cached,
        }


@dataclass(slots=True)
class _Extracted:
    text: str
    width: int
    height: int
    decode_ms: int
    preprocess_ms: int
    ocr_ms: int


class OcrEngine:
    """Screenshot to text via Tesseract.

    Language packs are probed once at startup rather than assumed: the hosted
    image installs hin and guj, but a developer machine usually has only eng, and
    the difference is visible in /api/health rather than at request time.
    """

    def __init__(self, langs: tuple[str, ...], settings: Settings) -> None:
        self.langs = langs
        self._timeout_s = settings.ocr_timeout_s
        self._hard_budget_s = settings.ocr_hard_budget_s
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._cache_size = settings.ocr_cache_size

    @property
    def available(self) -> bool:
        return bool(self.langs)

    @classmethod
    def detect(cls, settings: Settings) -> OcrEngine:
        try:
            import pytesseract

            installed = set(pytesseract.get_languages(config=""))
        except Exception as exc:  # noqa: BLE001 - a missing binary must not stop startup
            logger.warning("tesseract unavailable error=%s; image input disabled", exc)
            return cls((), settings)

        wanted = ("eng", "hin", "guj")
        langs = tuple(pack for pack in wanted if pack in installed)
        if not langs and _FALLBACK_PACK in installed:
            langs = (_FALLBACK_PACK,)
        if len(langs) < len(wanted):
            logger.warning("tesseract missing packs available=%s wanted=%s", sorted(langs), list(wanted))
        logger.info("ocr ready langs=%s", "+".join(langs) or "none")
        return cls(langs, settings)

    def langs_for(self, hint: LanguageHint) -> str:
        """The Tesseract lang string for this session, chosen from the app language."""
        wanted = _HINT_PACKS.get(hint, ("eng",))
        chosen = tuple(pack for pack in wanted if pack in self.langs)
        if not chosen:
            chosen = ("eng",) if "eng" in self.langs else self.langs[:1]
        return "+".join(chosen)

    def _extract_sync(self, data: bytes, langs: str) -> _Extracted:
        import pytesseract
        from PIL import Image, ImageOps, UnidentifiedImageError

        decode_start = time.perf_counter()
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise OcrError("That file could not be read as an image.") from exc
        decode_ms = int((time.perf_counter() - decode_start) * 1000)

        pre_start = time.perf_counter()
        # Honour EXIF rotation, then grayscale + cap the longest edge + a mild
        # contrast stretch: less pixel data and cleaner glyphs for the recognizer.
        image = ImageOps.exif_transpose(image)
        image = image.convert("L")
        if max(image.size) > _MAX_EDGE_PX:
            scale = _MAX_EDGE_PX / max(image.size)
            image = image.resize((int(image.width * scale), int(image.height * scale)))
        image = ImageOps.autocontrast(image)
        width, height = image.size
        preprocess_ms = int((time.perf_counter() - pre_start) * 1000)

        ocr_start = time.perf_counter()
        try:
            text = pytesseract.image_to_string(
                image, lang=langs, config=_TESSERACT_CONFIG, timeout=self._timeout_s
            )
        except RuntimeError as exc:  # pytesseract raises this on its own timeout
            raise OcrTimedOut("Reading the screenshot took too long.") from exc
        except pytesseract.TesseractError as exc:
            raise OcrError("The screenshot could not be read.") from exc
        ocr_ms = int((time.perf_counter() - ocr_start) * 1000)

        return _Extracted(text, width, height, decode_ms, preprocess_ms, ocr_ms)

    async def extract(self, data: bytes, hint: LanguageHint) -> OcrResult:
        if not self.available:
            raise OcrUnavailable("Screenshot reading is not available on this server.")

        langs = self.langs_for(hint)
        # Key on the uploaded bytes: the client sends the same prepared JPEG on a
        # retry, so an identical screenshot resolves from cache without re-running OCR.
        key = f"{hashlib.sha256(data).hexdigest()}:{langs}"
        if (cached := self._cache.get(key)) is not None:
            self._cache.move_to_end(key)
            return OcrResult(cached, langs, len(data), 0, 0, 0, 0, 0, cached=True)

        try:
            extracted = await asyncio.wait_for(
                asyncio.to_thread(self._extract_sync, data, langs), timeout=self._hard_budget_s
            )
        except TimeoutError as exc:
            raise OcrTimedOut("Reading the screenshot took too long.") from exc

        if not extracted.text.strip():
            raise OcrEmpty("No readable text was found in that image.")

        self._cache[key] = extracted.text
        self._cache.move_to_end(key)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)

        return OcrResult(
            text=extracted.text,
            langs=langs,
            bytes_in=len(data),
            width=extracted.width,
            height=extracted.height,
            decode_ms=extracted.decode_ms,
            preprocess_ms=extracted.preprocess_ms,
            ocr_ms=extracted.ocr_ms,
        )
