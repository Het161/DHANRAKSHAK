/**
 * Offline practice must vary every session and coach correctly - the same
 * guarantees the server gives, now on-device.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PersonaCoach } from "@/lib/practice/coach";
import { buildPlan } from "@/lib/practice/scenario";
import { PracticeEngine } from "@/lib/practice/engine";
import type { PersonasArtifact } from "@/lib/practice/types";
import type { PersonaId } from "@/lib/types";

const artifact = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "public", "engine", "personas.json"),
    "utf-8",
  ),
) as PersonasArtifact;

const GOOD = "No. I will not share my OTP or PIN. I am hanging up and calling my bank myself.";
const BAD = "Okay sir, my OTP is 448120 and my card number is 5123 4567 8901.";

describe("offline practice", () => {
  it("plans the same session for the same seed, different for different seeds", () => {
    const persona = artifact.personas[0]!;
    const a = buildPlan(persona, "en", 12345, 6);
    const b = buildPlan(persona, "en", 12345, 6);
    expect(a.opening).toBe(b.opening);
    expect(a.tacticOrder).toEqual(b.tacticOrder);

    const openings = new Set<string>();
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      const plan = buildPlan(persona, "en", seed * 7919 + 1, 6);
      openings.add(plan.opening);
      orders.add(plan.tacticOrder.join(">"));
      expect(plan.opening).not.toContain("{"); // every slot filled
    }
    expect(openings.size).toBeGreaterThanOrEqual(4);
    expect(orders.size).toBeGreaterThanOrEqual(4);
  });

  it("starts varied sessions and finishes after max turns", () => {
    const engine = PracticeEngine.fromArtifact(artifact);
    const openings = new Set<string>();
    for (let i = 0; i < 6; i += 1) openings.add(engine.start("digital_arrest", "en").opening);
    expect(openings.size).toBeGreaterThanOrEqual(4);

    const { session } = engine.start("digital_arrest", "en");
    let finished = false;
    for (let i = 0; i < artifact.max_turns; i += 1) finished = engine.turn(session, "no").finished;
    expect(finished).toBe(true);
  });

  it.each(artifact.personas.map((p) => p.id))("coaches %s: good reply rewarded, credential leak penalised", (id) => {
    const persona = artifact.personas.find((p) => p.id === (id as PersonaId))!;
    const coach = new PersonaCoach(persona);
    expect(coach.evaluate(GOOD, "en").score_delta).toBeGreaterThan(0);
    expect(coach.evaluate(BAD, "en").score_delta).toBeLessThan(0);
  });
});
