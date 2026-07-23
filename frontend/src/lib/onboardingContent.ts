import type { Advisory, Flag, Language, Verdict } from "@/lib/types";

/**
 * Bundled, offline demo content for the onboarding "watch it catch a scam" step,
 * plus the sample texts behind the analyzer's Try chips.
 *
 * The demo never calls the API: it ships one realistic scam SMS per language
 * with the exact phrases to flag. Evidence spans are computed from those phrases
 * by `demoResult`, so a translator only keeps each phrase an exact substring of
 * the SMS and the highlights line up on their own.
 *
 * The gu and hi entries are marked for native-speaker review.
 */

interface DemoFlagSeed {
  /** Canonical tactic/url/upi name, so the existing tactic.<name> label applies. */
  name: string;
  kind: Flag["kind"];
  /** Exact substring of `sms` to highlight. */
  phrase: string;
  detail: string;
  action: string;
  weight: number;
}

interface DemoSeed {
  sender: string;
  sms: string;
  verdict: Verdict;
  risk: number;
  flags: DemoFlagSeed[];
  advisory: Advisory;
}

export interface DemoResult {
  sender: string;
  sms: string;
  verdict: Verdict;
  risk: number;
  flags: Flag[];
  advisory: Advisory;
}

interface Samples {
  kyc: string;
  lottery: string;
  upi: string;
}

const DEMO: Record<Language, DemoSeed> = {
  en: {
    sender: "SBI-KYC",
    sms: "Dear Customer, your SBI KYC has expired. Your account will be blocked today. Verify now at http://sbi-kyc-verify.xyz and share the OTP sent to your phone.",
    verdict: "scam",
    risk: 92,
    flags: [
      {
        name: "urgency_threat",
        kind: "tactic",
        phrase: "will be blocked today",
        detail: "It rushes you, so you act before you can think or ask anyone.",
        action: "Stop. A real bank never gives you only a few minutes.",
        weight: 0.6,
      },
      {
        name: "lookalike_domain",
        kind: "url",
        phrase: "http://sbi-kyc-verify.xyz",
        detail: "This link only looks like your bank. It is not your bank.",
        action: "Do not open it. Use your bank's own app.",
        weight: 0.9,
      },
      {
        name: "credential_request",
        kind: "tactic",
        phrase: "share the OTP",
        detail: "No bank ever asks for your OTP. It is the key to your money.",
        action: "Never tell your OTP to anyone.",
        weight: 0.95,
      },
    ],
    advisory: {
      source: "Reserve Bank of India",
      ref: "RBI-BEWARE-OTP",
      snippet:
        "A real bank never asks for your OTP, PIN or password. Never share them, and never open links sent in such messages.",
    },
  },
  // Hindi (Devanagari), native-speaker reviewed.
  hi: {
    sender: "SBI-KYC",
    sms: "प्रिय ग्राहक, आपका SBI KYC समाप्त हो गया है। आपका खाता आज बंद कर दिया जाएगा। अभी http://sbi-kyc-verify.xyz पर सत्यापित करें और आपके फोन पर भेजा गया OTP साझा करें।",
    verdict: "scam",
    risk: 92,
    flags: [
      {
        name: "urgency_threat",
        kind: "tactic",
        phrase: "खाता आज बंद कर दिया जाएगा",
        detail: "यह आपको जल्दबाज़ी में डालता है, ताकि आप सोचने या किसी से पूछने से पहले ही कर बैठें।",
        action: "रुकिए। असली बैंक कभी आपको सिर्फ़ कुछ मिनट नहीं देता।",
        weight: 0.6,
      },
      {
        name: "lookalike_domain",
        kind: "url",
        phrase: "http://sbi-kyc-verify.xyz",
        detail: "यह लिंक सिर्फ़ आपके बैंक जैसा दिखता है। यह आपका बैंक नहीं है।",
        action: "इसे मत खोलिए। अपने बैंक का अपना ऐप इस्तेमाल कीजिए।",
        weight: 0.9,
      },
      {
        name: "credential_request",
        kind: "tactic",
        phrase: "OTP साझा करें",
        detail: "कोई भी बैंक कभी आपका OTP नहीं माँगता। यह आपके पैसे की चाबी है।",
        action: "अपना OTP कभी किसी को मत बताइए।",
        weight: 0.95,
      },
    ],
    advisory: {
      source: "Reserve Bank of India",
      ref: "RBI-BEWARE-OTP",
      snippet:
        "असली बैंक कभी आपका OTP, PIN या पासवर्ड नहीं माँगता। इन्हें कभी साझा मत कीजिए, और ऐसे संदेशों में भेजे गए लिंक कभी मत खोलिए।",
    },
  },
  // Gujarati, native-speaker reviewed.
  gu: {
    sender: "SBI-KYC",
    sms: "પ્રિય ગ્રાહક, આપનું SBI KYC સમાપ્ત થઈ ગયું છે. આપનું ખાતું આજે બંધ કરી દેવામાં આવશે. હમણાં http://sbi-kyc-verify.xyz પર ચકાસો અને આપના ફોન પર મોકલેલ OTP શેર કરો.",
    verdict: "scam",
    risk: 92,
    flags: [
      {
        name: "urgency_threat",
        kind: "tactic",
        phrase: "ખાતું આજે બંધ કરી દેવામાં આવશે",
        detail: "તે તમને ઉતાવળમાં નાખે છે, જેથી તમે વિચારો કે કોઈને પૂછો તે પહેલાં જ કરી બેસો.",
        action: "થોભો. સાચી બેંક ક્યારેય તમને ફક્ત થોડી જ મિનિટ આપતી નથી.",
        weight: 0.6,
      },
      {
        name: "lookalike_domain",
        kind: "url",
        phrase: "http://sbi-kyc-verify.xyz",
        detail: "આ લિંક ફક્ત તમારી બેંક જેવી દેખાય છે. તે તમારી બેંક નથી.",
        action: "તેને ખોલશો નહીં. તમારી બેંકની પોતાની એપ વાપરો.",
        weight: 0.9,
      },
      {
        name: "credential_request",
        kind: "tactic",
        phrase: "OTP શેર કરો",
        detail: "કોઈ પણ બેંક ક્યારેય તમારો OTP માંગતી નથી. તે તમારા પૈસાની ચાવી છે.",
        action: "તમારો OTP ક્યારેય કોઈને કહો નહીં.",
        weight: 0.95,
      },
    ],
    advisory: {
      source: "Reserve Bank of India",
      ref: "RBI-BEWARE-OTP",
      snippet:
        "સાચી બેંક ક્યારેય તમારો OTP, PIN કે પાસવર્ડ માંગતી નથી. તેને ક્યારેય શેર કરો નહીં, અને આવા સંદેશામાં મોકલેલ લિંક ક્યારેય ખોલો નહીં.",
    },
  },
};

