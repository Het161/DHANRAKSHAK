/**
 * Port of backend/app/detection/classifier.py.
 *
 * Traverses the exported LightGBM trees over the tf-idf vector and returns
 * P(scam), or null when the input is out of the model's distribution. The model
 * is fitted on Latin-script SMS, so Devanagari/Gujarati are handed to the rules
 * tier alone (which carries those scripts anyway).
 */

import { vectorize } from "@/lib/engine/tfidf";
import type { ModelArtifact, TreeNode } from "@/lib/engine/types";

function inDistribution(text: string, minChars: number, minLatinShare: number): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (text.trim().length < minChars || letters.length === 0) return false;
  const latin = letters.filter((c) => c.charCodeAt(0) < 128).length;
  return latin / letters.length >= minLatinShare;
}

function traverse(node: TreeNode, vector: Map<number, number>): number {
  // A leaf is its value; internal nodes never carry NaN inputs (sparse tf-idf is
  // explicit zeros), so a plain value <= threshold decides left vs right.
  while (typeof node !== "number") {
    const [feature, threshold, left, right] = node;
    node = (vector.get(feature) ?? 0) <= threshold ? left : right;
  }
  return node;
}

/** P(scam) in [0,1], or null when the model should not vote on this input. */
export function classifierScore(model: ModelArtifact, text: string): number | null {
  const { min_chars, min_latin_share } = model.in_distribution;
  if (!inDistribution(text, min_chars, min_latin_share)) return null;
  const vector = vectorize(model, text);
  let raw = model.bias;
  for (const tree of model.trees) raw += traverse(tree, vector);
  return 1 / (1 + Math.exp(-raw));
}
