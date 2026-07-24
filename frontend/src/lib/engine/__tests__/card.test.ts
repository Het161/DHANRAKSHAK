/**
 * The offline verdict card must be complete: a Gujarati scam should come back
 * with a Gujarati explanation, highlighted evidence spans, localized flags, an
 * advisory, actions, and the honest on-device source tag - no server involved.
 */

import { describe, expect, it } from "vitest";

import { LocalEngine } from "@/lib/engine";
import { loadArtifactsFromDisk } from "@/lib/engine/__tests__/loadFromDisk";

const engine = new LocalEngine(loadArtifactsFromDisk());

describe("offline verdict card content", () => {
  it("returns a full Gujarati card for a Gujarati scam", () => {
    const gu = "તમારું ખાતું બંધ થઈ જશે. તાત્કાલિક KYC કરો અને OTP શેર કરો.";
    const result = engine.analyze(gu, "gu");

    expect(result.explanation_source).toBe("on-device");
    expect(result.lang).toBe("gu");
    expect(["suspicious", "scam"]).toContain(result.verdict);
    expect(result.flags.length).toBeGreaterThan(0);

    // Evidence spans index into analyzed_text and land on real substrings.
    const spanned = result.flags.filter((f) => f.evidence_span);
    expect(spanned.length).toBeGreaterThan(0);
    for (const flag of spanned) {
      const [start, end] = flag.evidence_span!;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(result.analyzed_text.length);
      expect(end).toBeGreaterThan(start);
    }

    // Explanation is in Gujarati script, not an English fallback.
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(/[઀-૿]/.test(result.explanation)).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.classifier_score).toBeNull(); // out of the Latin-only model's distribution
  });

  it("clears a benign message without inventing flags", () => {
    const result = engine.analyze("Meeting moved to 3pm tomorrow, bring the report.", "en");
    expect(result.verdict).toBe("safe");
    expect(result.flags.length).toBe(0);
  });

  it("stays well under the 100ms budget once warm", () => {
    engine.analyze("warm up", "en");
    const start = performance.now();
    engine.analyze("Your account will be blocked, complete KYC at http://sbi-kyc.xyz now", "en");
    expect(performance.now() - start).toBeLessThan(100);
  });
});
