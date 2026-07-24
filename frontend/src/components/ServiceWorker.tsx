"use client";

import { useEffect, useState } from "react";

import { usePreferences } from "@/i18n/I18nProvider";

/**
 * Registers the offline worker after hydration (so it never delays first paint)
 * and surfaces a quiet "updated" toast when a new version has installed. The new
 * worker waits until the user accepts, so a check in progress is never disrupted.
 */
export function ServiceWorker() {
  const { t } = usePreferences();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // The accepted update took control; load it once.
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const next = registration.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            // "installed" with an existing controller means this is an update,
            // not the first install - only then is there anything to offer.
            if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
          });
        });
      } catch {
        /* offline-first still works from a prior registration */
      }
    };

    // On a fast static page the load event often fires before React hydrates and
    // this effect runs, so registering only on "load" would miss it entirely.
    if (document.readyState === "complete") {
      void register();
      return;
    }
    const onLoad = () => void register();
    window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="animate-slide-up fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(92%,26rem)] items-center gap-3 rounded-2xl border border-line bg-ink px-4 py-3 text-white shadow-lg"
    >
      <p className="flex-1 text-sm font-medium">{t("sw.updated")}</p>
      <button
        type="button"
        onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
        className="focus-ring rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-ink"
      >
        {t("sw.refresh")}
      </button>
    </div>
  );
}
