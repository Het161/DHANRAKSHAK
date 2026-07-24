"use client";

import { useCallback, useEffect } from "react";

import { CoachCard } from "@/components/simulator/CoachCard";
import { PushToTalk } from "@/components/simulator/PushToTalk";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { flagTitle } from "@/components/verdict/EvidenceText";
import { useVoiceCall, type CallOptions, type VoiceCallState } from "@/hooks/useVoiceCall";
import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";
import type { Coach } from "@/lib/types";

type Tone = "listening" | "user" | "caller" | "off";

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function CallerAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full bg-brand/20 ${speaking ? "animate-ping" : ""}`}
      />
      <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-brand text-4xl font-bold text-white">
        <svg viewBox="0 0 24 24" aria-hidden className="h-12 w-12">
          <path
            d="M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </div>
  );
}

function MicIndicator({ label, tone, pulse }: { label: string; tone: Tone; pulse: boolean }) {
  const styles: Record<Tone, string> = {
    listening: "bg-brand-tint text-brand",
    user: "bg-safe-tint text-safe",
    caller: "bg-suspicious-tint text-suspicious",
    off: "bg-line text-ink-soft",
  };
  return (
    <p
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-base font-bold ${styles[tone]}`}
    >
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full bg-current ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </p>
  );
}

function DebugOverlay({ state }: { state: VoiceCallState }) {
  const { audio } = state;
  return (
    <div className="fixed right-2 bottom-2 z-50 max-w-[17rem] rounded-xl bg-ink/90 p-3 font-mono text-[11px] leading-snug text-white">
      <p className="mb-1 font-bold">voice debug</p>
      <p>state: {state.phase}</p>
      <p>
        audio: turn {audio.turnId} seq {audio.playingSeq ?? "-"} depth {audio.depth}
        {audio.playing ? " playing" : audio.buffering ? " buffering" : " idle"}
      </p>
      <p>recognition: {state.recognitionOn ? "ON" : "off"}</p>
      <p className={state.discardedEcho ? "text-amber-300" : ""}>echo: {state.discardedEcho ?? "-"}</p>
      {state.plan && (
        <>
          <p className="mt-1 font-bold">plan (seed {state.plan.seed})</p>
          <p>tactics: {state.plan.tactic_order.join(" > ")}</p>
          <p>slots: {Object.entries(state.plan.slots).map(([k, v]) => `${k}=${v}`).join(", ")}</p>
        </>
      )}
      {state.turnDebug && (
        <>
          <p className="mt-1 font-bold">
            last turn ({state.turnDebug.class}, {state.turnDebug.path}, msgs {state.turnDebug.messages_len},
            hist {state.turnDebug.history_len})
          </p>
          <p>heard: {state.turnDebug.transcript || "(silence)"}</p>
          <p>bridge: {state.turnDebug.bridge}</p>
          <p>reply: {state.turnDebug.reply}</p>
        </>
      )}
      <p className="mt-1 font-bold">sentences (fetch/toPlay/play ms)</p>
      {state.timings.slice(-5).map((timing, index) => (
        <p key={`${timing.turnId}-${timing.seq}-${index}`}>
          t{timing.turnId}.{timing.seq}: {timing.fetchMs ?? "-"}/{timing.toPlayMs ?? "-"}/
          {timing.playMs ?? "-"}
        </p>
      ))}
    </div>
  );
}

