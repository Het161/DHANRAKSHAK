from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from app.detection.lexicon import load_json_config
from app.schemas.contracts import UrlFlag

logger = logging.getLogger(__name__)

# Scheme is optional because scam SMS routinely drops it ("sbi-kyc.xyz/verify").
# The trailing label must be alphabetic so that amounts like "Rs.500" are not URLs.
_URL_RE = re.compile(
    r"""(?<![@\w.-])
        (?:(?P<scheme>https?)://)?
        (?P<host>(?:[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+
                 (?P<tld>[a-z]{2,24}))
        (?::(?P<port>\d{2,5}))?
        (?P<path>/[^\s<>"\']*)?""",
    re.IGNORECASE | re.VERBOSE,
)

_IP_URL_RE = re.compile(
    r"""(?<![@\w.-])
        (?:(?P<scheme>https?)://)?
        (?P<host>(?:\d{1,3}\.){3}\d{1,3})
        (?::(?P<port>\d{2,5}))?
        (?P<path>/[^\s<>"']*)?""",
    re.IGNORECASE | re.VERBOSE,
)

# Enough of the public suffix list to get Indian registrable domains right
# without taking a dependency that refreshes itself over the network.
_MULTI_PART_SUFFIXES = frozenset(
    {
        "co.in",
        "net.in",
        "org.in",
        "gen.in",
        "firm.in",
        "ind.in",
        "gov.in",
        "nic.in",
        "ac.in",
        "edu.in",
        "res.in",
        "co.uk",
        "org.uk",
        "com.au",
        "co.jp",
        "com.sg",
        "com.br",
        "com.np",
    }
)

# Sentence punctuation clings to the end of a URL written in free text.
_TRAILING_PUNCTUATION = ".,;:!?)]}'\"।"

_BANKISH_TOKENS = ("bank", "upi", "kyc", "netbank", "pay")
_MIN_EDIT_DISTANCE_LABEL = 4

_WEIGHTS = {
    "lookalike_domain": 0.90,
    "apk_download_link": 0.85,
    "ip_literal_url": 0.80,
    "punycode_domain": 0.70,
    "insecure_bank_page": 0.60,
    "suspicious_tld": 0.50,
    "url_shortener": 0.45,
    "excessive_subdomains": 0.35,
}


def _levenshtein_within(a: str, b: str, limit: int) -> int | None:
    """Edit distance, abandoning the computation once it cannot beat `limit`."""
    if abs(len(a) - len(b)) > limit:
        return None
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        if min(current) > limit:
            return None
        previous = current
    return previous[-1] if previous[-1] <= limit else None


def registrable_domain(host: str) -> str:
    labels = host.lower().strip(".").split(".")
    if len(labels) < 2:
        return host.lower()
    if ".".join(labels[-2:]) in _MULTI_PART_SUFFIXES and len(labels) >= 3:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


@dataclass(frozen=True, slots=True)
class ExtractedUrl:
    raw: str
    scheme: str
    host: str
    tld: str
    path: str
    is_ip_literal: bool


def extract_urls(text: str) -> list[ExtractedUrl]:
    found: list[ExtractedUrl] = []
    seen: set[str] = set()
    for match in _IP_URL_RE.finditer(text):
        octets = match.group("host").split(".")
        if any(int(octet) > 255 for octet in octets):
            continue
        raw = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        if raw.lower() in seen:
            continue
        seen.add(raw.lower())
        found.append(
            ExtractedUrl(
                raw=raw,
                scheme=(match.group("scheme") or "").lower(),
                host=match.group("host"),
                tld="",
                path=(match.group("path") or "").rstrip(_TRAILING_PUNCTUATION),
                is_ip_literal=True,
            )
        )
    for match in _URL_RE.finditer(text):
        raw = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        if raw.lower() in seen:
            continue
        seen.add(raw.lower())
        found.append(
            ExtractedUrl(
                raw=raw,
                scheme=(match.group("scheme") or "").lower(),
                host=match.group("host").lower(),
                tld=match.group("tld").lower(),
                path=(match.group("path") or "").rstrip(_TRAILING_PUNCTUATION),
                is_ip_literal=False,
            )
        )
    return found


