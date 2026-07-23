from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from rank_bm25 import BM25Okapi

from app.schemas.contracts import Advisory, Language

logger = logging.getLogger(__name__)

_FRONT_MATTER_RE = re.compile(r"\A---\s*\n(?P<meta>.*?)\n---\s*\n(?P<body>.*)\Z", re.DOTALL)
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_MAX_CHUNK_CHARS = 600
_MIN_CHUNK_CHARS = 120
_SNIPPET_CHARS = 420
# A document that names the tactic outranks one that merely shares vocabulary.
_TACTIC_MATCH_BONUS = 3.0


def _parse_front_matter(raw: str) -> tuple[dict[str, object], str]:
    """Parse the fixed key/value front matter used by the advisory files.

    Deliberately not a YAML parser: the format is ours, it is three scalar types
    wide, and a full YAML dependency buys nothing here.
    """
    match = _FRONT_MATTER_RE.match(raw)
    if not match:
        return {}, raw
    meta: dict[str, object] = {}
    for line in match.group("meta").splitlines():
        key, separator, value = line.partition(":")
        if not separator:
            continue
        key = key.strip()
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            meta[key] = [item.strip().strip("'\"") for item in value[1:-1].split(",") if item.strip()]
        else:
            meta[key] = value.strip("'\"")
    return meta, match.group("body")


def _chunk(body: str) -> list[str]:
    """Split on blank lines, then glue short fragments up to a readable size."""
    chunks: list[str] = []
    current = ""
    for block in (part.strip() for part in body.split("\n\n")):
        if not block or block.startswith("*"):
            continue
        is_heading = block.startswith("#")
        block = re.sub(r"^#+\s*", "", block).strip()
        if not block:
            continue
        # Without terminal punctuation a heading runs into the sentence that
        # follows it once the snippet collapses whitespace.
        if is_heading and block[-1] not in ".:!?":
            block = f"{block}."
        if len(current) + len(block) + 1 <= _MAX_CHUNK_CHARS:
            current = f"{current}\n{block}".strip()
        else:
            if len(current) >= _MIN_CHUNK_CHARS:
                chunks.append(current)
            current = block
    if current:
        chunks.append(current)
    return chunks


@dataclass(frozen=True, slots=True)
class AdvisoryChunk:
    source: str
    ref: str
    title: str
    text: str
    tactics: frozenset[str]
    languages: frozenset[str]
    tokens: list[str] = field(compare=False, default_factory=list)


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


class AdvisoryRetriever:
    """Tier 2. In-process BM25 over the advisory corpus.

    No vector store, no embedding model, no network: on a 512MB instance the
    corpus is small enough that lexical retrieval is both sufficient and the only
    option that survives a cold start.
    """

    def __init__(self, chunks: list[AdvisoryChunk], document_count: int) -> None:
        self._chunks = chunks
        self._index = BM25Okapi([chunk.tokens for chunk in chunks]) if chunks else None
        self.document_count = document_count

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)

    @classmethod
    def load(cls, directory: Path) -> AdvisoryRetriever:
        if not directory.is_dir():
            logger.warning("advisory directory missing path=%s", directory)
            return cls([], 0)

        chunks: list[AdvisoryChunk] = []
        documents = 0
        for path in sorted(directory.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                logger.warning("advisory unreadable file=%s error=%s", path.name, exc)
                continue
            meta, body = _parse_front_matter(raw)
            source = str(meta.get("source") or path.stem)
            ref = str(meta.get("ref") or path.stem)
            title = str(meta.get("title") or "")
            tactics = frozenset(str(item) for item in meta.get("tactics", []) or [])
            languages = frozenset(str(item) for item in meta.get("languages", []) or []) or frozenset({"en"})
            body_chunks = _chunk(body)
            if not body_chunks:
                continue
            documents += 1
            for text in body_chunks:
                chunks.append(
                    AdvisoryChunk(
                        source=source,
                        ref=ref,
                        title=title,
                        text=text,
                        tactics=tactics,
                        languages=languages,
                        tokens=_tokenize(f"{title} {' '.join(tactics)} {text}"),
                    )
                )

        logger.info("advisories loaded documents=%d chunks=%d", documents, len(chunks))
        return cls(chunks, documents)

    def retrieve_sync(self, flag_names: list[str], lang: Language) -> Advisory | None:
        """Pick the document by which tactics it covers, then the chunk by BM25.

        Two stages because they answer different questions. Which advisory applies
        is settled by the front matter, where a human said so; which paragraph of
        it to quote is a lexical question BM25 is good at. Ranking chunks directly
        lets a document that merely shares vocabulary outrank the one actually
        written about the tactic that fired.
        """
        # With nothing flagged there is nothing to advise about, and the closest
        # BM25 match would just be an unrelated warning attached to a safe message.
        if self._index is None or not self._chunks or not flag_names:
            return None

        query = " ".join(name.replace("_", " ") for name in flag_names)
        scores = self._index.get_scores(_tokenize(query))
        # Flags arrive strongest first, so an earlier match is worth more.
        relevance = {name: 1.0 / (1 + rank) for rank, name in enumerate(flag_names)}

        best_ref = self._best_document(relevance, lang)
        candidates = [
            index for index, chunk in enumerate(self._chunks) if best_ref is None or chunk.ref == best_ref
        ]
        best_index = max(candidates, key=lambda index: float(scores[index]), default=-1)

        if best_index < 0 or (best_ref is None and float(scores[best_index]) <= 0):
            return None
        chunk = self._chunks[best_index]
        return Advisory(source=chunk.source, ref=chunk.ref, snippet=_shorten(chunk.text))

    def _best_document(self, relevance: dict[str, float], lang: Language) -> str | None:
        per_document: dict[str, float] = {}
        for chunk in self._chunks:
            if chunk.ref in per_document:
                continue
            score = sum(relevance.get(tactic, 0.0) for tactic in chunk.tactics)
            if score:
                # Prefer an advisory already written in the reader's language;
                # today the corpus is English, so this falls through to English.
                per_document[chunk.ref] = score * _TACTIC_MATCH_BONUS + (
                    1.0 if lang in chunk.languages else 0.0
                )
        return max(per_document, key=per_document.__getitem__, default=None)

    async def retrieve(self, flag_names: list[str], lang: Language) -> Advisory | None:
        return await asyncio.to_thread(self.retrieve_sync, flag_names, lang)


def _shorten(text: str) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= _SNIPPET_CHARS:
        return collapsed
    cut = collapsed[:_SNIPPET_CHARS]
    boundary = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    return (cut[: boundary + 1] if boundary > _SNIPPET_CHARS // 2 else cut.rstrip() + "...").strip()
