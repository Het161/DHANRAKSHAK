/**
 * Cheap string similarity to catch residual acoustic echo.
 *
 * The half-duplex state machine keeps recognition off while the caller speaks,
 * so echo should be rare. This is the belt-and-braces check for the 350ms tail
 * after the caller stops: if the "user" transcript is really the caller's own
 * last words bouncing back, discard it. No dependencies, token-overlap only.
 */

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Overlap coefficient: shared tokens over the smaller set. 0..1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

/**
 * The best match against any recent caller sentence, when it clears the
 * threshold, otherwise null. A returned number means "treat as echo".
 */
export function echoMatch(
  candidate: string,
  callerSentences: readonly string[],
  threshold = 0.7,
): number | null {
  let best = 0;
  for (const sentence of callerSentences) {
    best = Math.max(best, similarity(candidate, sentence));
  }
  return best >= threshold ? best : null;
}
