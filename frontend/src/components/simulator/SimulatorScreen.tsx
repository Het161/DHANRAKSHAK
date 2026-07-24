"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CoachCard } from "@/components/simulator/CoachCard";
import { PersonaPicker } from "@/components/simulator/PersonaPicker";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { flagTitle } from "@/components/verdict/EvidenceText";
import { useSimulator, type Entry, type SimulatorDebug } from "@/hooks/useSimulator";
import { usePreferences } from "@/i18n/I18nProvider";
import { speak, speechSupported } from "@/lib/practice/speech";
import type { PersonaId } from "@/lib/types";

const TOTAL_TURNS = 6;

function DebugPanel({ debug }: { debug: SimulatorDebug }) {
  const { plan, sources } = debug;
  return (
    <div className="rounded-xl bg-ink/90 p-3 font-mono text-[11px] leading-snug text-white">
      <p className="font-bold">text debug</p>
      {plan ? (
        <>
          <p>seed: {plan.seed}</p>
          <p>tactics: {plan.tactic_order.join(" > ")}</p>
          <p>slots: {Object.entries(plan.slots).map(([k, v]) => `${k}=${v}`).join(", ")}</p>
        </>
      ) : (
        <p>plan: (none — add ?debug=1)</p>
      )}
      <p>path per turn: {sources.length ? sources.join(", ") : "-"}</p>
    </div>
  );
}

