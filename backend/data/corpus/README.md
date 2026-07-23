# Labelled corpus

`labelled.csv` is the DhanRakshak seed corpus for the statistical (Tier-1) classifier.

## Columns

- `text` — the message exactly as a user would receive it, on a single line. Fields are double-quoted; an inner double quote is escaped by doubling it.
- `label` — `scam` or `safe`.
- `lang` — `en`, `hi` (Devanagari), `gu` (Gujarati script), or `translit` (romanized Hinglish/Gujlish, how much real Indian scam SMS is actually written).
- `source` — `seed` for every row here. Rows imported from elsewhere should carry their own source tag so they can be filtered out later.

## What is in it

About 60 percent of rows are `scam`, covering OTP and PIN requests, KYC-expiry links, digital-arrest scripts, prize bait, fake job offers, loan-app harassment, UPI collect requests disguised as incoming money, electricity-disconnection threats, fake customer care, remote-access apps, APK files over WhatsApp, and lookalike bank URLs.

The `safe` rows are the more important half. They are written the way Indian banks and services actually write: sender IDs, `Rs.` amounts, `Avl Bal`, masked accounts like `XXXX4471`, UPI reference numbers, VPAs, EMI reminders, family messages about money. They share nearly all their vocabulary with the scam rows, so a model trained here must learn the scam signal rather than the banking domain.

## Notes

- This is seed data, deliberately small, and meant to be extended.
- At training time it is merged with the public UCI SMS Spam Collection, which supplies English volume; this file supplies the Indian, multilingual and UPI-specific signal.
- No real user message is stored here. Every phone number, account number, UPI reference, tracking ID and link is fictional and written by hand for training.
