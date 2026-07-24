/**
 * Port of backend/app/detection/upi.py.
 *
 * The central trap: a UPI PIN authorises money leaving your account, so any
 * message pairing a promise of incoming money with a PIN entry or an approval
 * prompt is a top-weight signal. Weights and reason codes match the server.
 */

import type { EngineUpiFlag as UpiFlag, UpiConfig, UpiGroup } from "@/lib/engine/types";

const UPI_LINK_RE = /(upi|phonepe|tez|paytmmp|gpay|bhim):\/\/([a-z]+)\?(\S*)/gi;
// A UPI handle never contains a dot, which separates it from an email address.
const VPA_RE = /(?<![\w.-])[\w.-]{2,64}@[a-z]{2,32}(?![\w.-])/gi;
const TERM_KEYS = ["en", "hi", "gu", "translit"] as const;
const ASCII_ONLY = /^[\x00-\x7f]+$/;
const WB = "[\\p{L}\\p{N}_]";
const COLLECT_ACTIONS = new Set(["collect", "mandate", "requestpay"]);

const WEIGHTS: Record<string, number> = {
  collect_request_disguised: 1.0,
  pin_to_receive_money: 1.0,
  unknown_vpa_payment: 0.5,
  upi_link_present: 0.15,
};

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileGroup(group: UpiGroup | undefined): RegExp | null {
  if (!group) return null;
  const patterns: string[] = [];
  for (const key of TERM_KEYS) {
    for (const term of group[key] ?? []) {
      const body = term.split(/\s+/).filter(Boolean).map(escapeRegExp).join("\\s+");
      patterns.push(ASCII_ONLY.test(term) ? `(?<!${WB})${body}(?:s|ed)?(?!${WB})` : `(?<!${WB})${body}`);
    }
  }
  for (const raw of group.patterns ?? []) patterns.push(raw);
  if (patterns.length === 0) return null;
  try {
    return new RegExp(patterns.join("|"), "giu");
  } catch {
    try {
      return new RegExp(patterns.join("|"), "gi");
    } catch {
      return null;
    }
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

interface UpiIntent {
  raw: string;
  action: string;
  vpa: string | null;
  amount: string | null;
}

function parseIntents(text: string): UpiIntent[] {
  const intents: UpiIntent[] = [];
  UPI_LINK_RE.lastIndex = 0;
  for (const m of text.matchAll(UPI_LINK_RE)) {
    const params = new Map<string, string>();
    for (const pair of m[3]!.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const val = eq === -1 ? "" : pair.slice(eq + 1);
      if (val && !params.has(key)) params.set(key, decode(val));
    }
    intents.push({
      raw: m[0],
      action: m[2]!,
      vpa: params.get("pa") ?? null,
      amount: params.get("am") ?? null,
    });
  }
  return intents;
}

function isCollect(intent: UpiIntent): boolean {
  return COLLECT_ACTIONS.has(intent.action.toLowerCase());
}

function matches(pattern: RegExp | null, text: string): boolean {
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export class UpiAnalyzer {
  private readonly receiveClaim: RegExp | null;
  private readonly pinInstruction: RegExp | null;
  private readonly collectInstruction: RegExp | null;
  private readonly knownHandles: Set<string>;

  constructor(config: UpiConfig) {
    this.receiveClaim = compileGroup(config.receive_claims);
    this.pinInstruction = compileGroup(config.pin_instructions);
    this.collectInstruction = compileGroup(config.collect_instructions);
    this.knownHandles = new Set((config.known_handles ?? []).map((h) => h.toLowerCase().replace(/^@/, "")));
  }

  analyze(text: string): UpiFlag[] {
    const intents = parseIntents(text);
    VPA_RE.lastIndex = 0;
    const mentionedVpa = text.match(VPA_RE)?.[0] ?? null;
    const claimsIncoming = matches(this.receiveClaim, text);
    const asksForPin = matches(this.pinInstruction, text);
    const asksToApprove = matches(this.collectInstruction, text);
    const hasCollectIntent = intents.some(isCollect);

    const flags: UpiFlag[] = [];

    if (claimsIncoming && asksForPin) {
      flags.push(
        flagFor(
          "pin_to_receive_money",
          "The message promises you money and then asks for your UPI PIN. A PIN only ever sends money out of your account.",
          intents,
          mentionedVpa,
        ),
      );
    }

    if (claimsIncoming && (hasCollectIntent || asksToApprove)) {
      flags.push(
        flagFor(
          "collect_request_disguised",
          "This is a request to take money from your account, dressed up as money coming in. Approving it pays them.",
          intents,
          mentionedVpa,
        ),
      );
    }

    if (flags.length === 0) {
      for (const intent of intents) {
        if (this.isUnknownPayee(intent)) {
          flags.push(
            flagFor("unknown_vpa_payment", "The link pays a UPI address that is not a recognised payment provider.", [intent]),
          );
          break;
        }
      }
    }

    if (flags.length === 0 && intents.length > 0) {
      flags.push(
        flagFor(
          "upi_link_present",
          "The message contains a payment link. Check the name and the direction in your app before approving.",
          intents,
        ),
      );
    }

    return flags;
  }

  private isUnknownPayee(intent: UpiIntent): boolean {
    if (isCollect(intent)) return true;
    if (!intent.vpa || !intent.vpa.includes("@")) return false;
    const handle = intent.vpa.split("@").pop()!.toLowerCase(); // vpa contains "@"
    return this.knownHandles.size > 0 && !this.knownHandles.has(handle);
  }
}

function flagFor(reason: string, detail: string, intents: UpiIntent[], mentionedVpa: string | null = null): UpiFlag {
  const intent = intents[0] ?? null;
  return {
    reason,
    detail,
    weight: WEIGHTS[reason]!,
    vpa: (intent?.vpa ?? null) || mentionedVpa,
    amount: intent?.amount ?? null,
  };
}