function Bubble({
  entry,
  speakable,
}: {
  entry: Extract<Entry, { kind: "scammer" | "user" }>;
  speakable: boolean;
}) {
  const { t, lang } = usePreferences();
  const mine = entry.kind === "user";
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <span className="mb-1 px-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {mine ? t("simulator.you") : t("simulator.caller")}
      </span>
      <div className={`flex max-w-[85%] items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
        <p
          className={`animate-slide-up rounded-2xl px-4 py-3 leading-relaxed ${
            mine
              ? "rounded-br-sm bg-brand text-white"
              : "rounded-bl-sm border border-line bg-surface text-ink"
          }`}
        >
          {entry.text}
        </p>
        {/* Offline voice: on-device speechSynthesis, no server TTS needed. */}
        {speakable && speechSupported() && (
          <button
            type="button"
            onClick={() => speak(entry.text, lang)}
            aria-label={t("simulator.listen")}
            title={t("simulator.listen")}
            className="focus-ring mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-soft"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
              <path
                d="M4 9v6h4l5 5V4L8 9H4Zm12.5 3a4 4 0 0 0-2.5-3.7v7.4a4 4 0 0 0 2.5-3.7Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function EndScreen({
  entries,
  onAgain,
}: {
  entries: Entry[];
  onAgain: () => void;
}) {
  const { t } = usePreferences();
  const coaches = entries.filter((entry): entry is Extract<Entry, { kind: "coach" }> => entry.kind === "coach");
  const mistakes = coaches.filter((entry) => entry.coach.score_delta < 0);
  const spotted = coaches.filter((entry) => entry.coach.score_delta > 0);

  // Judged on behaviour rather than a point total: what matters is whether the
  // learner gave anything away, not how many turns they lasted.
  const headline =
    mistakes.length === 0
      ? t("simulator.endStrong")
      : mistakes.length === 1
        ? t("simulator.endMixed")
        : t("simulator.endWeak");

  const tactics = (list: typeof coaches) =>
    [...new Set(list.map((entry) => entry.coach.tactic_revealed).filter(Boolean))] as string[];

  return (
    <Card className="animate-slide-up space-y-5">
      <div>
        <p className="text-sm font-bold tracking-wide text-ink-soft uppercase">
          {t("simulator.endTitle")}
        </p>
        <p className="mt-1 text-xl font-bold text-ink">{headline}</p>
      </div>

      {spotted.length > 0 && (
        <div>
          <CardTitle>{t("simulator.endSpotted")}</CardTitle>
          <ul className="space-y-1">
            {tactics(spotted).map((tactic) => (
              <li key={tactic} className="font-semibold text-safe">
                {flagTitle(tactic, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mistakes.length > 0 && (
        <div>
          <CardTitle>{t("simulator.endMissed")}</CardTitle>
          <ul className="space-y-1">
            {tactics(mistakes).map((tactic) => (
              <li key={tactic} className="font-semibold text-suspicious">
                {flagTitle(tactic, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" onClick={onAgain} block>
          {t("simulator.again")}
        </Button>
        <Link
          href="/"
          className="focus-ring tap inline-flex items-center justify-center rounded-2xl border border-line-strong bg-surface px-5 py-3 text-base font-semibold text-ink"
        >
          {t("simulator.toAnalyzer")}
        </Link>
      </div>
    </Card>
  );
}

export function SimulatorScreen({ debug = false }: { debug?: boolean }) {
  const { t, lang } = usePreferences();
  const { state, start, send, reset } = useSimulator();
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.entries.length]);

  const submit = useCallback(() => {
    const message = draft.trim();
    if (!message || state.phase === "sending") return;
    setDraft("");
    void send(message);
  }, [draft, send, state.phase]);

  const restart = useCallback(() => {
    reset();
    setPersona(null);
    setDraft("");
  }, [reset]);

  if (state.phase === "idle" || state.phase === "error") {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {t("simulator.title")}
          </h1>
          <p className="mt-2 leading-relaxed text-ink-soft">{t("simulator.subtitle")}</p>
        </div>

        <Card className="space-y-4">
          <CardTitle>{t("simulator.choose")}</CardTitle>
          <PersonaPicker selected={persona} onSelect={setPersona} />
          {state.phase === "error" && (
            <p role="alert" className="rounded-xl bg-scam-tint px-3 py-2 text-scam">
              {state.errorMessage ?? t("error.generic")}
            </p>
          )}
          <Button
            variant="primary"
            block
            disabled={!persona}
            onClick={() => persona && void start(persona, lang)}
          >
            {t("simulator.start")}
          </Button>
        </Card>
      </div>
    );
  }

  if (state.phase === "starting" || state.phase === "waking") {
    return (
      <Card aria-live="polite">
        <p className="text-lg font-bold text-ink">
          {state.phase === "waking" ? t("status.wakingTitle") : t("simulator.start")}
        </p>
        {state.phase === "waking" && (
          <p className="mt-1 leading-relaxed text-ink-soft">{t("status.wakingBody")}</p>
        )}
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="shimmer h-3 w-3/4 rounded-full" />
          <div className="shimmer h-3 w-full rounded-full" />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {debug && <DebugPanel debug={state.debug} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="rounded-full bg-suspicious-tint px-3 py-1.5 text-sm font-semibold text-suspicious">
            {t("simulator.notReal")}
          </p>
          {state.offline && (
            <p className="rounded-full bg-brand-tint px-3 py-1.5 text-sm font-semibold text-brand-dark">
              {t("simulator.offlineBadge")}
            </p>
          )}
        </div>
        <p className="text-sm font-semibold text-ink-soft">
          {t("simulator.score")}: {state.score}
          <span className="ml-3 text-ink-faint">
            {t("simulator.turnOf", { turn: state.turn, total: TOTAL_TURNS })}
          </span>
        </p>
      </div>

      <div className="space-y-3">
        {state.entries.map((entry) =>
          entry.kind === "coach" ? (
            <CoachCard key={entry.id} coach={entry.coach} />
          ) : (
            <Bubble key={entry.id} entry={entry} speakable={state.offline && entry.kind === "scammer"} />
          ),
        )}
        <div ref={endRef} />
      </div>

      {state.finished ? (
        <EndScreen entries={state.entries} onAgain={restart} />
      ) : (
        <Card className="sticky bottom-3 space-y-3">
          <label htmlFor="reply" className="sr-only">
            {t("simulator.inputPlaceholder")}
          </label>
          <textarea
            id="reply"
            rows={2}
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("simulator.inputPlaceholder")}
            className="focus-ring w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-base text-ink placeholder:text-ink-faint"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={submit}
              disabled={state.phase === "sending"}
              className="flex-1"
            >
              {state.phase === "sending" ? t("simulator.sending") : t("simulator.send")}
            </Button>
            <Button variant="quiet" onClick={restart} className="shrink-0 whitespace-nowrap px-3">
              {t("simulator.leave")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
