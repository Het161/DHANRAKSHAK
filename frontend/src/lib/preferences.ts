import type { Language } from "@/lib/types";

/**
 * Preferences live in an external store read through useSyncExternalStore.
 *
 * They are the one thing that legitimately differs between the server render and
 * the client: the server cannot know them, and reading them in an effect would
 * mean a setState on every mount. React handles the two snapshots itself.
 *
 * Only UI preferences are stored. Nothing a user submits for analysis is ever
 * written to storage.
 */

const LANGUAGE_KEY = "dr.lang";
const ELDER_KEY = "dr.elder";
const ONBOARDED_KEY = "dr.onboarded";
const PRACTICE_TIP_KEY = "dr.practiceTip";

/**
 * The one-time hint on the Practice tab. `hidden` until the user's first real
 * analysis completes, then `ready` to show, then `seen` once dismissed.
 */
export type PracticeTip = "hidden" | "ready" | "seen";

export interface Preferences {
  lang: Language;
  elder: boolean;
  hasChosenLanguage: boolean;
  practiceTip: PracticeTip;
}

const SERVER_SNAPSHOT: Preferences = {
  lang: "en",
  elder: false,
  hasChosenLanguage: false,
  practiceTip: "hidden",
};

let snapshot: Preferences | null = null;
const listeners = new Set<() => void>();

function isLanguage(value: string | null): value is Language {
  return value === "gu" || value === "hi" || value === "en";
}

function isPracticeTip(value: string | null): value is PracticeTip {
  return value === "hidden" || value === "ready" || value === "seen";
}

function readStorage(): Preferences {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    const tip = window.localStorage.getItem(PRACTICE_TIP_KEY);
    return {
      lang: isLanguage(stored) ? stored : "en",
      elder: window.localStorage.getItem(ELDER_KEY) === "1",
      hasChosenLanguage: isLanguage(stored),
      practiceTip: isPracticeTip(tip) ? tip : "hidden",
    };
  } catch {
    // Private browsing and locked-down devices throw on access rather than
    // returning null; the defaults are a perfectly good answer.
    return SERVER_SNAPSHOT;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be persisted still applies for this session.
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Preferences {
  snapshot ??= readStorage();
  return snapshot;
}

export function getServerSnapshot(): Preferences {
  return SERVER_SNAPSHOT;
}

function commit(next: Preferences): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function setLanguage(lang: Language): void {
  write(LANGUAGE_KEY, lang);
  commit({ ...getSnapshot(), lang, hasChosenLanguage: true });
}

export function setElderMode(elder: boolean): void {
  write(ELDER_KEY, elder ? "1" : "0");
  commit({ ...getSnapshot(), elder });
}

/**
 * Onboarding completion. Not part of the reactive snapshot because the only
 * reader that must never flicker is the pre-paint redirect in the document head,
 * which reads localStorage directly and synchronously.
 */
export function setOnboarded(): void {
  write(ONBOARDED_KEY, "1");
}

export function isOnboarded(): boolean {
  return read(ONBOARDED_KEY) === "1";
}

/** First real analysis finished: arm the Practice tip, but never un-dismiss it. */
export function signalFirstAnalysis(): void {
  if (getSnapshot().practiceTip !== "hidden") return;
  write(PRACTICE_TIP_KEY, "ready");
  commit({ ...getSnapshot(), practiceTip: "ready" });
}

export function dismissPracticeTip(): void {
  if (getSnapshot().practiceTip === "seen") return;
  write(PRACTICE_TIP_KEY, "seen");
  commit({ ...getSnapshot(), practiceTip: "seen" });
}
