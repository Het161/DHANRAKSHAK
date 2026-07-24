/**
 * Client persona types for offline practice, matching backend/data/personas/*.json
 * (minus the server-only system_prompt and voice, which the export drops).
 */

import type { Language, PersonaId } from "@/lib/types";

export type LangList = Partial<Record<Language, string[]>>;
export type LangText = Partial<Record<Language, string>>;

export interface EvaluationRulePayload {
  id: string;
  weight: number;
  patterns: string[];
  tactic_revealed?: string | null;
  tip?: LangText;
}

export interface PersonaPayload {
  id: PersonaId;
  title?: string;
  tactics: string[];
  opening?: LangText;
  closing?: LangText;
  scripted_turns?: LangList;
  openings?: LangList;
  // lines[tactic][lang] -> variants
  lines?: Record<string, LangList>;
  // slots[name] is either a flat list (language-neutral) or a per-language dict
  slots?: Record<string, string[] | LangList>;
  filler?: LangList;
  closings?: LangList;
  evaluation?: {
    good?: EvaluationRulePayload[];
    bad?: EvaluationRulePayload[];
    neutral_tip?: LangText;
  };
}

export interface PersonasArtifact {
  max_turns: number;
  personas: PersonaPayload[];
}
