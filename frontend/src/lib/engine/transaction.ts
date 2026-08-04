/**
 * Port of backend/app/detection/transaction.py.
 *
 * Recognises a genuine bank transaction / account / OTP notification SMS. Used to
 * veto the spam-trained classifier when NO deterministic signal fired, so a real
 * "INR 280 debited ... Axis Bank" alert, a balance notice, or an OTP delivery is
 * never flagged on the classifier's overconfidence alone. High precision: it can
 * only ever mute a lone classifier vote, never lower a rule-produced score.
 *
 * Three benign shapes: a transaction alert (movement verb + banking marker), an
 * account notice (balance / mini-statement + marker), and an OTP delivery (OTP token
 * + a "do not share" guard a scam never includes). Kept byte-identical to the server
 * patterns. Built with new RegExp (not literals) so "/" inside a class needs no escape.
 */

const MOVEMENT = new RegExp(
  "\\b(debited|credited|debit|credit|deducted|withdrawn|withdrawal|spent|" +
    "received|transferred|deposited|reversed|purchase|txn|transaction)\\b",
  "i",
);

const ACCOUNT_NOTICE = new RegExp(
  "(avl\\.?\\s*bal|avbl\\s*bal|available\\s*bal|a/c\\s*bal|account\\s*bal|" +
    "mini[\\s-]*statement|e[\\s-]*statement|account\\s*statement|" +
    "\\b(cr|dr)\\b[.: ]*\\s*(inr|rs)?\\.?\\s*[\\d,]{2,})",
  "i",
);

const BANKING_MARKER = new RegExp(
  "(a/c\\b|ac\\s*no\\b|account\\s*(no|number|ending|balance)|" +
    "x{2,}\\d{2,}|" +
    "(inr|rs)\\.?\\s*[\\d,]+|" +
    "upi\\s*[/:]|upi\\s*ref|ref\\s*(no|id)|\\brrn\\b|txn\\s*id|" +
    "\\bimps\\b|\\bneft\\b|\\brtgs\\b|" +
    "avl\\s*bal|available\\s*bal)",
  "i",
);

const OTP_TOKEN = new RegExp(
  "\\b(otp|one[\\s-]*time[\\s-]*(password|passcode|pin)|verification\\s*code)\\b",
  "i",
);
const OTP_SAFE_HINT = new RegExp(
  "((do\\s*not|don'?t|never|dont)\\s+(share|disclose|reveal)|" +
    "valid\\s+for\\s+\\d|expires?\\s+in|never\\s+shares?\\s+(it|your))",
  "i",
);

function isTransactionAlert(text: string): boolean {
  if (!BANKING_MARKER.test(text)) return false;
  return MOVEMENT.test(text) || ACCOUNT_NOTICE.test(text);
}

function isBenignOtpNotice(text: string): boolean {
  return OTP_TOKEN.test(text) && OTP_SAFE_HINT.test(text);
}

/** True when `text` reads like a genuine bank transaction/account/OTP notice. */
export function isBenignAlert(text: string): boolean {
  return isTransactionAlert(text) || isBenignOtpNotice(text);
}
