/**
 * Port of the scikit-learn TfidfVectorizer transform used by the trained model,
 * verified byte-for-byte against sklearn in export_client_model.py (self-parity
 * max feature error 3e-7). The two vectorizers (word 1-2gram, char_wb 2-5gram)
 * are each L2-normalized on their own block, then concatenated: word features at
 * [0, wordCount), char features at [wordCount, ...).
 */

import type { ModelArtifact, Vectorizer } from "@/lib/engine/types";

// Equivalent to sklearn's default token_pattern (?u)\b\w\w+\b: maximal runs of
// two or more Unicode word characters.
const WORD_TOKEN = /[\p{L}\p{N}_]{2,}/gu;

function wordGrams(text: string, minN: number, maxN: number): string[] {
  const tokens = text.match(WORD_TOKEN) ?? [];
  const grams: string[] = minN <= 1 ? [...tokens] : [];
  for (let n = Math.max(minN, 2); n <= maxN; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

/** Mirrors sklearn CountVectorizer._char_wb_ngrams: pad each word with spaces,
 *  slide n-grams within the word, and count a too-short word once (then stop). */
function charWbGrams(text: string, minN: number, maxN: number): string[] {
  const grams: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = ` ${word} `;
    const wLen = w.length;
    for (let n = minN; n <= maxN; n += 1) {
      grams.push(w.slice(0, n)); // equals the whole padded word when n >= wLen
      if (n >= wLen) break;
      for (let offset = 1; offset + n <= wLen; offset += 1) grams.push(w.slice(offset, offset + n));
    }
  }
  return grams;
}

function blockVector(vec: Vectorizer, text: string, offset: number, into: Map<number, number>): void {
  const low = vec.lowercase ? text.toLowerCase() : text;
  const [minN, maxN] = vec.ngram_range;
  const grams = vec.analyzer === "word" ? wordGrams(low, minN, maxN) : charWbGrams(low, minN, maxN);

  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);

  // index terms lazily: build once per vectorizer instance is ideal, but the map
  // is rebuilt per call to keep the engine stateless; the corpus is small.
  const indexOf = vec._indexOf ?? (vec._indexOf = buildIndex(vec.terms));

  const raw = new Map<number, number>();
  for (const [gram, count] of counts) {
    const j = indexOf.get(gram);
    if (j === undefined) continue;
    const tf = vec.sublinear_tf ? 1 + Math.log(count) : count;
    raw.set(j, tf * vec.idf[j]!);
  }

  let norm = 0;
  if (vec.norm === "l2") {
    for (const v of raw.values()) norm += v * v;
    norm = Math.sqrt(norm);
  }
  for (const [j, v] of raw) into.set(offset + j, norm > 0 ? v / norm : v);
}

function buildIndex(terms: string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < terms.length; i += 1) index.set(terms[i]!, i);
  return index;
}

/** The concatenated tf-idf sparse vector, keyed by feature index. */
export function vectorize(model: ModelArtifact, text: string): Map<number, number> {
  const vector = new Map<number, number>();
  blockVector(model.word, text, 0, vector);
  blockVector(model.char, text, model.word_feature_count, vector);
  return vector;
}
