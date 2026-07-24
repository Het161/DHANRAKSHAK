/**
 * Mirror of backend/app/schemas/contracts.py.
 *
 * These types are the contract, not a convenience: if the backend changes a
 * field, it changes here in the same commit. Field names and optionality match
 * the Pydantic models exactly.
 */

export type InputType = "text" | "url" | "image" | "audio";
export type Language = "gu" | "hi" | "en";
export type LanguageHint = Language | "auto";
export type Verdict = "safe" | "suspicious" | "scam";
// "on-device" is produced only by the offline engine in src/lib/engine; the
// server emits "llm" or "template". The chip shown to the user keys off this.
export type ExplanationSource = "llm" | "template" | "on-device";
export type FlagKind = "tactic" | "url" | "upi";
export type Gender = "male" | "female";

export interface AnalyzeRequest {
  input_type: InputType;
  content: string;
  language_hint: LanguageHint;
}

/** `evidence_span` is a [start, end) character range into `analyzed_text`. */
export interface Flag {
  kind: FlagKind;
  name: string;
  detail: string;
  action: string;
  weight: number;
  evidence_span: [number, number] | null;
}

export interface Advisory {
  source: string;
  ref: string;
  snippet: string;
}

export interface AnalyzeResponse {
  verdict: Verdict;
  risk_score: number;
  flags: Flag[];
  advisory: Advisory | null;
  actions: string[];
  lang: Language;
  /** The exact text the engine scored. Evidence spans index into this string. */
  analyzed_text: string;
  explanation: string;
  explanation_source: ExplanationSource;
}

export interface TokenPayload {
  text: string;
}

export interface DonePayload {
  explanation: string;
  explanation_source: ExplanationSource;
  latency_ms: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type SSEEventType = "verdict" | "token" | "done" | "error";

export type SSEEvent =
  | { type: "verdict"; payload: AnalyzeResponse }
  | { type: "token"; payload: TokenPayload }
  | { type: "done"; payload: DonePayload }
  | { type: "error"; payload: ErrorPayload };

export type PersonaId = "digital_arrest" | "fake_kyc" | "lottery" | "loan_app";

export interface StartRequest {
  persona: PersonaId;
  lang: Language;
}

export interface ScenarioPlanDebug {
  seed: number;
  opening: string;
  tactic_order: string[];
  slots: Record<string, string>;
}

export interface StartResponse {
  session_id: string;
  scammer_text: string;
  persona: PersonaId;
  lang: Language;
  turn: number;
  /** Debug only (?debug=1): the session seed and scenario plan. */
  seed?: number | null;
  plan?: ScenarioPlanDebug | null;
}

export interface TurnRequest {
  session_id: string;
  message: string;
}

export interface Coach {
  tactic_revealed: string | null;
  tip: string;
  score_delta: number;
}

export interface TurnResponse {
  scammer_text: string;
  coach: Coach | null;
  finished: boolean;
  score: number;
  turn: number;
  /** Which path produced this line, for the ?debug=1 overlay. */
  source?: "llm" | "fallback";
}

export interface TTSRequest {
  text: string;
  lang: Language;
  gender: Gender;
}

export interface VoiceTurnRequest {
  session_id: string;
  message: string;
  gender: Gender;
}

export interface SentencePayload {
  text: string;
  seq: number;
  source: "script" | "llm";
}

/** Per-turn voice debug, populated for the ?debug=1 overlay. */
export interface VoiceTurnDebug {
  transcript: string;
  class: string;
  bridge: string;
  path: "llm" | "fallback" | "silence";
  /** Size of the chat array sent to the LLM (system + history + framing). */
  messages_len: number;
  history_len: number;
  reply: string;
}

export interface VoiceDonePayload {
  full_text: string;
  finished: boolean;
  score: number;
  turn: number;
  debug?: VoiceTurnDebug | null;
}

export type VoiceEvent =
  | { type: "sentence"; payload: SentencePayload }
  | { type: "coach"; payload: Coach }
  | { type: "tts_unavailable"; payload: Record<string, never> }
  | { type: "done"; payload: VoiceDonePayload }
  | { type: "error"; payload: ErrorPayload };

export interface TTSHealth {
  provider: string;
  available: boolean;
  voices_discovered: boolean;
  voices: Record<string, string>;
  cache_entries: number;
  cache_bytes: number;
}

export interface ProviderHealth {
  provider: string;
  model: string | null;
  configured: boolean;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  mode: "local" | "hosted";
  uptime_s: number;
  llm: ProviderHealth;
  stt: ProviderHealth;
  classifier: { loaded: boolean; path: string };
  ocr: { available: boolean; langs: string[] };
  advisories: { documents: number; chunks: number };
  lexicons_loaded: number;
  templates_loaded: number;
  tts: TTSHealth;
}

/** Shape of every non-2xx body from the API. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
