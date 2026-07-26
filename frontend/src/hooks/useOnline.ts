"use client";

import { useEffect, useState } from "react";

import { pingHealth } from "@/lib/api";

// How long to wait for the server to answer before believing navigator.onLine.
const CONFIRM_PING_MS = 3_000;

/**
 * Reactive online/offline state, corrected for a lying flag.
 *
 * `navigator.onLine` is a notorious false-negative: Chrome can report "offline"
 * after sleep, a VPN flip, or a brief drop while the machine is in fact online —
 * and our server (on localhost or a LAN) is reachable regardless of the wider
 * internet. So when the flag says offline we do not take its word: a health ping
 * that succeeds means we are online for every server feature (voice practice,
 * the LLM upgrade). Only when the flag says offline AND the server cannot be
 * reached do we treat the app as truly offline.
 *
 * Assumes online during SSR and first paint, so nothing flashes and there is no
 * hydration mismatch; the effect corrects it a moment later if needed.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const recheck = async () => {
      // A positive flag is reliable — the browser only claims online with a link.
      if (navigator.onLine) {
        if (!cancelled) setOnline(true);
        return;
      }
      // A negative flag is not: confirm with the server before believing it.
      const reachable = await pingHealth(CONFIRM_PING_MS);
      if (!cancelled) setOnline(reachable);
    };

    void recheck();
    window.addEventListener("online", recheck);
    window.addEventListener("offline", recheck);
    return () => {
      cancelled = true;
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", recheck);
    };
  }, []);

  return online;
}
