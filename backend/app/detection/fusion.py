from __future__ import annotations

from math import prod

from app.config import Settings
from app.schemas.contracts import Language, Signals, Tactic, UpiFlag, UrlFlag, Verdict


def _noisy_or(weights: list[float]) -> float:
    """Probability that at least one independent signal is real.

    Chosen over a weighted sum because it saturates instead of overflowing, is
    order-independent, and lets a single decisive signal (a UPI PIN request) reach
    a high score on its own while several weak signals still accumulate.
    """
    if not weights:
        return 0.0
    return 1.0 - prod(1.0 - min(max(weight, 0.0), 0.999) for weight in weights)


def _classifier_evidence(score: float, settings: Settings) -> float:
    """Convert P(scam) into risk, counting only the confident part.

    A binary classifier at 0.5 has told you nothing, so probability mass below
    the floor contributes nothing at all. Above it, the remaining range is
    stretched across `classifier_weight`. This is what keeps a model trained on
    public English spam from voting on Indian transactional SMS it misreads.
    """
    floor = settings.classifier_min_prob
    if score <= floor or floor >= 1.0:
        return 0.0
    return settings.classifier_weight * (score - floor) / (1.0 - floor)


def label_for(risk_score: int, settings: Settings) -> Verdict:
    if risk_score >= settings.risk_scam_threshold:
        return "scam"
    if risk_score >= settings.risk_suspicious_threshold:
        return "suspicious"
    return "safe"


def fuse(
    tactics: list[Tactic],
    url_flags: list[UrlFlag],
    upi_flags: list[UpiFlag],
    classifier_score: float | None,
    lang: Language,
    settings: Settings,
) -> Signals:
    """Combine every deterministic signal into one interpretable score.

    The classifier enters the same noisy-OR as one more piece of evidence, capped
    at `classifier_weight` and only counted above `classifier_min_prob`. It can
    therefore raise suspicion on a phrasing the lexicons have never seen, but can
    never talk the score down, and its absence only ever under-reports.
    """
    weights = [tactic.weight for tactic in tactics]
    weights += [flag.weight for flag in url_flags]
    weights += [flag.weight for flag in upi_flags]
    if classifier_score is not None:
        weights.append(_classifier_evidence(classifier_score, settings))

    risk_score = round(_noisy_or(weights) * 100)
    return Signals(
        label=label_for(risk_score, settings),
        risk_score=risk_score,
        tactics=tactics,
        url_flags=url_flags,
        upi_flags=upi_flags,
        lang=lang,
        classifier_score=round(classifier_score, 4) if classifier_score is not None else None,
    )
