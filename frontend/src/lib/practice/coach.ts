/**
 * Port of backend/app/simulator/coach.py.
 *
 * Rule-based on purpose: offline or online, the same reply must earn the same
 * feedback. Scores a learner's reply against the persona's good/bad regex rules,
 * with a short negation window so "I will not share my OTP" is not scored as
 * sharing it.
 */

import type { EvaluationRulePayload, PersonaPayload } from "@/lib/practice/types";
import type { Coach, Language } from "@/lib/types";

const MAX_DELTA = 40;
const NEGATION_WINDOW = 14;
const NEGATION_RE =
  /(?:\b(?:not|won'?t|wont|never|refuse|refusing|cannot|can'?t|neither|nor)\b|नह\S{0,3}|\bमत\b|નહ\S{0,3}|\bન\b|\bnahi\S*|\bnathi\b|\bmat\b)\W*$/i;

interface CompiledRule {
  weight: number;
  tacticRevealed: string | null;
  tip: Partial<Record<Language, string>>;
  matcher: RegExp | null;
}

function compile(patterns: string[]): RegExp | null {
  if (patterns.length === 0) return null;
  const source = patterns.join("|");
  try {
    return new RegExp(source, "gi");
  } catch {
    return null;
  }
}

function compileRule(rule: EvaluationRulePayload): CompiledRule {
  return {
    weight: rule.weight,
    tacticRevealed: rule.tactic_revealed ?? null,
    tip: rule.tip ?? {},
    matcher: compile(rule.patterns),
  };
}

/** Compiled coach for one persona; build once and reuse across turns. */
export class PersonaCoach {
  private readonly bad: CompiledRule[];
  private readonly good: CompiledRule[];
  private readonly neutralTip: Partial<Record<Language, string>>;

  constructor(persona: PersonaPayload) {
    this.bad = (persona.evaluation?.bad ?? []).map(compileRule);
    this.good = (persona.evaluation?.good ?? []).map(compileRule);
    this.neutralTip = persona.evaluation?.neutral_tip ?? {};
  }

  private spans(rule: CompiledRule, message: string): [number, number][] {
    if (!rule.matcher) return [];
    rule.matcher.lastIndex = 0;
    const spans: [number, number][] = [];
    for (const match of message.matchAll(rule.matcher)) {
      const start = match.index;
      // A good action is never filtered; only a mistake can be negated away.
      if (rule.weight < 0 && isNegated(message, start)) continue;
      spans.push([start, start + match[0].length]);
    }
    return spans;
  }

  evaluate(message: string, lang: Language): Coach {
    const matched: { rule: CompiledRule; len: number }[] = [];
    for (const rule of [...this.bad, ...this.good]) {
      const spans = this.spans(rule, message);
      if (spans.length > 0) matched.push({ rule, len: longest(spans) });
    }

    if (matched.length === 0) {
      return { tactic_revealed: null, tip: pick(this.neutralTip, lang), score_delta: 0 };
    }

    const mistakes = matched.filter((entry) => entry.rule.weight < 0);
    // A mistake is the more useful thing to teach; between equals the longer
    // match wins - it understood more of the sentence.
    const dominant = (
      mistakes.length > 0
        ? mistakes.reduce((best, entry) =>
            entry.rule.weight < best.rule.weight ||
            (entry.rule.weight === best.rule.weight && entry.len > best.len)
              ? entry
              : best,
          )
        : matched.reduce((best, entry) =>
            entry.len > best.len || (entry.len === best.len && entry.rule.weight > best.rule.weight)
              ? entry
              : best,
          )
    ).rule;

    const delta = matched.reduce((sum, entry) => sum + entry.rule.weight, 0);
    return {
      tactic_revealed: dominant.tacticRevealed,
      tip: pick(dominant.tip, lang) || pick(this.neutralTip, lang),
      score_delta: Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta)),
    };
  }
}

function isNegated(message: string, start: number): boolean {
  return NEGATION_RE.test(message.slice(Math.max(0, start - NEGATION_WINDOW), start));
}

function longest(spans: [number, number][]): number {
  return spans.reduce((max, [start, end]) => Math.max(max, end - start), 0);
}

function pick(text: Partial<Record<Language, string>>, lang: Language): string {
  return text[lang] || text.en || "";
}
