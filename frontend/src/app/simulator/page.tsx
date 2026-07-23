"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * Practice is a secondary journey and pulls in the voice-call machinery, so it
 * stays out of the analyzer's bundle.
 */
const PracticeScreen = dynamic(
  () => import("@/components/simulator/PracticeScreen").then((mod) => mod.PracticeScreen),
  {
    loading: () => (
      <div className="space-y-3" aria-hidden>
        <div className="shimmer h-8 w-2/3 rounded-full" />
        <div className="shimmer h-32 w-full rounded-3xl" />
      </div>
    ),
  },
);

function Practice() {
  const params = useSearchParams();
  return <PracticeScreen debug={params.get("debug") === "1"} />;
}

export default function SimulatorPage() {
  return (
    <Suspense fallback={null}>
      <Practice />
    </Suspense>
  );
}
