/**
 * The on-device detection engine: a faithful port of the server's tier 1 + tier
 * 2, assembled from the exported artifacts. Same input, same verdict shape, same
 * numbers - only the explanation source differs (always "on-device" here).
 *
 * See backend/app/detection (the pipeline) and export_client_model.py (the
 * artifacts). Parity is asserted in engine/__tests__/parity.test.ts.
 */

import { Explainer } from "@/lib/engine/explain";
import { classifierScore } from "@/lib/engine/lgbm";
import { cleanText, detectLanguage } from "@/lib/engine/normalize";
import { RuleEngine } from "@/lib/engine/rules";
import { fuseRisk, labelFor } from "@/lib/engine/fusion";
import { isBenignAlert } from "@/lib/engine/transaction";
import type { EngineArtifacts, LocalVerdict } from "@/lib/engine/types";
import { UpiAnalyzer } from "@/lib/engine/upi";
import { UrlAnalyzer } from "@/lib/engine/urls";
import type { LanguageHint } from "@/lib/types";

/** A ready-to-run engine. Compiling the lexicons once and reusing this is what
 *  keeps a verdict well under the 100ms target on a cheap phone. */
export class LocalEngine {
  private readonly rules: RuleEngine;
  private readonly urls: UrlAnalyzer;
  private readonly upi: UpiAnalyzer;
  private readonly explainer: Explainer;

  constructor(private readonly artifacts: EngineArtifacts) {
    this.rules = RuleEngine.fromLexicons(artifacts.lexicons);
    this.urls = new UrlAnalyzer(artifacts.urlConfig);
    this.upi = new UpiAnalyzer(artifacts.upiConfig);
    this.explainer = new Explainer(artifacts.templates, artifacts.advisories);
  }

  get version(): string {
    return this.artifacts.version;
  }

  analyze(raw: string, hint: LanguageHint = "auto"): LocalVerdict {
    const text = cleanText(raw);
    const lang = detectLanguage(text, hint);

    const tactics = this.rules.detect(text);
    const urlFlags = this.urls.analyze(text);
    const upiFlags = this.upi.analyze(text);
    let score = classifierScore(this.artifacts.model, text);

    // Veto the classifier on a genuine transaction alert when nothing deterministic
    // fired: the spam-trained model misreads terse Indian bank SMS, and its vote is
    // the only thing that would otherwise raise a false alarm on a real debit/credit
    // notice. A scam disguised as an alert still trips a tactic/URL/UPI signal.
    if (
      tactics.length === 0 &&
      urlFlags.length === 0 &&
      upiFlags.length === 0 &&
      isBenignAlert(text)
    ) {
      score = null;
    }

    const risk = fuseRisk(
      {
        tacticWeights: tactics.map((t) => t.weight),
        urlWeights: urlFlags.map((f) => f.weight),
        upiWeights: upiFlags.map((f) => f.weight),
        classifierScore: score,
      },
      this.artifacts.thresholds,
    );
    const verdict = labelFor(risk, this.artifacts.thresholds);

    const flags = this.explainer.flagsFor(tactics, urlFlags, upiFlags, lang);
    const names = flags.map((flag) => flag.name);

    return {
      verdict,
      risk_score: risk,
      flags,
      advisory: this.explainer.retrieveAdvisory(names, lang),
      actions: this.explainer.actions(verdict, lang),
      lang,
      analyzed_text: text,
      explanation: this.explainer.render(verdict, lang, names),
      explanation_source: "on-device",
      classifier_score: score === null ? null : Number(score.toFixed(4)),
    };
  }
}
