import type {
  AnalyzeRequest,
  ApiErrorBody,
  Gender,
  Language,
  LanguageHint,
  SSEEvent,
  StartRequest,
  StartResponse,
  TurnRequest,
  TurnResponse,
  VoiceEvent,
  VoiceTurnRequest,
} from "@/lib/types";

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

/** A failure the caller may usefully retry (cold start, network blip, 5xx). */
export class TransientApiError extends Error {}

/** A failure retrying cannot fix (validation, payload too large, 404). */
export class PermanentApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error?.message) return body.error.message;
  } catch {
    // A proxy returning HTML during a cold start is expected; fall through.
  }
  return `Request failed (${response.status})`;
}

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  const message = await readErrorMessage(response);
  // 429 is included with the permanent errors on purpose: retrying a rate limit
  // immediately is what caused it.
  if (response.status >= 500 || response.status === 408) {
    throw new TransientApiError(message);
  }
  throw new PermanentApiError(message, response.status);
}

function parseEvent(block: string): SSEEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data) return null;
  try {
    return JSON.parse(data) as SSEEvent;
  } catch {
    return null;
  }
}

/**
 * Consume an SSE body, invoking `onEvent` per event.
 *
 * EventSource is not usable here: it only issues GET requests, and analysis is
 * a POST with a body. Parsing the stream by hand is the cost of that.
 */
async function consumeStream(
  response: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new TransientApiError("The server sent an empty response.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseEvent(block);
        if (event) onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }
    const trailing = parseEvent(buffer);
    if (trailing) onEvent(trailing);
  } finally {
    reader.releaseLock();
  }
}

async function post(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, method: "POST", signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // A sleeping Render instance refuses the connection outright.
    throw new TransientApiError("Could not reach the server.");
  }
  await raiseForStatus(response);
  return response;
}

export async function streamAnalyzeText(
  request: AnalyzeRequest,
  onEvent: (event: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await post(
    "/api/analyze",
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    signal,
  );
  await consumeStream(response, onEvent);
}

export async function streamAnalyzeFile(
  kind: "image" | "audio",
  file: Blob,
  filename: string,
  languageHint: LanguageHint,
  onEvent: (event: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("language_hint", languageHint);
  const response = await post(`/api/analyze/${kind}`, { body: form }, signal);
  await consumeStream(response, onEvent);
}

async function postJson<TBody, TResult>(
  path: string,
  body: TBody,
  signal: AbortSignal,
): Promise<TResult> {
  const response = await post(
    path,
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    signal,
  );
  return (await response.json()) as TResult;
}

export function startSimulator(body: StartRequest, signal: AbortSignal): Promise<StartResponse> {
  return postJson<StartRequest, StartResponse>("/api/simulator/start", body, signal);
}

export function sendSimulatorTurn(body: TurnRequest, signal: AbortSignal): Promise<TurnResponse> {
  return postJson<TurnRequest, TurnResponse>("/api/simulator/turn", body, signal);
}

export function apiBaseUrl(): string {
  return BASE_URL;
}

/** Synthesised speech for one sentence. Null when synthesis is unavailable. */
export async function fetchSpeech(
  text: string,
  lang: Language,
  gender: Gender,
  signal: AbortSignal,
): Promise<Blob | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, gender }),
      signal,
    });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    // The call continues with on-device speech; never surface this.
    return null;
  }
}

/**
 * Transcript only, via the existing analyze pipeline.
 *
 * Used by the push-to-talk fallback on browsers without SpeechRecognition. The
 * verdict is discarded: all this path needs is Groq's transcription of what the
 * user said, which the response already carries as `analyzed_text`.
 */
export async function transcribeSpeech(
  blob: Blob,
  filename: string,
  lang: Language,
  signal: AbortSignal,
): Promise<string> {
  let transcript = "";
  await streamAnalyzeFile(
    "audio",
    blob,
    filename,
    lang,
    (event) => {
      if (event.type === "verdict") transcript = event.payload.analyzed_text;
    },
    signal,
  );
  return transcript.trim();
}

export async function streamVoiceTurn(
  body: VoiceTurnRequest,
  onEvent: (event: VoiceEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await post(
    "/api/simulator/voice-turn",
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    signal,
  );
  await consumeStream(response, (event) => onEvent(event as unknown as VoiceEvent));
}
