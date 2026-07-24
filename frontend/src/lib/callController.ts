import { fetchSpeech, startSimulator, streamVoiceTurn } from "@/lib/api";
import { AudioQueue, type AudioQueueSnapshot } from "@/lib/audioQueue";
import { echoMatch } from "@/lib/echo";
import {
  RECOGNITION_LOCALE,
  createRecognition,
  speechRecognitionSupported,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from "@/lib/speech";
import type { Coach, Gender, Language, PersonaId, ScenarioPlanDebug, VoiceTurnDebug } from "@/lib/types";

/**
 * A phone call is half duplex: exactly one side holds the microphone at a time.
 *   caller_speaking  recognition HARD OFF, every sentence plays to completion
 *   user_turn        recognition ON, waiting for the user's final result
 *   processing       recognition OFF, the turn request is in flight
 * Recognition is never live while the caller's audio plays, which is what stops
 * the caller's own voice from being transcribed as the user's reply.
 */
export type CallPhase =
  | "idle"
  | "connecting"
  | "caller_speaking"
  | "user_turn"
  | "processing"
  | "ended"
  | "error";

// Speaker tail and room echo linger briefly after the last sentence ends.
const GUARD_MS = 350;
const CALLER_HISTORY = 4;
const MAX_TIMINGS = 8;
// If the mic hears nothing for this long on the user's turn, the caller prods
// them (a silence turn) rather than waiting forever.
const SILENCE_MS = 8_000;
// A final result shorter than this is noise, not an answer; treat it as silence.
const MIN_TRANSCRIPT_CHARS = 2;

export interface Caption {
  seq: number;
  text: string;
  source: "script" | "llm" | "user";
}

export interface SentenceTiming {
  turnId: number;
  seq: number;
  fetchMs: number | null;
  toPlayMs: number | null;
  playMs: number | null;
}

export interface VoiceCallState {
  phase: CallPhase;
  captions: Caption[];
  coach: Coach | null;
  coachHistory: Coach[];
  score: number;
  turn: number;
  finished: boolean;
  muted: boolean;
  seconds: number;
  errorMessage: string | null;
  micDenied: boolean;
  usesLocalSpeech: boolean;
  pushToTalk: boolean;
  userSpeaking: boolean;
  recognitionOn: boolean;
  discardedEcho: string | null;
  audio: AudioQueueSnapshot;
  timings: SentenceTiming[];
  plan: ScenarioPlanDebug | null;
  turnDebug: VoiceTurnDebug | null;
}

export interface CallOptions {
  persona: PersonaId;
  lang: Language;
  gender: Gender;
}

const IDLE_AUDIO: AudioQueueSnapshot = {
  turnId: -1,
  playingSeq: null,
  depth: 0,
  playing: false,
  buffering: false,
};

export const INITIAL_STATE: VoiceCallState = {
  phase: "idle",
  captions: [],
  coach: null,
  coachHistory: [],
  score: 0,
  turn: 0,
  finished: false,
  muted: false,
  seconds: 0,
  errorMessage: null,
  micDenied: false,
  usesLocalSpeech: false,
  pushToTalk: false,
  userSpeaking: false,
  recognitionOn: false,
  discardedEcho: null,
  audio: IDLE_AUDIO,
  timings: [],
  plan: null,
  turnDebug: null,
};

type Emit = (updater: (prev: VoiceCallState) => VoiceCallState) => void;

interface Timing {
  fetchStart: number;
  fetchEnd?: number;
  playStart?: number;
}

/**
 * The call's state machine, owning all mutable state as instance fields so the
 * React hook stays a thin adapter. Methods are arrow fields, so their identity
 * is stable and they can be handed straight to the UI.
 */
export class CallController {
  private readonly queue = new AudioQueue();
  private audioEl: HTMLAudioElement | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private turnRequest: AbortController | null = null;
  private startRequest: AbortController | null = null;
  private sessionId: string | null = null;
  private options: CallOptions | null = null;

  private active = false;
  private muted = false;
  private listening = false;
  private localSpeech = false;

  private turnCounter = 0;
  private currentTurn = -1;
  private turnDone = false;
  private turnLastSeq: number | null = null;
  private lastPlayedSeq = -1;
  private finished = false;

  private guardTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private secondsTimer: ReturnType<typeof setInterval> | null = null;
  private callerHistory: string[] = [];
  private readonly timings = new Map<string, Timing>();

  constructor(private readonly emit: Emit) {
    this.queue.setHandlers({
      onSentenceStart: this.onCallerStart,
      onSentencePlayed: this.onCallerPlayed,
      onStateChange: this.syncAudio,
    });
  }

  // --- lifecycle -----------------------------------------------------------

  start = async (options: CallOptions): Promise<void> => {
    this.options = options;
    this.active = true;
    this.finished = false;
    this.localSpeech = false;
    this.muted = false;
    this.callerHistory = [];
    this.turnCounter = 0;
    this.emit(() => ({ ...INITIAL_STATE, phase: "connecting", pushToTalk: !speechRecognitionSupported() }));

    // Unlock playback inside the start gesture, or the opening line is silent on
    // mobile Safari and Chrome.
    const element = this.audioEl;
    if (element) {
      element.muted = true;
      void element.play().catch(() => undefined);
      element.pause();
      element.muted = false;
    }

    const request = new AbortController();
    this.startRequest = request;

    let opening: string;
    try {
      const started = await startSimulator(
        { persona: options.persona, lang: options.lang },
        request.signal,
      );
      this.sessionId = started.session_id;
      opening = started.scammer_text;
      this.emit((prev) => ({ ...prev, plan: started.plan ?? null }));
    } catch {
      if (!request.signal.aborted) this.setPhase("error");
      return;
    }
    if (request.signal.aborted) return;

    this.setPhase("processing");
    this.secondsTimer = setInterval(
      () => this.emit((prev) => ({ ...prev, seconds: prev.seconds + 1 })),
      1000,
    );

    const turnId = (this.turnCounter += 1);
    this.beginCallerTurn(turnId);
    // The opening is a single scripted sentence: complete immediately, seq 0.
    this.turnDone = true;
    this.turnLastSeq = 0;
    this.recordCaller(opening, 0, "script");
    this.speakSentence(turnId, 0, opening);
  };

  end = (): void => {
    this.teardown();
    this.setPhase("ended");
  };

  reset = (): void => {
    this.teardown();
    this.sessionId = null;
    this.currentTurn = -1;
    this.emit(() => INITIAL_STATE);
  };

  teardown = (): void => {
    this.active = false;
    this.clearGuard();
    this.clearSilence();
    if (this.secondsTimer !== null) {
      clearInterval(this.secondsTimer);
      this.secondsTimer = null;
    }
    this.startRequest?.abort();
    this.turnRequest?.abort();
    this.stopListening();
    this.queue.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  attachAudio = (element: HTMLAudioElement | null): void => {
    this.audioEl = element;
    if (element) this.queue.attach(element);
  };

  toggleMute = (): void => {
    this.muted = !this.muted;
    this.emit((prev) => ({ ...prev, muted: this.muted, userSpeaking: this.muted ? false : prev.userSpeaking }));
  };

  submitSpoken = (transcript: string): void => {
    // Push-to-talk is a deliberate gesture with the mic; no echo filtering.
    this.runTurn(transcript);
  };

  /** Explicit user interrupt during caller speech. Audio stops before the mic opens. */
  interrupt = (): void => {
    this.clearGuard();
    this.turnRequest?.abort();
    this.currentTurn = -1; // invalidate: late sentences and fetches are ignored
    this.turnDone = false;
    this.queue.stop();
    if (this.localSpeech && typeof window !== "undefined") window.speechSynthesis.cancel();
    this.syncAudio();
    this.enterUserTurn();
  };

  // --- caller turn ---------------------------------------------------------

  private beginCallerTurn(turnId: number): void {
    this.currentTurn = turnId;
    this.turnDone = false;
    this.turnLastSeq = null;
    this.lastPlayedSeq = -1;
    if (!this.localSpeech) this.queue.beginTurn(turnId, 0);
    else if (typeof window !== "undefined") window.speechSynthesis.cancel();
  }

  private runTurn = (transcript: string): void => {
    const options = this.options;
    if (!options || !this.sessionId) return;

    this.stopListening();
    this.clearGuard();
    this.setPhase("processing");
    this.emit((prev) => ({
      ...prev,
      userSpeaking: false,
      // A silence turn (empty transcript) leaves no user caption.
      captions: transcript
        ? [...prev.captions, { seq: -1, text: transcript, source: "user" }]
        : prev.captions,
    }));

    const turnId = (this.turnCounter += 1);
    this.beginCallerTurn(turnId);

    let seq = 0;
    const request = new AbortController();
    this.turnRequest = request;

    void streamVoiceTurn(
      { session_id: this.sessionId, message: transcript, gender: options.gender },
      (event) => {
        if (turnId !== this.currentTurn) return;
        switch (event.type) {
          case "sentence":
            this.recordCaller(event.payload.text, event.payload.seq, event.payload.source);
            this.speakSentence(turnId, event.payload.seq, event.payload.text);
            seq = event.payload.seq;
            break;
          case "coach":
            this.emit((prev) => ({
              ...prev,
              coach: event.payload,
              coachHistory: [...prev.coachHistory, event.payload],
            }));
            break;
          case "tts_unavailable":
            this.localSpeech = true;
            this.emit((prev) => ({ ...prev, usesLocalSpeech: true }));
            break;
          case "done":
            this.finished = event.payload.finished;
            this.turnLastSeq = seq;
            this.turnDone = true;
            this.emit((prev) => ({
              ...prev,
              score: event.payload.score,
              turn: event.payload.turn,
              finished: event.payload.finished,
              turnDebug: event.payload.debug ?? prev.turnDebug,
            }));
            // Audio may already be drained (all sentences played before done
            // arrived); resolve completion here too.
            if (this.lastPlayedSeq >= seq) this.completeCallerTurn();
            break;
          case "error":
            this.emit((prev) => ({ ...prev, errorMessage: event.payload.message }));
            break;
        }
      },
      request.signal,
    ).catch(() => {
      if (turnId === this.currentTurn) this.scheduleUserTurn();
    });
  };

  private speakSentence(turnId: number, seq: number, text: string): void {
    const options = this.options;
    if (!options) return;

    if (this.localSpeech && typeof window !== "undefined") {
      const utterance = new SpeechSynthesisUtterance(text);
      const locale = RECOGNITION_LOCALE[options.lang];
      const voice = window.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.lang === locale || candidate.lang.startsWith(`${options.lang}-`));
      if (voice) utterance.voice = voice;
      utterance.lang = locale;
      utterance.onstart = () => this.onCallerStart(turnId, seq);
      utterance.onend = () => this.onCallerPlayed(turnId, seq);
      utterance.onerror = () => this.onCallerPlayed(turnId, seq);
      window.speechSynthesis.speak(utterance);
      return;
    }

    const key = `${turnId}:${seq}`;
    this.timings.set(key, { fetchStart: performance.now() });
    const request = new AbortController();
    void fetchSpeech(text, options.lang, options.gender, request.signal).then((blob) => {
      if (turnId !== this.currentTurn) return; // stale turn
      const timing = this.timings.get(key);
      if (timing) timing.fetchEnd = performance.now();
      if (blob) this.queue.enqueue(turnId, seq, blob);
      else this.queue.enqueueFailure(turnId, seq);
    });
  }

  private onCallerStart = (turnId: number, seq: number): void => {
    if (turnId !== this.currentTurn) return;
    const timing = this.timings.get(`${turnId}:${seq}`);
    if (timing) timing.playStart = performance.now();
    this.setPhase("caller_speaking");
    this.syncAudio();
  };

  private onCallerPlayed = (turnId: number, seq: number): void => {
    if (turnId !== this.currentTurn) return;
    this.lastPlayedSeq = seq;
    this.finalizeTiming(turnId, seq, performance.now());
    this.syncAudio();
    if (this.turnDone && this.turnLastSeq !== null && seq >= this.turnLastSeq) {
      this.completeCallerTurn();
    }
  };

  private completeCallerTurn(): void {
    if (this.finished) this.stopListening();
    else this.scheduleUserTurn();
  }

  private recordCaller(text: string, seq: number, source: "script" | "llm"): void {
    this.callerHistory = [...this.callerHistory, text].slice(-CALLER_HISTORY);
    this.emit((prev) => ({ ...prev, captions: [...prev.captions, { seq, text, source }] }));
  }

  // --- user turn -----------------------------------------------------------

  private scheduleUserTurn(): void {
    this.clearGuard();
    this.guardTimer = setTimeout(() => {
      this.guardTimer = null;
      this.enterUserTurn();
    }, GUARD_MS);
  }

  private enterUserTurn(): void {
    if (!this.active || this.finished) return;
    this.setPhase("user_turn");
    if (speechRecognitionSupported()) this.startListening();
    else this.emit((prev) => ({ ...prev, pushToTalk: true }));
  }

  private startListening(): void {
    const options = this.options;
    if (!options) return;
    const recognition = createRecognition(options.lang);
    if (!recognition) {
      this.emit((prev) => ({ ...prev, pushToTalk: true }));
      return;
    }
    this.recognition = recognition;
    this.listening = true;

    recognition.onspeechstart = () => {
      this.clearSilence(); // they are talking; the silence prod is no longer due
      if (!this.muted) this.emit((prev) => ({ ...prev, userSpeaking: true }));
    };
    recognition.onspeechend = () => this.emit((prev) => ({ ...prev, userSpeaking: false }));

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (this.muted) return;
      this.clearSilence(); // any recognition activity cancels the silence prod
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const transcript = result[0].transcript.trim();
        if (!transcript) continue;
        const echo = echoMatch(transcript, this.callerHistory.slice(-2));
        if (echo !== null) {
          this.emit((prev) => ({ ...prev, discardedEcho: `${transcript} (${echo.toFixed(2)})` }));
          continue;
        }
        // Too short to be a real answer: react to it as silence, never advance
        // the script as if they had answered.
        this.runTurn(transcript.length < MIN_TRANSCRIPT_CHARS ? "" : transcript);
        return;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.stopListening();
        this.emit((prev) => ({ ...prev, micDenied: true, pushToTalk: true }));
      }
    };

    // Chrome ends recognition on its own timer; while it is still the user's
    // turn, restart so the call keeps listening.
    recognition.onend = () => {
      if (!this.listening) return;
      try {
        recognition.start();
      } catch {
        // A start is already in flight; the next onend will retry.
      }
    };

    try {
      recognition.start();
      this.armSilence();
      this.emit((prev) => ({ ...prev, recognitionOn: true, discardedEcho: null }));
    } catch {
      this.emit((prev) => ({ ...prev, pushToTalk: true }));
    }
  }

  private stopListening(): void {
    this.listening = false;
    this.clearSilence();
    const recognition = this.recognition;
    if (recognition) {
      // Null every handler before aborting: a stray result must not land.
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.abort();
    }
    this.recognition = null;
    this.emit((prev) => ({ ...prev, recognitionOn: false, userSpeaking: false }));
  }

  // --- helpers -------------------------------------------------------------

  private setPhase(phase: CallPhase): void {
    this.emit((prev) => ({ ...prev, phase }));
  }

  private syncAudio = (): void => {
    this.emit((prev) => ({ ...prev, audio: this.queue.snapshot() }));
  };

  private clearGuard(): void {
    if (this.guardTimer !== null) {
      clearTimeout(this.guardTimer);
      this.guardTimer = null;
    }
  }

  private clearSilence(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // Waiting on the user's turn: if nothing is heard, send a silence turn so the
  // caller prods in character instead of the call stalling.
  private armSilence(): void {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.active && !this.muted && this.listening) this.runTurn("");
    }, SILENCE_MS);
  }

  private finalizeTiming(turnId: number, seq: number, ended: number): void {
    const key = `${turnId}:${seq}`;
    const timing = this.timings.get(key);
    if (!timing) return;
    this.timings.delete(key);
    const entry: SentenceTiming = {
      turnId,
      seq,
      fetchMs: timing.fetchEnd != null ? Math.round(timing.fetchEnd - timing.fetchStart) : null,
      toPlayMs:
        timing.playStart != null && timing.fetchEnd != null
          ? Math.round(timing.playStart - timing.fetchEnd)
          : null,
      playMs: timing.playStart != null ? Math.round(ended - timing.playStart) : null,
    };
    this.emit((prev) => ({ ...prev, timings: [...prev.timings, entry].slice(-MAX_TIMINGS) }));
  }
}
