/**
 * Strictly sequential player for the caller's voice.
 *
 * The rules that keep the caller coherent and echo-free:
 * - one reused HTMLAudioElement; its src is only ever set when nothing is playing;
 * - a sentence is enqueued only as a fully-fetched Blob, never a live stream, so
 *   playback can never be cut off by a slow response;
 * - play `seq`, and advance ONLY on the element's `ended` event; if `seq + 1` has
 *   not arrived, wait in a buffering state rather than skip ahead;
 * - every sentence carries a `turnId`; starting a new turn or stopping invalidates
 *   all queued audio of the old turn, so a stale turn can never be heard;
 * - object URLs are revoked as soon as a sentence ends, or when a turn is dropped.
 *
 * `turnId` is -1 when no turn is active, an id no caller turn ever uses.
 */

const IDLE_TURN = -1;
/** A failed synthesis is skipped after this pause instead of stalling the call. */
const ERROR_SKIP_MS = 100;

export interface AudioQueueHandlers {
  onSentenceStart?: (turnId: number, seq: number) => void;
  /** Fired when a sentence finishes, including a skipped failed one. */
  onSentencePlayed?: (turnId: number, seq: number) => void;
  /** Any observable change (depth, playing, buffering) for the debug overlay. */
  onStateChange?: () => void;
}

export interface AudioQueueSnapshot {
  turnId: number;
  playingSeq: number | null;
  depth: number;
  playing: boolean;
  buffering: boolean;
}

export class AudioQueue {
  private element: HTMLAudioElement | null = null;
  private handlers: AudioQueueHandlers = {};
  /** seq -> object URL, or null for a failed sentence to be skipped. */
  private buffer = new Map<number, string | null>();
  private liveUrls = new Set<string>();
  private turnId = IDLE_TURN;
  private nextSeq = 0;
  private playingSeq: number | null = null;
  private detachCurrent: (() => void) | null = null;

  attach(element: HTMLAudioElement): void {
    this.element = element;
  }

  setHandlers(handlers: AudioQueueHandlers): void {
    this.handlers = handlers;
  }

  /** Begin a fresh caller turn; nothing from the previous turn may still play. */
  beginTurn(turnId: number, firstSeq = 0): void {
    this.stopPlayback();
    this.dropBuffer();
    this.turnId = turnId;
    this.nextSeq = firstSeq;
    this.emit();
  }

  enqueue(turnId: number, seq: number, blob: Blob): void {
    if (turnId !== this.turnId) return; // stale turn
    const url = URL.createObjectURL(blob);
    this.liveUrls.add(url);
    this.buffer.set(seq, url);
    this.emit();
    this.pump();
  }

  enqueueFailure(turnId: number, seq: number): void {
    if (turnId !== this.turnId) return;
    this.buffer.set(seq, null);
    this.pump();
  }

  /** Interrupt or end: silence immediately and invalidate every queued sentence. */
  stop(): void {
    this.stopPlayback();
    this.dropBuffer();
    this.turnId = IDLE_TURN;
    this.emit();
  }

  snapshot(): AudioQueueSnapshot {
    return {
      turnId: this.turnId,
      playingSeq: this.playingSeq,
      depth: this.buffer.size,
      playing: this.playingSeq !== null,
      buffering:
        this.playingSeq === null && this.buffer.size > 0 && !this.buffer.has(this.nextSeq),
    };
  }

  private pump(): void {
    if (this.playingSeq !== null) return;
    if (!this.buffer.has(this.nextSeq)) {
      this.emit(); // buffering or idle
      return;
    }
    const seq = this.nextSeq;
    const url = this.buffer.get(seq) ?? null;
    this.buffer.delete(seq);
    if (url === null) {
      // Failed synthesis: count it played so turn-completion still resolves.
      this.handlers.onSentencePlayed?.(this.turnId, seq);
      this.nextSeq = seq + 1;
      this.pump();
      return;
    }
    this.play(seq, url);
  }

  private play(seq: number, url: string): void {
    const element = this.element;
    if (!element) return;

    const turnAtStart = this.turnId;
    this.playingSeq = seq;
    element.src = url;

    const finish = (errored: boolean) => {
      this.detachCurrent?.();
      this.detachCurrent = null;
      this.revoke(url);
      this.playingSeq = null;

      if (turnAtStart !== this.turnId) {
        this.emit(); // interrupted mid-sentence: drop silently
        return;
      }
      this.handlers.onSentencePlayed?.(turnAtStart, seq);
      this.nextSeq = seq + 1;
      const advance = () => {
        if (turnAtStart === this.turnId) this.pump();
      };
      if (errored) setTimeout(advance, ERROR_SKIP_MS);
      else advance();
    };

    const onEnded = () => finish(false);
    const onError = () => finish(true);
    element.addEventListener("ended", onEnded, { once: true });
    element.addEventListener("error", onError, { once: true });
    this.detachCurrent = () => {
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
    };

    this.handlers.onSentenceStart?.(turnAtStart, seq);
    this.emit();
    element.play().catch(() => {
      // Autoplay block, or a pause() from an interrupt. Only skip if this is
      // still the sentence we meant to be playing.
      if (turnAtStart === this.turnId && this.playingSeq === seq) finish(true);
    });
  }

  private stopPlayback(): void {
    this.detachCurrent?.();
    this.detachCurrent = null;
    const element = this.element;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.playingSeq = null;
  }

  private dropBuffer(): void {
    for (const url of this.liveUrls) URL.revokeObjectURL(url);
    this.liveUrls.clear();
    this.buffer.clear();
  }

  private revoke(url: string): void {
    if (this.liveUrls.delete(url)) URL.revokeObjectURL(url);
  }

  private emit(): void {
    this.handlers.onStateChange?.();
  }
}
