"""Train the TF-IDF + LightGBM scam classifier and write the committed artifact.

Run offline, never at server startup:

    python scripts/train_classifier.py

The artifact it writes (models/scam_clf.joblib) is loaded once during application
startup. If it is absent the API still works: see app/detection/classifier.py.
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from lightgbm import LGBMClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

UCI_URL = "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip"
UCI_CACHE = BACKEND_ROOT / "data" / "corpus" / "cache" / "SMSSpamCollection"
SEED_CSV = BACKEND_ROOT / "data" / "corpus" / "labelled.csv"
DEFAULT_OUTPUT = BACKEND_ROOT / "models" / "scam_clf.joblib"

# The seed corpus is three orders of magnitude smaller than UCI but is the only
# source of Indian scam phrasing and of Devanagari/Gujarati script, so each of its
# rows counts for many during fitting.
SEED_SAMPLE_WEIGHT = 25.0

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
logger = logging.getLogger("train")


@dataclass(slots=True)
class Dataset:
    texts: list[str]
    labels: list[int]
    weights: list[float]
    origins: list[str]


def _fetch_uci(no_download: bool) -> list[tuple[str, int]]:
    if UCI_CACHE.is_file():
        logger.info("using cached UCI dataset at %s", UCI_CACHE)
        raw = UCI_CACHE.read_text(encoding="utf-8", errors="replace")
    elif no_download:
        logger.warning("--no-download set and no cache present; skipping UCI dataset")
        return []
    else:
        logger.info("downloading UCI SMS Spam Collection")
        try:
            with urllib.request.urlopen(UCI_URL, timeout=60) as response:
                archive = zipfile.ZipFile(io.BytesIO(response.read()))
        except (urllib.error.URLError, TimeoutError, zipfile.BadZipFile, OSError) as exc:
            logger.warning("UCI download unavailable (%s); training on seed corpus only", exc)
            return []
        raw = archive.read("SMSSpamCollection").decode("utf-8", errors="replace")
        UCI_CACHE.parent.mkdir(parents=True, exist_ok=True)
        UCI_CACHE.write_text(raw, encoding="utf-8")
        logger.info("cached UCI dataset at %s", UCI_CACHE)

    rows: list[tuple[str, int]] = []
    for line in raw.splitlines():
        label, _, text = line.partition("\t")
        if text:
            rows.append((text, 1 if label.strip() == "spam" else 0))
    logger.info("UCI rows: %d", len(rows))
    return rows


def _load_seed() -> list[tuple[str, int]]:
    if not SEED_CSV.is_file():
        raise SystemExit(f"seed corpus missing: {SEED_CSV}")
    rows: list[tuple[str, int]] = []
    with SEED_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            text = (row.get("text") or "").strip()
            label = (row.get("label") or "").strip().lower()
            if text and label in ("scam", "safe"):
                rows.append((text, 1 if label == "scam" else 0))
    logger.info("seed rows: %d", len(rows))
    return rows


def build_dataset(no_download: bool) -> Dataset:
    dataset = Dataset(texts=[], labels=[], weights=[], origins=[])
    for text, label in _fetch_uci(no_download):
        dataset.texts.append(text)
        dataset.labels.append(label)
        dataset.weights.append(1.0)
        dataset.origins.append("uci")
    for text, label in _load_seed():
        dataset.texts.append(text)
        dataset.labels.append(label)
        dataset.weights.append(SEED_SAMPLE_WEIGHT)
        dataset.origins.append("seed")
    if len(set(dataset.labels)) < 2:
        raise SystemExit("training data must contain both classes")
    return dataset


def build_pipeline(seed: int) -> Pipeline:
    # Character n-grams carry most of the signal for Devanagari and Gujarati,
    # where whitespace tokenisation alone generalises poorly on a small corpus.
    features = FeatureUnion(
        [
            ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, sublinear_tf=True)),
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=3, sublinear_tf=True)),
        ]
    )
    model = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.08,
        num_leaves=31,
        min_child_samples=10,
        subsample=0.9,
        colsample_bytree=0.7,
        random_state=seed,
        n_jobs=-1,
        verbose=-1,
    )
    return Pipeline([("features", features), ("model", model)])


def _report_slice(name: str, y_true: np.ndarray, y_pred: np.ndarray) -> None:
    if y_true.size == 0:
        return
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    logger.info("%-18s n=%-5d precision=%.3f recall=%.3f f1=%.3f", name, y_true.size, precision, recall, f1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--no-download", action="store_true", help="never reach the network; use cache or seed only"
    )
    args = parser.parse_args()

    dataset = build_dataset(args.no_download)
    texts = np.array(dataset.texts, dtype=object)
    labels = np.array(dataset.labels)
    weights = np.array(dataset.weights)
    origins = np.array(dataset.origins)

    idx_train, idx_test = train_test_split(
        np.arange(len(texts)),
        test_size=args.test_size,
        random_state=args.seed,
        stratify=labels,
    )

    pipeline = build_pipeline(args.seed)
    logger.info("fitting on %d rows", idx_train.size)
    pipeline.fit(texts[idx_train], labels[idx_train], model__sample_weight=weights[idx_train])

    predictions = pipeline.predict(texts[idx_test])
    print(classification_report(labels[idx_test], predictions, target_names=["safe", "scam"], digits=3))

    _report_slice("holdout:all", labels[idx_test], predictions)
    for origin in ("uci", "seed"):
        mask = origins[idx_test] == origin
        _report_slice(f"holdout:{origin}", labels[idx_test][mask], predictions[mask])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, args.output, compress=3)
    logger.info("artifact written %s (%.1f KB)", args.output, args.output.stat().st_size / 1024)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
