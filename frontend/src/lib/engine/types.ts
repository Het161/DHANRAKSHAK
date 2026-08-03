/**
 * Shapes of the exported engine artifacts (frontend/public/engine/*.json) and
 * the on-device engine's output.
 *
 * These are the faithful client counterpart of backend/app/detection. Every
 * artifact is emitted by backend/scripts/export_client_model.py from the SAME
 * data files the server loads, so the engine here is a port, not a re-implementation.
 */

import type { AnalyzeResponse, Language } from "@/lib/types";

// --- rules ---------------------------------------------------------------

/** Per-language term lists, nested under `terms` exactly as the server's JSON is. */
export interface TermSet {
  en?: string[];
  hi?: string[];
  gu?: string[];
  translit?: string[];
}

export interface LexiconGroup {
  name: string;
  terms?: TermSet;
  patterns?: string[];
}

export interface LexiconPayload {
  tactic: string;
  weight: number;
  type?: "composite" | string;
  terms?: TermSet;
  patterns?: string[];
  veto_patterns?: string[];
  groups?: LexiconGroup[];
  min_groups?: number;
}

/** Raw URL flag before localization (mirror of backend UrlFlag). */
export interface EngineUrlFlag {
  url: string;
  reason: string;
  detail: string;
  weight: number;
}

/** Raw UPI flag before localization (mirror of backend UpiFlag). */
export interface EngineUpiFlag {
  reason: string;
  detail: string;
  weight: number;
  vpa: string | null;
  amount: string | null;
}

// --- URL / UPI config ----------------------------------------------------

export interface UrlConfig {
  official_domains?: string[];
  brand_tokens?: string[];
  suspicious_tlds?: string[];
  url_shorteners?: string[];
}

export interface UpiGroup {
  en?: string[];
  hi?: string[];
  gu?: string[];
  translit?: string[];
  patterns?: string[];
}

export interface UpiConfig {
  receive_claims?: UpiGroup;
  pin_instructions?: UpiGroup;
  collect_instructions?: UpiGroup;
  known_handles?: string[];
}

// --- templates / advisories ---------------------------------------------

export interface TemplatePayload {
  verdict_intro?: Record<string, string>;
  no_flags?: string;
  flags?: Record<string, { why?: string; do?: string }>;
  actions?: Record<string, string[]>;
}

export type Templates = Record<Language, TemplatePayload>;

export interface AdvisoryChunk {
  source: string;
  ref: string;
  title: string;
  text: string;
  tactics: string[];
  languages: string[];
  tokens: string[];
}

// --- model ---------------------------------------------------------------

/** A leaf is its float value; an internal node is [feature, threshold, left, right]. */
export type TreeNode = number | [number, number, TreeNode, TreeNode];

export interface Vectorizer {
  analyzer: "word" | "char_wb";
  ngram_range: [number, number];
  sublinear_tf: boolean;
  lowercase: boolean;
  norm: "l2" | null;
  terms: string[]; // position === feature index
  idf: number[];
  /** Lazily-built term -> index map, cached on the artifact after first use. */
  _indexOf?: Map<string, number>;
}

export interface ModelArtifact {
  word: Vectorizer;
  char: Vectorizer;
  word_feature_count: number;
  trees: TreeNode[];
  bias: number;
  in_distribution: { min_chars: number; min_latin_share: number };
}

export interface Thresholds {
  risk_suspicious_threshold: number;
  risk_scam_threshold: number;
  classifier_weight: number;
  classifier_min_prob: number;
}

export interface EngineArtifacts {
  version: string;
  lexicons: LexiconPayload[];
  urlConfig: UrlConfig;
  upiConfig: UpiConfig;
  templates: Templates;
  advisories: AdvisoryChunk[];
  model: ModelArtifact;
  thresholds: Thresholds;
}

// --- engine output -------------------------------------------------------

/** Same shape the server returns, always tagged on-device so the UI can label it. */
export interface LocalVerdict extends AnalyzeResponse {
  explanation_source: "on-device";
  /** P(scam) from the classifier when it spoke, else null. Debug only. */
  classifier_score: number | null;
}
