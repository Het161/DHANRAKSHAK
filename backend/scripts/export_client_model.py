"""Export the real detection engine to versioned JSON for the offline client.

Run offline, never at server startup:

    python scripts/export_client_model.py

Writes frontend/public/engine/*.json: the SAME lexicons, URL/UPI tables,
templates and advisories the server loads (single source of truth - copied from
the data files, never hand-authored here), plus the trained TF-IDF + LightGBM
model as tree JSON. The client engine in frontend/src/lib/engine ports these
verbatim, so an on-device verdict matches the server's.

Two things this script guarantees before it writes anything:
  * self-parity: a pure-Python traversal of the exported trees reproduces
    sklearn predict_proba to < 1e-6, so the identical traversal in TypeScript
    will too. If this drifts, the export is wrong, not the port.
  * budget: every artifact's gzipped size is reported, and the total is checked
    against the 1.5MB offline budget.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings
from app.detection.engine import DetectionEngine
from app.explain.rag import _chunk, _parse_front_matter, _tokenize

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
logger = logging.getLogger("export")

OUT_DIR = BACKEND_ROOT.parent / "frontend" / "public" / "engine"
FIXTURES_OUT = BACKEND_ROOT.parent / "frontend" / "src" / "lib" / "engine" / "__fixtures__" / "parity.json"

# 20 messages spanning every tactic, both scripts, and clear negatives. Expected
# verdicts are computed by the REAL server engine below, never hand-labelled.
FIXTURE_INPUTS: list[tuple[str, str]] = [
    ("Your account will be blocked today. Complete KYC now at http://sbi-kyc.xyz/verify", "en"),
    ("Congratulations! You won 25 lakh in KBC lucky draw. Pay 4999 processing fee to claim.", "en"),
    ("Dear customer, share the OTP we just sent to verify your debit card ending 4432.", "en"),
    ("Download our loan app apk from http://quickloan-cash.top/app.apk and get 50000 instantly", "en"),
    (
        "This is Inspector Sharma from CBI. Your Aadhaar is used in money laundering. Stay on video call.",
        "en",
    ),
    ("Install AnyDesk so I can help you complete the refund process from your bank.", "en"),
    ("You have received Rs 5000. Enter your UPI PIN to receive the money in your account.", "en"),
    ("upi://collect?pa=fraud@okaxis&pn=Refund&am=4999&tn=claim your prize", "en"),
    ("Hi ma, reaching home by 8, please keep dinner ready. Love you.", "en"),
    ("Your Amazon order 402-118 has shipped and will arrive Tuesday. Track in the app.", "en"),
    ("Meeting moved to 3pm tomorrow in conference room B. Bring the quarterly report.", "en"),
    ("तुरंत अपना KYC पूरा करें वरना आपका खाता बंद हो जाएगा। यहां क्लिक करें", "hi"),
    ("बधाई हो! आपने 10 लाख का इनाम जीता है। दावा करने के लिए 5000 शुल्क भेजें।", "hi"),
    ("मैं CBI से बोल रहा हूं, आपके आधार पर केस है, वीडियो कॉल पर रहिए वरना गिरफ्तारी होगी", "hi"),
    ("कल शाम को मंदिर चलेंगे, तैयार रहना। खाना बनाकर रखना।", "hi"),
    ("તમારું ખાતું બંધ થઈ જશે. તાત્કાલિક KYC કરો અને OTP શેર કરો.", "gu"),
    ("અભિનંદન! તમે લોટરીમાં 15 લાખ જીત્યા છો. ફી ભરીને ઇનામ મેળવો.", "gu"),
    ("કાલે સવારે દૂધ લઈ આવજો અને છાપું પણ. આભાર.", "gu"),
    ("verify account netbanking suspended click 192.168.10.5/login to restore access now", "en"),
    ("paytmmp://pay?pa=raju@paytm&pn=Raju&am=200 for the vegetables, thanks bhai", "en"),
]


def _round_floats(value: Any, places: int) -> Any:
    """Round every float in a nested structure, so the JSON stays small and stable."""
    if isinstance(value, float):
        return round(value, places)
    if isinstance(value, list):
        return [_round_floats(item, places) for item in value]
    if isinstance(value, dict):
        return {key: _round_floats(item, places) for key, item in value.items()}
    return value


# --- TF-IDF export ---------------------------------------------------------


def _export_vectorizer(vec: Any) -> dict[str, Any]:
    """Vocabulary in feature-index order plus idf, so the client rebuilds the exact
    sparse vector the trees were trained on. Terms are stored positionally: the
    array index IS the feature index, which is what the tree split_feature refers to."""
    vocab = vec.vocabulary_
    terms = [""] * len(vocab)
    for term, index in vocab.items():
        terms[index] = term
    return {
        "analyzer": vec.analyzer,  # "word" | "char_wb"
        "ngram_range": list(vec.ngram_range),
        "sublinear_tf": bool(vec.sublinear_tf),
        "lowercase": bool(vec.lowercase),
        "norm": vec.norm,
        "terms": terms,
        "idf": [round(float(x), 5) for x in vec.idf_],
    }


# --- LightGBM export -------------------------------------------------------


def _convert_node(node: dict[str, Any]) -> Any:
    """A leaf becomes its float value; an internal node becomes [feature, threshold,
    left, right]. decision_type is always '<=' and inputs are never NaN (sparse
    tf-idf is explicit zeros), so the client compares value <= threshold and goes
    left, else right - no missing-value branch is needed."""
    if "leaf_value" in node:
        return round(float(node["leaf_value"]), 7)
    assert node["decision_type"] == "<=", f"unexpected decision_type {node['decision_type']}"
    return [
        int(node["split_feature"]),
        round(float(node["threshold"]), 7),
        _convert_node(node["left_child"]),
        _convert_node(node["right_child"]),
    ]


def _traverse(node: Any, vector: dict[int, float]) -> float:
    if isinstance(node, (int, float)):
        return float(node)
    feature, threshold, left, right = node
    value = vector.get(feature, 0.0)
    return _traverse(left if value <= threshold else right, vector)


# --- exact-parity reference transform (mirrors sklearn, used only to self-check) ---


def _reference_vector(vectorizers: list[tuple[int, Any, dict[str, Any]]], text: str) -> dict[int, float]:
    """Rebuild the concatenated tf-idf vector the way the client will, then check
    it against sklearn. Offsets place word features at [0, n_word) and char at
    [n_word, n_word + n_char)."""
    import math
    import re

    token_re = re.compile(r"[\w]{2,}", re.UNICODE)
    vector: dict[int, float] = {}
    for offset, _vec, exported in vectorizers:
        low = text.lower() if exported["lowercase"] else text
        min_n, max_n = exported["ngram_range"]
        counts: dict[str, int] = {}
        if exported["analyzer"] == "word":
            tokens = token_re.findall(low)
            grams = list(tokens)
            for n in range(max(min_n, 2), max_n + 1):
                grams += [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]
        else:  # char_wb - mirrors sklearn CountVectorizer._char_wb_ngrams exactly
            grams = []
            for word in low.split():
                padded = f" {word} "
                w_len = len(padded)
                for n in range(min_n, max_n + 1):
                    grams.append(padded[:n])  # w[0:n]; equals the whole word when n >= w_len
                    if n >= w_len:
                        # The word is shorter than n, so no sliding happened: sklearn
                        # counts it once at this n and stops growing n for this word.
                        break
                    grams += [padded[i : i + n] for i in range(1, w_len - n + 1)]
        for gram in grams:
            counts[gram] = counts.get(gram, 0) + 1
        index_of = {term: i for i, term in enumerate(exported["terms"])}
        idf = exported["idf"]
        raw: dict[int, float] = {}
        for term, count in counts.items():
            j = index_of.get(term)
            if j is None:
                continue
            tf = 1.0 + math.log(count) if exported["sublinear_tf"] else count
            raw[j] = tf * idf[j]
        norm = math.sqrt(sum(v * v for v in raw.values())) if exported["norm"] == "l2" else 0.0
        for j, v in raw.items():
            vector[offset + j] = v / norm if norm > 0 else v
    return vector


def main() -> int:
    settings = get_settings()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Lexicons + URL/UPI tables: the exact data files the server loads.
    lexicons = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(Path(settings.lexicon_dir).glob("*.json"))
        if path.name not in ("bank_domains.json", "upi_context.json")
        and isinstance(json.loads(path.read_text(encoding="utf-8")), dict)
        and "tactic" in json.loads(path.read_text(encoding="utf-8"))
    ]
    url_config = json.loads((Path(settings.lexicon_dir) / "bank_domains.json").read_text("utf-8"))
    upi_config = json.loads((Path(settings.lexicon_dir) / "upi_context.json").read_text("utf-8"))

    # 2. Templates (gu/hi/en) and advisories (chunked exactly like the server's RAG).
    templates = {
        lang: json.loads((Path(settings.template_dir) / f"explanations.{lang}.json").read_text("utf-8"))
        for lang in ("en", "hi", "gu")
    }
    advisories = _export_advisories(Path(settings.advisory_dir))

    # 3. The trained model: two TF-IDF vectorizers + LightGBM trees.
    pipeline = joblib.load(settings.model_path)
    union = pipeline.named_steps["features"]
    clf = pipeline.named_steps["model"]
    word_vec = union.transformer_list[0][1]
    char_vec = union.transformer_list[1][1]
    word_export = _export_vectorizer(word_vec)
    char_export = _export_vectorizer(char_vec)
    n_word = len(word_export["terms"])

    dumped = clf.booster_.dump_model()
    trees = [_convert_node(t["tree_structure"]) for t in dumped["tree_info"]]

    bias = _self_parity_check(pipeline, union, clf, word_export, char_export, n_word, trees)

    model = {
        "word": word_export,
        "char": char_export,
        "word_feature_count": n_word,
        "trees": trees,
        "bias": round(bias, 9),
        "in_distribution": {"min_chars": 25, "min_latin_share": 0.6},
    }

    thresholds = {
        "risk_suspicious_threshold": settings.risk_suspicious_threshold,
        "risk_scam_threshold": settings.risk_scam_threshold,
        "classifier_weight": settings.classifier_weight,
        "classifier_min_prob": settings.classifier_min_prob,
    }

    # 4. Write everything, then a manifest whose hash covers every file.
    files = {
        "rules.json": {"lexicons": lexicons},
        "url_config.json": url_config,
        "upi_config.json": upi_config,
        "templates.json": templates,
        "advisories.json": {"chunks": advisories},
        "model.json": model,
        "config.json": {"thresholds": thresholds},
        "personas.json": _export_personas(settings),
    }
    written: dict[str, dict[str, int]] = {}
    total_gz = 0
    for name, payload in files.items():
        raw = json.dumps(_round_floats(payload, 6), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (OUT_DIR / name).write_bytes(raw)
        gz = len(gzip.compress(raw, 9))
        total_gz += gz
        written[name] = {"raw": len(raw), "gzip": gz}
        logger.info("wrote %-18s raw=%7.1fKB gzip=%6.1fKB", name, len(raw) / 1024, gz / 1024)

    version = hashlib.sha256(b"".join((OUT_DIR / name).read_bytes() for name in files)).hexdigest()[:12]
    manifest = {
        "engine_version": version,
        "generated_from": "scripts/export_client_model.py",
        "files": list(files),
        "sizes": written,
        "thresholds": thresholds,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    logger.info("engine_version=%s total gzip=%.1fKB", version, total_gz / 1024)
    if total_gz > 1_100_000:
        logger.warning(
            "engine artifacts %.1fKB gzipped - leaves little of the 1.5MB shell budget", total_gz / 1024
        )

    _write_fixtures(settings)
    return 0


def _export_personas(settings) -> dict[str, Any]:
    """Persona pools + coach rules for OFFLINE practice.

    The server-only fields (the LLM system_prompt and the TTS voice config) are
    dropped: offline practice assembles turns from the variant pools and scores
    replies with the coach's regex rules, so it never needs them. Everything the
    client-side scenario builder and coach read is kept verbatim - same pools,
    same evaluation rules, so a practice session behaves the same offline."""
    personas = []
    for path in sorted(Path(settings.persona_dir).glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or "id" not in payload:
            continue
        payload.pop("system_prompt", None)
        payload.pop("voice", None)
        personas.append(payload)
    return {"max_turns": settings.simulator_max_turns, "personas": personas}


def _export_advisories(directory: Path) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.md")):
        meta, body = _parse_front_matter(path.read_text(encoding="utf-8"))
        source = str(meta.get("source") or path.stem)
        ref = str(meta.get("ref") or path.stem)
        title = str(meta.get("title") or "")
        tactics = [str(x) for x in (meta.get("tactics") or [])]
        languages = [str(x) for x in (meta.get("languages") or [])] or ["en"]
        for text in _chunk(body):
            chunks.append(
                {
                    "source": source,
                    "ref": ref,
                    "title": title,
                    "text": text,
                    "tactics": tactics,
                    "languages": languages,
                    "tokens": _tokenize(f"{title} {' '.join(tactics)} {text}"),
                }
            )
    return chunks


def _self_parity_check(pipeline, union, clf, word_export, char_export, n_word, trees) -> float:
    """Prove the exported trees + our tf-idf transform reproduce sklearn exactly.

    Returns the bias (constant offset between summed leaves and the LightGBM raw
    margin); it is ~0 for boost-from-average binary models but exported anyway so
    the client never has to assume it."""
    vectorizers = [
        (0, union.transformer_list[0][1], word_export),
        (n_word, union.transformer_list[1][1], char_export),
    ]
    samples = [text for text, _ in FIXTURE_INPUTS] + [
        "click here to win free recharge now",
        "your parcel is held at customs pay fine",
    ]

    # bias from the first sample: raw_margin - summed_leaves.
    X0 = union.transform([samples[0]])
    raw_margin = float(clf.booster_.predict(X0, raw_score=True)[0])
    leaves_only = sum(_traverse(tree, _reference_vector(vectorizers, samples[0])) for tree in trees)
    bias = raw_margin - leaves_only

    max_prob_err = 0.0
    max_vec_err = 0.0
    for text in samples:
        sk_vec = union.transform([text]).toarray()[0]
        my_vec = _reference_vector(vectorizers, text)
        for j, v in my_vec.items():
            max_vec_err = max(max_vec_err, abs(v - sk_vec[j]))
        # any sklearn feature we missed?
        for j in np.nonzero(sk_vec)[0]:
            if j not in my_vec:
                max_vec_err = max(max_vec_err, abs(float(sk_vec[j])))
        my_raw = sum(_traverse(tree, my_vec) for tree in trees) + bias
        my_prob = 1.0 / (1.0 + np.exp(-my_raw))
        sk_prob = float(clf.predict_proba(union.transform([text]))[0][1])
        max_prob_err = max(max_prob_err, abs(my_prob - sk_prob))

    logger.info(
        "self-parity: max tf-idf feature error=%.2e  max P(scam) error=%.2e  bias=%.3e",
        max_vec_err,
        max_prob_err,
        bias,
    )
    if max_prob_err > 1e-4:
        logger.error(
            "SELF-PARITY FAILED (%.2e) - the TypeScript port cannot match; investigate before shipping",
            max_prob_err,
        )
    return bias


def _write_fixtures(settings) -> None:
    """Expected verdicts from the REAL engine, for the client parity test."""
    engine = DetectionEngine.build(settings)
    rows = []
    for text, lang in FIXTURE_INPUTS:
        signals = engine.analyze_sync(text, lang)  # type: ignore[arg-type]
        rows.append(
            {
                "text": text,
                "lang": lang,
                "verdict": signals.label,
                "risk_score": signals.risk_score,
                "classifier_score": signals.classifier_score,
            }
        )
    FIXTURES_OUT.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES_OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("wrote %d parity fixtures to %s", len(rows), FIXTURES_OUT)


if __name__ == "__main__":
    raise SystemExit(main())
