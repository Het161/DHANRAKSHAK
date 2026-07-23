import { PermanentApiError } from "@/lib/api";

/** Render free instances sleep; the first call can take most of a minute. */
export const WAKE_UP_AFTER_MS = 4_000;
export const MAX_ATTEMPTS = 4;
export const RETRY_DELAYS_MS = [2_000, 5_000, 8_000];

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Run a request, retrying only the failures a cold start produces.
 *
 * Used by the plain JSON calls. The analyze hook needs its own loop because a
 * stream that dies after the verdict has arrived must not be retried at all.
 */
export async function retryTransient<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  onRetry: (nextAttempt: number) => void,
): Promise<T> {
  for (let index = 1; index <= MAX_ATTEMPTS; index += 1) {
    try {
      return await attempt(signal);
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
      if (error instanceof PermanentApiError) throw error;
      if (index === MAX_ATTEMPTS) throw error;
      onRetry(index + 1);
      await delay(RETRY_DELAYS_MS[index - 1] ?? 8_000, signal);
    }
  }
  throw new Error("unreachable");
}