const SAMPLES: Record<Language, Samples> = {
  en: {
    kyc: DEMO.en.sms,
    lottery:
      "Congratulations! Your number has won Rs 25,00,000 in the KBC lucky draw. To claim your prize, pay a processing fee of Rs 4,500 today.",
    upi: "You will receive Rs 5,000 cashback. To get the money, approve the request in your UPI app and enter your UPI PIN now.",
  },
  // Hindi, native-speaker reviewed.
  hi: {
    kyc: DEMO.hi.sms,
    lottery:
      "बधाई हो! KBC लकी ड्रॉ में आपके नंबर ने 25,00,000 रुपये जीते हैं। अपना इनाम पाने के लिए, आज 4,500 रुपये की प्रोसेसिंग फीस भरें।",
    upi: "आपको 5,000 रुपये का कैशबैक मिलेगा। पैसे पाने के लिए, अपने UPI ऐप में आई रिक्वेस्ट को स्वीकार करें और अभी अपना UPI PIN डालें।",
  },
  // Gujarati, native-speaker reviewed.
  gu: {
    kyc: DEMO.gu.sms,
    lottery:
      "અભિનંદન! KBC લકી ડ્રોમાં આપના નંબરે 25,00,000 રૂપિયા જીત્યા છે. આપનું ઇનામ મેળવવા માટે, આજે 4,500 રૂપિયાની પ્રોસેસિંગ ફી ભરો.",
    upi: "આપને 5,000 રૂપિયાનું કૅશબૅક મળશે. પૈસા મેળવવા માટે, આપની UPI એપમાં આવેલી રિક્વેસ્ટ સ્વીકારો અને હમણાં આપનો UPI PIN દાખલ કરો.",
  },
};

/** The three short spoken greetings, each in its own language, for Step 1 cards. */
export const GREETINGS: Record<Language, string> = {
  gu: "નમસ્તે. હું ધનરક્ષક છું. હું તમારી મદદ કરીશ.",
  hi: "नमस्ते। मैं धनरक्षक हूँ। मैं आपकी मदद करूँगा।",
  en: "Hello. I am DhanRakshak. I will help you stay safe.",
};

export function demoResult(lang: Language): DemoResult {
  const seed = DEMO[lang];
  const flags: Flag[] = seed.flags.map((flag) => {
    const start = seed.sms.indexOf(flag.phrase);
    return {
      kind: flag.kind,
      name: flag.name,
      detail: flag.detail,
      action: flag.action,
      weight: flag.weight,
      // A phrase that drifted out of the SMS during translation simply loses its
      // highlight rather than pointing at the wrong characters.
      evidence_span: start >= 0 ? [start, start + flag.phrase.length] : null,
    };
  });
  return {
    sender: seed.sender,
    sms: seed.sms,
    verdict: seed.verdict,
    risk: seed.risk,
    flags,
    advisory: seed.advisory,
  };
}

export function sampleText(lang: Language, kind: keyof Samples): string {
  return SAMPLES[lang][kind];
}
