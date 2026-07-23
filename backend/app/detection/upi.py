from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, unquote

from app.detection.lexicon import load_json_config
from app.schemas.contracts import UpiFlag

logger = logging.getLogger(__name__)

_UPI_LINK_RE = re.compile(
    r"(?P<app>upi|phonepe|tez|paytmmp|gpay|bhim)://(?P<action>[a-z]+)\?(?P<query>\S*)",
    re.IGNORECASE,
)
# A UPI handle never contains a dot, which is what separates "raju@okaxis" from
# an email address like "help@sbi.co.in".
_VPA_RE = re.compile(r"(?<![\w.\-])[\w.\-]{2,64}@[a-z]{2,32}(?![\w.\-])", re.IGNORECASE)

_TERM_KEYS = ("en", "hi", "gu", "translit")
_ASCII_ONLY = re.compile(r"^[\x00-\x7f]+$")

_WEIGHTS = {
    "collect_request_disguised": 1.00,
    "pin_to_receive_money": 1.00,
    "unknown_vpa_payment": 0.50,
    "upi_link_present": 0.15,
}

_COLLECT_ACTIONS = frozenset({"collect", "mandate", "requestpay"})


def _compile_group(group: dict[str, list[str]] | None) -> re.Pattern[str] | None:
    """Compile one context group's term lists and raw regexes into a matcher."""
    if not group:
        return None
    patterns: list[str] = []
    for key in _TERM_KEYS:
        for term in group.get(key, []):
            body = r"\s+".join(re.escape(word) for word in term.split())
            patterns.append(
                rf"(?<!\w){body}(?:s|ed)?(?!\w)" if _ASCII_ONLY.match(term) else rf"(?<!\w){body}"
            )
    for raw in group.get("patterns", []):
        try:
            re.compile(raw)
        except re.error as exc:
            logger.warning("upi context pattern invalid pattern=%r error=%s", raw, exc)
            continue
        patterns.append(raw)
    if not patterns:
        return None
    try:
        return re.compile("|".join(patterns), re.IGNORECASE | re.UNICODE)
    except re.error as exc:
        logger.warning("upi context group failed to compile error=%s", exc)
        return None


@dataclass(frozen=True, slots=True)
class UpiIntent:
    raw: str
    action: str
    vpa: str | None
    payee_name: str | None
    amount: str | None
    note: str | None

    @property
    def is_collect(self) -> bool:
        return self.action.lower() in _COLLECT_ACTIONS


def _first(params: dict[str, list[str]], key: str) -> str | None:
    values = params.get(key)
    return unquote(values[0]) if values else None


def parse_upi_intents(text: str) -> list[UpiIntent]:
    intents: list[UpiIntent] = []
    for match in _UPI_LINK_RE.finditer(text):
        params = parse_qs(match.group("query"), keep_blank_values=False)
        intents.append(
            UpiIntent(
                raw=match.group(0),
                action=match.group("action"),
                vpa=_first(params, "pa"),
                payee_name=_first(params, "pn"),
                amount=_first(params, "am"),
                note=_first(params, "tn"),
            )
        )
    return intents


class UpiAnalyzer:
    """Detects the UPI traps that cost first-time users the most money.

    The central one: a UPI PIN authorises money leaving your account. Any message
    that pairs a promise of incoming money with a PIN entry or an approval prompt
    is inverting that fact, and is treated as a top-weight signal.
    """

    def __init__(self, config: dict) -> None:
        self.receive_claim = _compile_group(config.get("receive_claims"))
        self.pin_instruction = _compile_group(config.get("pin_instructions"))
        self.collect_instruction = _compile_group(config.get("collect_instructions"))
        self.known_handles: frozenset[str] = frozenset(
            handle.lower().lstrip("@") for handle in config.get("known_handles", [])
        )

    @classmethod
    def from_file(cls, path: Path) -> UpiAnalyzer:
        analyzer = cls(load_json_config(path))
        logger.info("upi context loaded handles=%d", len(analyzer.known_handles))
        return analyzer

    def analyze(self, text: str) -> list[UpiFlag]:
        intents = parse_upi_intents(text)
        mentioned_vpa = next(iter(_VPA_RE.findall(text)), None)
        claims_incoming = self._matches(self.receive_claim, text)
        asks_for_pin = self._matches(self.pin_instruction, text)
        asks_to_approve = self._matches(self.collect_instruction, text)
        has_collect_intent = any(intent.is_collect for intent in intents)

        flags: list[UpiFlag] = []

        if claims_incoming and asks_for_pin:
            flags.append(
                self._flag(
                    "pin_to_receive_money",
                    "The message promises you money and then asks for your UPI PIN. "
                    "A PIN only ever sends money out of your account.",
                    intents,
                    mentioned_vpa,
                )
            )

        if claims_incoming and (has_collect_intent or asks_to_approve):
            flags.append(
                self._flag(
                    "collect_request_disguised",
                    "This is a request to take money from your account, dressed up as money coming in. "
                    "Approving it pays them.",
                    intents,
                    mentioned_vpa,
                )
            )

        if not flags:
            for intent in intents:
                if self._is_unknown_payee(intent):
                    flags.append(
                        self._flag(
                            "unknown_vpa_payment",
                            "The link pays a UPI address that is not a recognised payment provider.",
                            [intent],
                        )
                    )
                    break

        if not flags and intents:
            flags.append(
                self._flag(
                    "upi_link_present",
                    "The message contains a payment link. Check the name and the "
                    "direction in your app before approving.",
                    intents,
                )
            )

        return flags

    def _is_unknown_payee(self, intent: UpiIntent) -> bool:
        if intent.is_collect:
            return True
        if not intent.vpa or "@" not in intent.vpa:
            return False
        handle = intent.vpa.rsplit("@", 1)[1].lower()
        return bool(self.known_handles) and handle not in self.known_handles

    @staticmethod
    def _matches(pattern: re.Pattern[str] | None, text: str) -> bool:
        return pattern is not None and pattern.search(text) is not None

    @staticmethod
    def _flag(
        reason: str, detail: str, intents: list[UpiIntent], mentioned_vpa: str | None = None
    ) -> UpiFlag:
        intent = intents[0] if intents else None
        return UpiFlag(
            reason=reason,
            detail=detail,
            weight=_WEIGHTS[reason],
            vpa=(intent.vpa if intent else None) or mentioned_vpa,
            amount=intent.amount if intent else None,
        )
