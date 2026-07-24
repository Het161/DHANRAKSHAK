/**
 * Port of backend/app/detection/lexicon.py and rules.py.
 *
 * Term lists become word-boundaried regexes exactly as the server compiles them;
 * raw `patterns` are used verbatim. Every language's terms match every input,
 * because real scam SMS mix scripts in one message.
 */

import type { LexiconGroup, LexiconPayload } from "@/lib/engine/types";

export interface RuleHit {
  name: string;
  evidence_span: [number, number];
  weight: number;
}

const TERM_KEYS = ["en", "hi", "gu", "translit"] as const;
const ASCII_ONLY = /^[\x00-\x7f]+$/;

// Python's re uses (?u), so \w in the boundary assertions matches Unicode word
// characters. JS \w is ASCII even under the u flag, so \p{L}\p{N}_ stands in for
// it - the faithful equivalent for the Indic terms these boundaries wrap.
const WB = "[\\p{L}\\p{N}_]";

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termToPattern(term: string): string {
  const words = term.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error("empty term");
  const body = words.map(escapeRegExp).join("\\s+");
  // ASCII terms tolerate common English inflections; Indic terms anchor at the
  // start only, since those scripts take agglutinative suffixes.
  return ASCII_ONLY.test(term)
    ? `(?<!${WB})${body}(?:s|es|ed|ing)?(?!${WB})`
    : `(?<!${WB})${body}`;
}

function collectPatterns(payload: { patterns?: string[] } & Partial<Record<(typeof TERM_KEYS)[number], string[]>>): string[] {
  const patterns: string[] = [];
  for (const key of TERM_KEYS) {
    for (const term of payload[key] ?? []) patterns.push(termToPattern(term));
  }
  for (const raw of payload.patterns ?? []) patterns.push(raw);
  return patterns;
}

/** Compile an alternation, with the same u-flag semantics the server's re.UNICODE gives. */
function compileAlternation(patterns: string[]): RegExp | null {
  if (patterns.length === 0) return null;
  const source = patterns.join("|");
  try {
    return new RegExp(source, "giu");
  } catch {
    // A hand-written pattern that the u flag rejects falls back to ASCII \w
    // boundaries; only that one tactic loses Unicode-boundary precision.
    try {
      return new RegExp(source, "gi");
    } catch {
      return null;
    }
  }
}

interface CompiledGroup {
  matcher: RegExp;
}

interface CompiledTactic {
  name: string;
  weight: number;
  matcher: RegExp | null;
  veto: RegExp | null;
  groups: CompiledGroup[];
  minGroups: number;
}

function compileTactic(payload: LexiconPayload): CompiledTactic | null {
  const name = payload.tactic;
  const weight = Number(payload.weight);
  if (!(weight > 0 && weight <= 1)) return null;
  const veto = compileAlternation(payload.veto_patterns ?? []);

  if (payload.type === "composite") {
    const groups = (payload.groups ?? [])
      .map((group: LexiconGroup) => {
        const matcher = compileAlternation(collectPatterns(group));
        return matcher ? { matcher } : null;
      })
      .filter((g): g is CompiledGroup => g !== null);
    const minGroups = payload.min_groups ?? 2;
    if (minGroups > groups.length) return null;
    return { name, weight, matcher: null, veto, groups, minGroups };
  }

  const matcher = compileAlternation(collectPatterns(payload));
  if (matcher === null) return null;
  return { name, weight, matcher, veto, groups: [], minGroups: 1 };
}

function longestSpan(matcher: RegExp, text: string): [number, number] | null {
  let best: [number, number] | null = null;
  matcher.lastIndex = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;
    if (best === null || end - start > best[1] - best[0]) best = [start, end];
  }
  return best;
}

function compositeSpan(tactic: CompiledTactic, text: string): [number, number] | null {
  const spans = tactic.groups
    .map((group) => longestSpan(group.matcher, text))
    .filter((s): s is [number, number] => s !== null);
  if (spans.length < tactic.minGroups) return null;
  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
}

export class RuleEngine {
  private constructor(private readonly tactics: CompiledTactic[]) {}

  static fromLexicons(lexicons: LexiconPayload[]): RuleEngine {
    const compiled = lexicons
      .map((payload) => {
        try {
          return compileTactic(payload);
        } catch {
          return null;
        }
      })
      .filter((t): t is CompiledTactic => t !== null);
    return new RuleEngine(compiled);
  }

  detect(text: string): RuleHit[] {
    const hits: RuleHit[] = [];
    for (const tactic of this.tactics) {
      if (tactic.veto) {
        // .test() on a /g/ regex is stateful; reset before every use.
        tactic.veto.lastIndex = 0;
        if (tactic.veto.test(text)) continue;
      }
      const span = tactic.matcher
        ? longestSpan(tactic.matcher, text)
        : compositeSpan(tactic, text);
      if (span) hits.push({ name: tactic.name, evidence_span: span, weight: tactic.weight });
    }
    hits.sort((a, b) => b.weight - a.weight);
    return hits;
  }
}
