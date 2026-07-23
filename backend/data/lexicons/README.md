# Lexicons

One JSON file per tactic. The filename is always the tactic name, and the tactic
name inside the file must match one of the seven canonical tactics.

There are two shapes.

- `"type": "lexicon"` (simple): a `terms` object keyed by `en`, `hi`, `gu` and
  `translit`, plus an optional `patterns` array. A hit on any term or any pattern
  fires the rule once. Used by `urgency_threat`, `authority_impersonation`,
  `credential_request`, `prize_bait`, `remote_access_tool`.
- `"type": "composite"`: a `groups` array of named concept groups, each with its
  own `terms` object, plus `min_groups`. The rule fires only when at least
  `min_groups` distinct groups are hit in the same message. Used by
  `digital_arrest` and `loan_app_threat`, where a single word proves nothing but
  the co-occurrence is decisive.

`weight` is the rule's contribution to the fused risk score, from 0.0 to 1.0. It
is the confidence that a hit on this tactic alone means the message is a scam, so
`credential_request` (0.95) can carry a verdict by itself while `urgency_threat`
(0.5) is only a supporting signal. Fusion combines the fired rules' weights with
the classifier probability and the URL and UPI checks; it does not simply add.

Matching contract: terms are lowercase and are matched as case-insensitive
substrings. `patterns` are Python `re` regexes compiled with `re.IGNORECASE`, and
`translit` covers romanized Hinglish and Gujlish, including the misspellings that
appear in real scam SMS.

Precision beats recall here. A term that also appears in a genuine bank message
is a bug, because a tool that cries wolf gets ignored. That is why bare words like
"bank", "account" or "otp" never appear on their own: `credential_request` matches
the request ("send me the OTP", "otp batao"), never the delivery ("123456 is your
OTP, never share it with anyone").

This is seed content. It is meant to be extended as new scam scripts appear;
add terms in all four keys when you do, and keep new patterns narrow.
