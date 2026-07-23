# Simulator personas

Each JSON file here is one scam persona for the DhanRakshak practice simulator:
`digital_arrest.json`, `fake_kyc.json`, `lottery.json`, `loan_app.json`.

File shape: `id` matches the filename; `title` and `opening` are per language (`en`, `hi`, `gu`);
`tactics` lists the canonical tactic names the persona shows. `system_prompt` (English) makes an
LLM role-play the scammer for one session - it caps message length, forbids breaking character,
and forbids ever asking for or accepting real personal data.

`scripted_turns` holds exactly five scammer lines per language and is the no-LLM fallback path:
when no model is reachable the session walks these lines in order, so each line makes sense
without knowing the learner's reply. `closing` is the final line when the call ends.

`evaluation.good` and `evaluation.bad` score the learner's replies: each entry has a `weight`
(score delta), Python `re` `patterns` matched case-insensitively, a `tactic_revealed` (canonical
tactic name or null), and a `tip` in all three languages. `neutral_tip` is used when nothing
matched. A persona pressures the learner but never requests real credentials, and no reply text
is stored. This is seed content: add personas by copying the shape above.
