"""Score the labelled corpus with the rules tier and report the confusion matrix.

    python scripts/eval_corpus.py

Use this after editing a lexicon. A false positive here (a genuine bank SMS
scored as a scam) is the expensive kind of mistake: it teaches users to ignore
the warning.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings
from app.detection.engine import DetectionEngine
from app.pipelines.language import detect_language

CORPUS = BACKEND_ROOT / "data" / "corpus" / "labelled.csv"


def main() -> int:
    settings = get_settings()
    engine = DetectionEngine.build(settings)

    rows = list(csv.DictReader(CORPUS.open(encoding="utf-8")))
    counts = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    mistakes: list[str] = []

    for row in rows:
        text = row["text"]
        signals = engine.analyze_sync(text, detect_language(text))
        flagged = signals.label != "safe"
        is_scam = row["label"] == "scam"

        if is_scam and flagged:
            counts["tp"] += 1
        elif is_scam:
            counts["fn"] += 1
            mistakes.append(f"  MISSED  [{row['lang']}] risk={signals.risk_score:>3}  {text[:88]}")
        elif flagged:
            counts["fp"] += 1
            names = [tactic.name for tactic in signals.tactics] + [
                flag.reason for flag in signals.url_flags + signals.upi_flags
            ]
            mistakes.append(
                f"  FALSE   [{row['lang']}] risk={signals.risk_score:>3}  {text[:60]}\n"
                f"          fired: {', '.join(names)}"
            )
        else:
            counts["tn"] += 1

    precision = counts["tp"] / max(counts["tp"] + counts["fp"], 1)
    recall = counts["tp"] / max(counts["tp"] + counts["fn"], 1)

    print(f"\ncorpus rows: {len(rows)}   classifier: {'yes' if engine.classifier.loaded else 'no'}")
    print(f"tp={counts['tp']} fp={counts['fp']} tn={counts['tn']} fn={counts['fn']}")
    print(f"precision={precision:.3f} recall={recall:.3f}\n")
    for line in mistakes:
        print(line)
    return 0 if not mistakes else 1


if __name__ == "__main__":
    raise SystemExit(main())
