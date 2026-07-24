/**
 * Port of backend/app/simulator/scenario.py build_plan.
 *
 * Builds one session's randomized run from a seed: shuffled tactic order, a
 * random opening avoiding recent ones, slot values filled from pools, and a
 * per-turn line that never repeats the previous variant. Same structure as the
 * server, so an offline session feels the same as an online one.
 */

import { choice, mulberry32, pickAvoiding, shuffle, type Rng } from "@/lib/practice/rng";
import type { LangList, PersonaPayload } from "@/lib/practice/types";
import type { Language } from "@/lib/types";

const SLOT_RE = /\{(\w+)\}/g;
const FILLER_CHANCE = 0.35;

export interface ScenarioPlan {
  seed: number;
  lang: Language;
  opening: string;
  closing: string;
  tacticOrder: string[];
  turnLines: string[];
  slots: Record<string, string>;
}

function fill(text: string, slots: Record<string, string>): string {
  return text.replace(SLOT_RE, (whole, name: string) => slots[name] ?? whole);
}

function forLang(pool: LangList | undefined, lang: Language): string[] {
  return pool?.[lang] ?? pool?.en ?? [];
}

function chooseSlots(persona: PersonaPayload, lang: Language, rng: Rng): Record<string, string> {
  const chosen: Record<string, string> = {};
  for (const [name, pool] of Object.entries(persona.slots ?? {})) {
    const list = Array.isArray(pool) ? pool : (pool[lang] ?? pool.en ?? []);
    if (list.length > 0) chosen[name] = choice(rng, list);
  }
  return chosen;
}

/** A shuffled tactic order, re-shuffled each pass to cover every turn. */
function shuffledTactics(persona: PersonaPayload, rng: Rng, length: number): string[] {
  const tactics = persona.tactics;
  if (tactics.length === 0) return [];
  const order: string[] = [];
  while (order.length < length) order.push(...shuffle(rng, tactics));
  return order.slice(0, length);
}

export function buildPlan(
  persona: PersonaPayload,
  lang: Language,
  seed: number,
  turns: number,
  avoidOpenings: ReadonlySet<string> = new Set(),
): ScenarioPlan {
  const rng = mulberry32(seed);
  const slots = chooseSlots(persona, lang, rng);

  const openingPool = forLang(persona.openings, lang);
  let opening: string;
  if (openingPool.length > 0) {
    const fresh = openingPool.filter((text) => !avoidOpenings.has(fill(text, slots)));
    opening = fill(choice(rng, fresh.length > 0 ? fresh : openingPool), slots);
  } else {
    opening = persona.opening?.[lang] ?? persona.opening?.en ?? "";
  }

  const total = Math.max(turns, 1);
  const tacticOrder = shuffledTactics(persona, rng, total);
  const filler = forLang(persona.filler, lang);

  const turnLines: string[] = [];
  const lastIndex: Record<string, number> = {};
  for (let turn = 0; turn < total; turn += 1) {
    const tactic = tacticOrder.length > 0 ? tacticOrder[turn % tacticOrder.length]! : "";
    const variants = forLang(persona.lines?.[tactic], lang);
    if (variants.length === 0) continue;
    const index = pickAvoiding(rng, variants.length, lastIndex[tactic] ?? -1);
    lastIndex[tactic] = index;
    let line = fill(variants[index]!, slots);
    if (filler.length > 0 && rng() < FILLER_CHANCE) line = `${line} ${fill(choice(rng, filler), slots)}`;
    turnLines.push(line);
  }

  const closingPool = forLang(persona.closings, lang);
  const closing =
    closingPool.length > 0 ? fill(choice(rng, closingPool), slots) : (persona.closing?.[lang] ?? persona.closing?.en ?? "");

  // Legacy fixed script only when a persona ships no line pools.
  const lines = turnLines.length > 0 ? turnLines : forLang(persona.scripted_turns, lang);

  return { seed, lang, opening, closing, tacticOrder, turnLines: lines, slots };
}

export function scriptedLine(plan: ScenarioPlan, turnIndex: number): string {
  if (plan.turnLines.length === 0) return plan.closing;
  return plan.turnLines[Math.min(turnIndex, plan.turnLines.length - 1)]!;
}
