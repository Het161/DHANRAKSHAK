/**
 * Port of backend/app/explain/templates.py and rag.py (the template + advisory
 * layer). These strings stand alone: offline, they are exactly what the user reads.
 */

import { BM25Okapi } from "@/lib/engine/bm25";
import type { AdvisoryChunk, EngineUpiFlag, EngineUrlFlag, Templates } from "@/lib/engine/types";
import type { Advisory, Flag, Language, Verdict } from "@/lib/types";

const FALLBACK: Language = "en";
const MAX_EXPLAINED_FLAGS = 4;
const SNIPPET_CHARS = 420;
const TACTIC_MATCH_BONUS = 3.0;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) as string[];
}

interface FlagText {
  why: string;
  do: string;
}

export class Explainer {
  private readonly index: BM25Okapi | null;

  constructor(
    private readonly templates: Templates,
    private readonly chunks: AdvisoryChunk[],
  ) {
    this.index = chunks.length > 0 ? new BM25Okapi(chunks.map((c) => c.tokens)) : null;
  }

  private lookup(lang: Language, path: string[]): string {
    for (const candidate of [lang, FALLBACK]) {
      let node: unknown = this.templates[candidate];
      for (const key of path) {
        if (typeof node !== "object" || node === null) {
          node = null;
          break;
        }
        node = (node as Record<string, unknown>)[key];
      }
      if (typeof node === "string" && node) return node;
    }
    return "";
  }

  private flagText(name: string, lang: Language): FlagText {
    return { why: this.lookup(lang, ["flags", name, "why"]), do: this.lookup(lang, ["flags", name, "do"]) };
  }

  verdictIntro(verdict: Verdict, lang: Language): string {
    return this.lookup(lang, ["verdict_intro", verdict]);
  }

  private noFlags(lang: Language): string {
    return this.lookup(lang, ["no_flags"]);
  }

  actions(verdict: Verdict, lang: Language): string[] {
    for (const candidate of [lang, FALLBACK]) {
      const list = this.templates[candidate]?.actions?.[verdict];
      if (Array.isArray(list) && list.length > 0) return list.map(String);
    }
    return [];
  }

  /** Localize every raw signal into the flat Flag list the UI renders. */
  flagsFor(
    tactics: { name: string; weight: number; evidence_span: [number, number] }[],
    urlFlags: EngineUrlFlag[],
    upiFlags: EngineUpiFlag[],
    lang: Language,
  ): Flag[] {
    const flags: Flag[] = [];
    for (const tactic of tactics) {
      const text = this.flagText(tactic.name, lang);
      flags.push({
        kind: "tactic",
        name: tactic.name,
        detail: text.why,
        action: text.do,
        weight: tactic.weight,
        evidence_span: tactic.evidence_span,
      });
    }
    for (const flag of urlFlags) {
      const text = this.flagText(flag.reason, lang);
      flags.push({ kind: "url", name: flag.reason, detail: text.why || flag.detail, action: text.do, weight: flag.weight, evidence_span: null });
    }
    for (const flag of upiFlags) {
      const text = this.flagText(flag.reason, lang);
      flags.push({ kind: "upi", name: flag.reason, detail: text.why || flag.detail, action: text.do, weight: flag.weight, evidence_span: null });
    }
    flags.sort((a, b) => b.weight - a.weight);
    return flags;
  }

  render(verdict: Verdict, lang: Language, flagNames: string[]): string {
    const parts = [this.verdictIntro(verdict, lang)];
    const reasons = flagNames
      .slice(0, MAX_EXPLAINED_FLAGS)
      .map((name) => this.flagText(name, lang).why)
      .filter(Boolean);
    parts.push(reasons.length > 0 ? reasons.join("\n") : this.noFlags(lang));
    return parts.filter(Boolean).join("\n\n").trim();
  }

  /** Two stages: which advisory applies is settled by front-matter tactics; which
   *  paragraph to quote is a BM25 question. Mirrors AdvisoryRetriever.retrieve_sync. */
  retrieveAdvisory(flagNames: string[], lang: Language): Advisory | null {
    if (this.index === null || this.chunks.length === 0 || flagNames.length === 0) return null;

    const query = tokenize(flagNames.map((name) => name.replace(/_/g, " ")).join(" "));
    const scores = this.index.getScores(query);
    const relevance = new Map<string, number>();
    flagNames.forEach((name, rank) => relevance.set(name, 1 / (1 + rank)));

    const bestRef = this.bestDocument(relevance, lang);
    let bestIndex = -1;
    let bestScore = -Infinity;
    this.chunks.forEach((chunk, index) => {
      if (bestRef !== null && chunk.ref !== bestRef) return;
      const score = scores[index] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex < 0 || (bestRef === null && (scores[bestIndex] ?? 0) <= 0)) return null;
    const chunk = this.chunks[bestIndex]!;
    return { source: chunk.source, ref: chunk.ref, snippet: shorten(chunk.text) };
  }

  private bestDocument(relevance: Map<string, number>, lang: Language): string | null {
    const perDocument = new Map<string, number>();
    for (const chunk of this.chunks) {
      if (perDocument.has(chunk.ref)) continue;
      const score = chunk.tactics.reduce((sum, tactic) => sum + (relevance.get(tactic) ?? 0), 0);
      if (score) {
        perDocument.set(chunk.ref, score * TACTIC_MATCH_BONUS + (chunk.languages.includes(lang) ? 1 : 0));
      }
    }
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [ref, score] of perDocument) {
      if (score > bestScore) {
        bestScore = score;
        best = ref;
      }
    }
    return best;
  }
}

function shorten(text: string): string {
  const collapsed = text.split(/\s+/).filter(Boolean).join(" ");
  if (collapsed.length <= SNIPPET_CHARS) return collapsed;
  const cut = collapsed.slice(0, SNIPPET_CHARS);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (boundary > SNIPPET_CHARS / 2 ? cut.slice(0, boundary + 1) : cut.replace(/\s+$/, "") + "...").trim();
}