function Debrief({
  coaches,
  score,
  onAgain,
  onLeave,
}: {
  coaches: Coach[];
  score: number;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const { t } = usePreferences();
  const spotted = coaches.filter((coach) => coach.score_delta > 0);
  const mistakes = coaches.filter((coach) => coach.score_delta < 0);
  const names = (list: Coach[]) =>
    [...new Set(list.map((coach) => coach.tactic_revealed).filter(Boolean))] as string[];

  return (
    <Card className="animate-slide-up space-y-5">
      <div>
        <p className="text-sm font-bold tracking-wide text-ink-soft uppercase">
          {t("voice.debriefTitle")}
        </p>
        <p className="mt-1 text-xl font-bold text-ink">
          {mistakes.length === 0
            ? t("simulator.endStrong")
            : mistakes.length === 1
              ? t("simulator.endMixed")
              : t("simulator.endWeak")}
        </p>
        <p className="mt-1 text-ink-soft">
          {t("simulator.score")}: {score}
        </p>
      </div>

      {spotted.length > 0 && (
        <div>
          <CardTitle>{t("simulator.endSpotted")}</CardTitle>
          <ul className="space-y-1">
            {names(spotted).map((tactic) => (
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
            {names(mistakes).map((tactic) => (
              <li key={tactic} className="font-semibold text-suspicious">
                {flagTitle(tactic, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" onClick={onAgain} block>
          {t("voice.again")}
        </Button>
        <Button variant="secondary" onClick={onLeave} block>
          {t("simulator.leave")}
        </Button>
      </div>
    </Card>
  );
}

const PHASE: Record<string, [MessageKey, Tone]> = {
  connecting: ["voice.connecting", "caller"],
  caller_speaking: ["voice.callerSpeaking", "caller"],
  processing: ["voice.thinking", "off"],
  user_turn: ["voice.yourTurn", "user"],
  ended: ["voice.debriefTitle", "off"],
  error: ["error.generic", "off"],
  idle: ["voice.connecting", "off"],
};

export function VoiceCallScreen({
  options,
  onLeave,
  debug,
}: {
  options: CallOptions;
  onLeave: () => void;
  debug: boolean;
}) {
  const { t } = usePreferences();
  const { state, start, end, reset, interrupt, toggleMute, submitSpoken, attachAudio } =
    useVoiceCall();

  useEffect(() => {
    void start(options);
    return end;
  }, [options, start, end]);

  const again = useCallback(() => {
    reset();
    void start(options);
  }, [options, reset, start]);

  const ended = state.phase === "ended" || state.finished;
  const [labelKey, tone] = PHASE[state.phase] ?? PHASE.user_turn!;
  const callerHasFloor = state.phase === "caller_speaking";
  const userTurn = state.phase === "user_turn";

  return (
    <div className="space-y-4">
      <audio ref={attachAudio} className="sr-only" preload="auto" />

      <div className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-surface p-6">
        <p className="rounded-full bg-suspicious-tint px-3 py-1 text-sm font-semibold text-suspicious">
          {t("simulator.notReal")}
        </p>
        <CallerAvatar speaking={callerHasFloor} />
        <p className="text-xl font-bold text-ink">
          {t(`simulator.persona.${options.persona}` as MessageKey)}
        </p>
        <p className="font-mono text-2xl text-ink-soft">{formatClock(state.seconds)}</p>
        <MicIndicator
          label={state.muted ? t("voice.mutedState") : t(labelKey)}
          tone={state.muted ? "off" : tone}
          pulse={userTurn && state.userSpeaking && !state.muted}
        />
        {state.usesLocalSpeech && (
          <p className="text-center text-sm text-ink-faint">{t("voice.localSpeechNotice")}</p>
        )}
        {state.micDenied && (
          <p role="alert" className="rounded-xl bg-scam-tint px-3 py-2 text-center text-sm text-scam">
            {t("voice.micDenied")}
          </p>
        )}
      </div>

      {/* Interrupt replaces auto barge-in: an explicit gesture, so no echo risk. */}
      {callerHasFloor && (
        <Button variant="secondary" block onClick={interrupt}>
          {t("voice.interrupt")}
        </Button>
      )}

      {!ended && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={toggleMute} block>
            {state.muted ? t("voice.unmute") : t("voice.mute")}
          </Button>
          <Button variant="danger" onClick={end} block>
            {t("voice.end")}
          </Button>
        </div>
      )}

      {userTurn && state.pushToTalk && (
        <Card className="space-y-3 text-center">
          <p className="text-sm text-ink-soft">{t("voice.pushToTalkHint")}</p>
          <PushToTalk onTranscript={submitSpoken} />
        </Card>
      )}

      {state.captions.length > 0 && (
        <Card>
          <CardTitle>{t("voice.captions")}</CardTitle>
          <div className="space-y-2">
            {state.captions.slice(-6).map((caption, index) => (
              <p
                key={`${caption.seq}-${index}`}
                className={`leading-relaxed ${
                  caption.source === "user" ? "font-semibold text-brand-dark" : "text-ink"
                }`}
              >
                {caption.text}
              </p>
            ))}
          </div>
        </Card>
      )}

      {state.coach && !ended && <CoachCard coach={state.coach} />}

      {ended && (
        <Debrief coaches={state.coachHistory} score={state.score} onAgain={again} onLeave={onLeave} />
      )}

      {debug && <DebugOverlay state={state} />}
    </div>
  );
}