class UrlAnalyzer:
    """Offline URL heuristics.

    Nothing here resolves DNS or fetches a page: an analyse request must never
    wait on the network, and visiting a scam URL from the server would be a gift
    to the operator.
    """

    def __init__(self, config: dict) -> None:
        self.official_domains: frozenset[str] = frozenset(config.get("official_domains", []))
        self.official_labels: tuple[str, ...] = tuple(
            sorted({domain.split(".")[0] for domain in self.official_domains})
        )
        self.brand_tokens: tuple[str, ...] = tuple(config.get("brand_tokens", []))
        self.suspicious_tlds: frozenset[str] = frozenset(
            tld.lower().lstrip(".") for tld in config.get("suspicious_tlds", [])
        )
        self.shorteners: frozenset[str] = frozenset(host.lower() for host in config.get("url_shorteners", []))

    @classmethod
    def from_file(cls, path: Path) -> UrlAnalyzer:
        analyzer = cls(load_json_config(path))
        logger.info(
            "url config loaded official=%d brands=%d shorteners=%d",
            len(analyzer.official_domains),
            len(analyzer.brand_tokens),
            len(analyzer.shorteners),
        )
        return analyzer

    def analyze(self, text: str) -> list[UrlFlag]:
        flags: list[UrlFlag] = []
        seen: set[tuple[str, str]] = set()
        for url in extract_urls(text):
            for flag in self._analyze_one(url):
                key = (flag.url, flag.reason)
                if key not in seen:
                    seen.add(key)
                    flags.append(flag)
        flags.sort(key=lambda flag: flag.weight, reverse=True)
        return flags

    def _analyze_one(self, url: ExtractedUrl) -> list[UrlFlag]:
        if url.is_ip_literal:
            return [
                self._flag(
                    url,
                    "ip_literal_url",
                    "The address is a bare number instead of a name. Real banks do not send links like this.",
                )
            ]

        flags: list[UrlFlag] = []
        registrable = registrable_domain(url.host)
        trusted = registrable in self.official_domains

        if url.path.lower().endswith(".apk"):
            flags.append(
                self._flag(
                    url,
                    "apk_download_link",
                    "The link downloads an app file directly instead of sending you to the Play Store.",
                )
            )

        if not trusted:
            if "xn--" in url.host:
                flags.append(
                    self._flag(
                        url,
                        "punycode_domain",
                        "The address uses look-alike foreign characters to imitate a real name.",
                    )
                )
            if (lookalike := self._lookalike_of(url.host, registrable)) is not None:
                flags.append(
                    self._flag(
                        url,
                        "lookalike_domain",
                        f"The address imitates {lookalike} but is not it.",
                    )
                )
            if url.tld in self.suspicious_tlds:
                flags.append(
                    self._flag(
                        url,
                        "suspicious_tld",
                        f"The address ends in .{url.tld}, an ending rarely used by Indian banks.",
                    )
                )
            if registrable in self.shorteners:
                flags.append(
                    self._flag(
                        url,
                        "url_shortener",
                        "The link is shortened, so you cannot see where it really goes.",
                    )
                )
            subdomain_depth = len(url.host.split(".")) - len(registrable.split("."))
            if subdomain_depth > 2:
                flags.append(
                    self._flag(
                        url,
                        "excessive_subdomains",
                        "The real address is buried behind several extra names.",
                    )
                )

        if url.scheme == "http" and self._is_bankish(url.host):
            flags.append(
                self._flag(
                    url,
                    "insecure_bank_page",
                    "A page asking for banking details is not using a secure connection.",
                )
            )
        return flags

    def _is_bankish(self, host: str) -> bool:
        flat = host.replace(".", "").replace("-", "")
        return any(token in flat for token in _BANKISH_TOKENS) or any(
            token in flat for token in self.brand_tokens
        )

    def _lookalike_of(self, host: str, registrable: str) -> str | None:
        flat = host.replace(".", "").replace("-", "")
        for token in self.brand_tokens:
            if token in flat:
                return f"the official {token} website"

        label = registrable.split(".")[0]
        if len(label) < _MIN_EDIT_DISTANCE_LABEL:
            return None
        # Short names tolerate one typo, longer ones two; below four characters
        # the distance is meaningless and produces false positives.
        limit = 1 if len(label) <= 6 else 2
        for official_label in self.official_labels:
            if len(official_label) < _MIN_EDIT_DISTANCE_LABEL or official_label == label:
                continue
            if _levenshtein_within(label, official_label, limit) is not None:
                return official_label
        return None

    @staticmethod
    def _flag(url: ExtractedUrl, reason: str, detail: str) -> UrlFlag:
        return UrlFlag(url=url.raw, reason=reason, detail=detail, weight=_WEIGHTS[reason])
