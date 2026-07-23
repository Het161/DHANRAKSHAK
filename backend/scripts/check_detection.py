"""Readable sanity check over the sample messages in tests/samples.py.

    python scripts/check_detection.py

Prints the verdict, risk score, engine latency and matched signals for each
sample, and exits non-zero if any sample lands on the wrong side of the
thresholds. This is the fast feedback loop when tuning lexicons or weights.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(BACKEND_ROOT), str(BACKEND_ROOT / "tests")]

from samples import ALL_SAMPLES, Sample

from app.config import get_settings
from app.detection.engine import DetectionEngine
from app.schemas.contracts import Signals


def _names(signals: Signals) -> list[str]:
    return (
        [tactic.name for tactic in signals.tactics]
        + [flag.reason for flag in signals.url_flags]
        + [flag.reason for flag in signals.upi_flags]
    )


def _check(engine: DetectionEngine, sample: Sample) -> tuple[bool, float]:
    start = time.perf_counter()
    signals = engine.analyze_sync(sample.text, sample.lang)
    elapsed_ms = (time.perf_counter() - start) * 1000

    verdict_ok = signals.label == sample.expect
    names = _names(signals)
    signals_ok = not sample.expect_any_of or bool(set(names) & set(sample.expect_any_of))
    ok = verdict_ok and signals_ok

    print(
        f"  {'PASS' if ok else 'FAIL'}  {sample.id:<26} "
        f"expected={sample.expect:<10} got={signals.label:<10} "
        f"risk={signals.risk_score:>3}  {elapsed_ms:>6.1f}ms"
    )
    print(f"        signals: {', '.join(names) if names else 'none'}")
    if signals.classifier_score is not None:
        print(f"        classifier P(scam)={signals.classifier_score:.3f}")
    if not signals_ok:
        print(f"        missing any of: {', '.join(sample.expect_any_of)}")
    for tactic in signals.tactics:
        start_idx, end_idx = tactic.evidence_span
        print(f"        evidence [{tactic.name}]: {sample.text[start_idx:end_idx][:80]!r}")
    print()
    return ok, elapsed_ms


def main() -> int:
    settings = get_settings()
    engine = DetectionEngine.build(settings)

    print(
        f"\nthresholds: suspicious>={settings.risk_suspicious_threshold} scam>={settings.risk_scam_threshold}"
    )
    print(
        f"tactics loaded: {len(engine.rules.tactics)}  "
        f"classifier: {'yes' if engine.classifier.loaded else 'no'}\n"
    )

    engine.analyze_sync("warmup", "en")

    results = [_check(engine, sample) for sample in ALL_SAMPLES]
    passed = sum(1 for ok, _ in results if ok)
    slowest = max(elapsed for _, elapsed in results)

    print(f"{passed}/{len(results)} samples correct, slowest engine pass {slowest:.1f}ms")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
