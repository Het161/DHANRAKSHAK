"""Recognise a genuine bank transaction / account-notification SMS.

The scam classifier is trained largely on public English spam and misreads terse
Indian transactional SMS - it will call a real "INR 280 debited ... Axis Bank"
alert, a balance notice, or an OTP delivery a scam with ~0.99 confidence. Banks
send these constantly, so a false alarm here is the expensive mistake: it teaches
people to ignore the app.

This recogniser is deliberately HIGH-PRECISION. It is used to VETO the classifier's
vote when - and only when - no deterministic signal fired (no scam-lexicon tactic,
no malicious/look-alike URL, no UPI-PIN trap). A scam dressed up as an alert
(phishing link, "call and share your OTP", "account will be blocked", a UPI collect
request) still trips one of those signals, so it is never silenced by this. It can
ONLY ever mute a lone, over-confident classifier vote on a clean bank-shaped message.

Three benign shapes are recognised:
  1. a transaction alert  - a money-movement verb + a banking-context marker
  2. an account notice     - a balance / mini-statement line (no verb, e.g. "Avl Bal",
                             "mini statement ... Cr 45000") + a banking marker
  3. an OTP delivery       - an OTP token + a "do not share / valid for" guard, which a
                             scam never includes

Kept portable (plain, case-insensitive, no lookbehind) so the on-device TypeScript
port in frontend/src/lib/engine/transaction.ts stays identical.
"""

from __future__ import annotations

import re

# Money actually moved (or a transaction is being reported).
_MOVEMENT = re.compile(
    r"\b(debited|credited|debit|credit|deducted|withdrawn|withdrawal|spent|"
    r"received|transferred|deposited|reversed|purchase|txn|transaction)\b",
    re.IGNORECASE,
)

# A balance / statement notice that carries NO debit-credit verb but is still a
# genuine bank notification: "Avl Bal", "available balance", "mini statement", or a
# statement line using the Cr/Dr abbreviation right before an amount ("Cr 45000.00").
_ACCOUNT_NOTICE = re.compile(
    r"(avl\.?\s*bal|avbl\s*bal|available\s*bal|a/c\s*bal|account\s*bal|"
    r"mini[\s-]*statement|e[\s-]*statement|account\s*statement|"
    r"\b(cr|dr)\b[.: ]*\s*(inr|rs)?\.?\s*[\d,]{2,})",
    re.IGNORECASE,
)

# Banking context a genuine alert always carries: a (masked) account, an amount, a
# transaction reference, or an available-balance line.
_BANKING_MARKER = re.compile(
    r"(a/c\b|ac\s*no\b|account\s*(no|number|ending|balance)|"  # account
    r"x{2,}\d{2,}|"                                            # masked account e.g. XX9670
    r"(inr|rs)\.?\s*[\d,]+|"                                   # amount: INR 280 / Rs.500
    r"upi\s*[/:]|upi\s*ref|ref\s*(no|id)|\brrn\b|txn\s*id|"    # reference
    r"\bimps\b|\bneft\b|\brtgs\b|"                             # rails
    r"avl\s*bal|available\s*bal)",                             # balance
    re.IGNORECASE,
)

# An OTP the bank sent TO you, always paired with a "do not share / valid for /
# expires" guard. A scam asking for your OTP never tells you not to share it, and it
# trips credential_request anyway - so this branch only mutes the classifier on the
# genuine delivery notice.
_OTP_TOKEN = re.compile(
    r"\b(otp|one[\s-]*time[\s-]*(password|passcode|pin)|verification\s*code)\b",
    re.IGNORECASE,
)
_OTP_SAFE_HINT = re.compile(
    r"((do\s*not|don'?t|never|dont)\s+(share|disclose|reveal)|"
    r"valid\s+for\s+\d|expires?\s+in|never\s+shares?\s+(it|your))",
    re.IGNORECASE,
)


def _is_transaction_alert(text: str) -> bool:
    if not _BANKING_MARKER.search(text):
        return False
    return bool(_MOVEMENT.search(text) or _ACCOUNT_NOTICE.search(text))


def _is_benign_otp_notice(text: str) -> bool:
    return bool(_OTP_TOKEN.search(text) and _OTP_SAFE_HINT.search(text))


def is_benign_alert(text: str) -> bool:
    """True when `text` reads like a genuine bank transaction/account/OTP notice.

    Used only to mute the classifier when nothing deterministic fired - never to
    lower a rule-produced score.
    """
    return _is_transaction_alert(text) or _is_benign_otp_notice(text)
