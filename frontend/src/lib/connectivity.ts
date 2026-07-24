/**
 * Network awareness for the local-first flow.
 *
 * The on-device engine always answers; the server is an optional upgrade. How
 * long we are willing to wait for that upgrade - and whether we even try - is a
 * function of the connection, so a 2G phone is never left staring at a spinner.
 */

interface NetworkInformation {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
}

function connection(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export interface ServerPlan {
  /** Try the server at all? False when offline or on a 2G-class link. */
  attempt: boolean;
  /** Milliseconds to wait for the server's verdict before giving up on it. */
  budgetMs: number;
  effectiveType: string;
}

/**
 * Decide how to treat the server for this check.
 *
 * slow-2g / 2g: skip the server LLM entirely - the round trip costs more than the
 * on-device answer is worth. 3g: an 8s budget. Anything better (or unknown): 6s.
 */
export function serverPlan(): ServerPlan {
  if (!isOnline()) return { attempt: false, budgetMs: 0, effectiveType: "offline" };
  const type = connection()?.effectiveType ?? "unknown";
  if (type === "slow-2g" || type === "2g") return { attempt: false, budgetMs: 0, effectiveType: type };
  if (type === "3g") return { attempt: true, budgetMs: 8_000, effectiveType: type };
  return { attempt: true, budgetMs: 6_000, effectiveType: type };
}
