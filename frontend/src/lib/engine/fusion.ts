/**
 * Port of backend/app/detection/fusion.py.
 *
 * Noisy-OR over every deterministic signal's weight. The classifier enters as one
 * more piece of evidence, capped at classifier_weight and counted only above
 * classifier_min_prob, so it can raise suspicion but never talk the score down.
 */

import type { Thresholds } from "@/lib/engine/types";
import type { Verdict } from "@/lib/types";

function noisyOr(weights: number[]): number {
  if (weights.length === 0) return 0;
  let product = 1;
  for (const weight of weights) product *= 1 - Math.min(Math.max(weight, 0), 0.999);
  return 1 - product;
}

function classifierEvidence(score: number, thresholds: Thresholds): number {
  const floor = thresholds.classifier_min_prob;
  if (score <= floor || floor >= 1) return 0;
  return (thresholds.classifier_weight * (score - floor)) / (1 - floor);
}

export function labelFor(risk: number, thresholds: Thresholds): Verdict {
  if (risk >= thresholds.risk_scam_threshold) return "scam";
  if (risk >= thresholds.risk_suspicious_threshold) return "suspicious";
  return "safe";
}

export interface FusionInput {
  tacticWeights: number[];
  urlWeights: number[];
  upiWeights: number[];
  classifierScore: number | null;
}

export function fuseRisk(input: FusionInput, thresholds: Thresholds): number {
  const weights = [...input.tacticWeights, ...input.urlWeights, ...input.upiWeights];
  if (input.classifierScore !== null) {
    weights.push(classifierEvidence(input.classifierScore, thresholds));
  }
  return Math.round(noisyOr(weights) * 100);
}
