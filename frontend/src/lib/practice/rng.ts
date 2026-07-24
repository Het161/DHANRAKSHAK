/**
 * A small seeded RNG for offline practice variety.
 *
 * The server plans a session from a server-side seed with Python's Mersenne
 * Twister; offline we cannot reproduce that stream, and we do not need to - the
 * requirement is only that each session differs. mulberry32 gives a well-mixed,
 * deterministic-per-seed sequence, and the seed comes from crypto.getRandomValues,
 * so two offline sessions (or the same phone twice) never plan the same run.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  // Only reached in the most stripped-down webview; still varies per call.
  return Math.floor((performance.now() * 1000) % 0xffffffff);
}

export function choice<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A random index that is never the same as the previous one (unless there is one). */
export function pickAvoiding(rng: Rng, count: number, last: number): number {
  let index = Math.floor(rng() * count);
  if (count > 1 && index === last) index = (index + 1) % count;
  return index;
}
