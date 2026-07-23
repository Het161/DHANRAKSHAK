from __future__ import annotations

import asyncio
import io
import logging

from app.config import Settings

logger = logging.getLogger(__name__)

# Tesseract language packs, in preference order, mapped to our language codes.
_WANTED_PACKS = ("eng", "hin", "guj")
_FALLBACK_PACK = "eng"
_MAX_EDGE_PX = 1600


class OcrError(RuntimeError):
    """Screenshot could not be turned into text. Reported to the caller as 422."""


class OcrUnavailable(OcrError):
    pass


class OcrEngine:
    """Screenshot to text via Tesseract.

    Language packs are probed once at startup rather than assumed: the hosted
    image installs hin and guj, but a developer machine usually has only eng, and
    the difference should be visible in /api/health rather than at request time.
    """

    def __init__(self, langs: tuple[str, ...], timeout_s: float) -> None:
        self.langs = langs
        self._timeout_s = timeout_s

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
            return cls((), settings.ocr_timeout_s)

        langs = tuple(pack for pack in _WANTED_PACKS if pack in installed)
        if not langs and _FALLBACK_PACK in installed:
            langs = (_FALLBACK_PACK,)
        if len(langs) < len(_WANTED_PACKS):
            logger.warning(
                "tesseract missing packs available=%s wanted=%s", sorted(langs), list(_WANTED_PACKS)
            )
        logger.info("ocr ready langs=%s", "+".join(langs) or "none")
        return cls(langs, settings.ocr_timeout_s)

    def _extract_sync(self, data: bytes) -> str:
        import pytesseract
        from PIL import Image, UnidentifiedImageError

        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise OcrError("That file could not be read as an image.") from exc

        if image.mode not in ("L", "RGB"):
            image = image.convert("RGB")
        if max(image.size) > _MAX_EDGE_PX:
            scale = _MAX_EDGE_PX / max(image.size)
            image = image.resize((int(image.width * scale), int(image.height * scale)))

        try:
            return pytesseract.image_to_string(image, lang="+".join(self.langs), timeout=self._timeout_s)
        except RuntimeError as exc:
            raise OcrError("Reading the screenshot took too long.") from exc
        except pytesseract.TesseractError as exc:
            raise OcrError("The screenshot could not be read.") from exc

    async def extract(self, data: bytes) -> str:
        if not self.available:
            raise OcrUnavailable("Screenshot reading is not available on this server.")
        text = await asyncio.to_thread(self._extract_sync, data)
        if not text.strip():
            raise OcrError("No readable text was found in that image.")
        return text
