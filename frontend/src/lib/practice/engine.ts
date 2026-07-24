/**
 * Offline practice session engine.
 *
 * Assembles a scammer's turns from the persona's variant pools (seeded per
 * session, so every run differs) and scores the learner's replies with the same
 * rule-based coach the server uses. No network, no LLM - the fallback rung of the
 * simulator, available whenever the phone is offline.
 */

import { PersonaCoach } from "@/lib/practice/coach";
import { buildPlan, scriptedLine, type ScenarioPlan } from "@/lib/practice/scenario";
import { randomSeed } from "@/lib/practice/rng";
import type { PersonaPayload, PersonasArtifact } from "@/lib/practice/types";
import type { Coach, Language, PersonaId } from "@/lib/types";

export interface PracticeSession {
  personaId: PersonaId;
  lang: Language;
  plan: ScenarioPlan;
  turn: number;
  score: number;
}

export interface PracticeTurn {
  scammerText: string;
  coach: Coach;
  finished: boolean;
  score: number;
  turn: number;
}

export class PracticeEngine {
  private readonly coaches = new Map<string, PersonaCoach>();

  private constructor(
    private readonly personas: Map<string, PersonaPayload>,
    private readonly maxTurns: number,
  ) {}

  static fromArtifact(artifact: PersonasArtifact): PracticeEngine {
    const map = new Map(artifact.personas.map((p) => [p.id, p]));
    return new PracticeEngine(map, artifact.max_turns);
  }

  private coachFor(persona: PersonaPayload): PersonaCoach {
    let coach = this.coaches.get(persona.id);
    if (!coach) {
      coach = new PersonaCoach(persona);
      this.coaches.set(persona.id, coach);
    }
    return coach;
  }

  start(personaId: PersonaId, lang: Language): { session: PracticeSession; opening: string } {
    const persona = this.personas.get(personaId);
    if (!persona) throw new Error(`unknown persona ${personaId}`);
    const seed = randomSeed();
    const plan = buildPlan(persona, lang, seed, this.maxTurns);
    return { session: { personaId, lang, plan, turn: 0, score: 0 }, opening: plan.opening };
  }

  turn(session: PracticeSession, message: string): PracticeTurn {
    const persona = this.personas.get(session.personaId)!;
    const coach = this.coachFor(persona).evaluate(message, session.lang);
    session.score = Math.max(0, session.score + coach.score_delta);
    session.turn += 1;

    const finished = session.turn >= this.maxTurns;
    const scammerText = finished ? session.plan.closing : scriptedLine(session.plan, session.turn - 1);
    return { scammerText, coach, finished, score: session.score, turn: session.turn };
  }
}

let enginePromise: Promise<PracticeEngine> | null = null;

/** Load the persona artifact (precached offline) and build the engine once. */
export function loadPracticeEngine(): Promise<PracticeEngine> {
  if (enginePromise === null) {
    enginePromise = fetch("/engine/personas.json", { cache: "force-cache" })
      .then((r) => r.json() as Promise<PersonasArtifact>)
      .then((artifact) => PracticeEngine.fromArtifact(artifact));
  }
  return enginePromise;
}
