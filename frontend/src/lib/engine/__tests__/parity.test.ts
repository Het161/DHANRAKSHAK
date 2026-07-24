/**
 * Parity: the on-device engine must reproduce the server's verdict.
 *
 * Fixtures in __fixtures__/parity.json are the REAL server engine's output,
 * emitted by backend/scripts/export_client_model.py. The client engine here must
 * match every label and land within +/-5 risk points, across English, Hindi and
 * Gujarati, tactics, URL/UPI traps and clear negatives.
 */

import { describe, expect, it } from "vitest";

import fixtures from "@/lib/engine/__fixtures__/parity.json";
import { loadArtifactsFromDisk } from "@/lib/engine/__tests__/loadFromDisk";
import { LocalEngine } from "@/lib/engine";
import type { LanguageHint } from "@/lib/types";

interface Fixture {
  text: string;
  lang: LanguageHint;
  verdict: string;
  risk_score: number;
  classifier_score: number | null;
}

const engine = new LocalEngine(loadArtifactsFromDisk());
const rows = fixtures as Fixture[];

describe("on-device engine parity with the server", () => {
  it.each(rows)("$verdict ($lang): $text", (fixture) => {
    const result = engine.analyze(fixture.text, fixture.lang);
    expect(result.verdict).toBe(fixture.verdict);
    expect(Math.abs(result.risk_score - fixture.risk_score)).toBeLessThanOrEqual(5);
  });

  it("matches every label and stays within +/-5 risk overall", () => {
    let labelMatches = 0;
    let maxRiskDelta = 0;
    for (const fixture of rows) {
      const result = engine.analyze(fixture.text, fixture.lang);
      if (result.verdict === fixture.verdict) labelMatches += 1;
      maxRiskDelta = Math.max(maxRiskDelta, Math.abs(result.risk_score - fixture.risk_score));
    }
    console.log(`parity: ${labelMatches}/${rows.length} labels match, max risk delta ${maxRiskDelta}`);
    expect(labelMatches).toBe(rows.length);
    expect(maxRiskDelta).toBeLessThanOrEqual(5);
  });
});
