"""Fixed sample messages used by both the pytest suite and scripts/check_detection.py.

Every scam sample is a paraphrase of a pattern reported widely in India. Nothing
here is a real user message.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.contracts import Language, Verdict


@dataclass(frozen=True, slots=True)
class Sample:
    id: str
    text: str
    lang: Language
    expect: Verdict
    expect_any_of: tuple[str, ...] = field(default=())


SCAM_SAMPLES: tuple[Sample, ...] = (
    Sample(
        id="en_otp_kyc",
        text=(
            "Dear Customer, your SBI account will be blocked today due to incomplete KYC. "
            "Share the OTP sent on your mobile with our executive immediately to avoid "
            "permanent suspension."
        ),
        lang="en",
        expect="scam",
        expect_any_of=("credential_request", "urgency_threat", "authority_impersonation"),
    ),
    Sample(
        id="hi_digital_arrest",
        text=(
            "मैं CBI अधिकारी बोल रहा हूं। आपके नाम से आए पार्सल में ड्रग्स मिले हैं और मनी लॉन्ड्रिंग "
            "का केस दर्ज है। वीडियो कॉल पर बने रहिए, फोन मत काटिए और किसी को मत बताइए, वरना "
            "गिरफ्तारी होगी। सत्यापन के लिए 50000 रुपये इस खाते में तुरंत जमा करें।"
        ),
        lang="hi",
        expect="scam",
        expect_any_of=("digital_arrest", "authority_impersonation"),
    ),
    Sample(
        id="gu_lottery",
        text=(
            "અભિનંદન! તમે KBC લકી ડ્રોમાં 25 લાખ રૂપિયા જીત્યા છો. ઇનામ મેળવવા માટે પ્રોસેસિંગ ફી "
            "તરીકે 5000 રૂપિયા આજે જ ભરો, નહીંતર તમારું ઇનામ રદ થઈ જશે."
        ),
        lang="gu",
        expect="scam",
        expect_any_of=("prize_bait", "urgency_threat"),
    ),
    Sample(
        id="translit_lookalike_url",
        text=(
            "Aapka SBI account aaj band ho jayega. Turant KYC update karo is link par: "
            "http://sbi-kyc-verify.xyz/update"
        ),
        lang="en",
        expect="scam",
        expect_any_of=("lookalike_domain", "suspicious_tld", "urgency_threat"),
    ),
    Sample(
        id="en_upi_collect_trap",
        text=(
            "Congratulations! A cashback of Rs 5000 will be credited to your account. "
            "To receive the money, approve the request in your app and enter your UPI PIN. "
            "upi://collect?pa=refund.cashback@ybl&pn=Refund&am=5000"
        ),
        lang="en",
        expect="scam",
        expect_any_of=("pin_to_receive_money", "collect_request_disguised"),
    ),
    Sample(
        id="en_loan_app_threat",
        text=(
            "Your loan EMI is overdue. Pay Rs 8000 settlement amount now or our recovery "
            "agent will message all your contacts and share your morphed photos with your family."
        ),
        lang="en",
        expect="scam",
        expect_any_of=("loan_app_threat",),
    ),
)


SAFE_SAMPLES: tuple[Sample, ...] = (
    Sample(
        id="en_genuine_otp_delivery",
        text=(
            "123456 is your OTP for SBI NetBanking login. Valid for 10 minutes. "
            "Never share this OTP with anyone, including bank staff. -SBI"
        ),
        lang="en",
        expect="safe",
    ),
    Sample(
        id="en_genuine_debit_alert",
        text=(
            "Rs.2500.00 debited from A/c XXXX1234 on 12-05-25 to UPI/rajesh@okaxis. "
            "Avl Bal Rs.18340.50. Not you? Call 18001234567."
        ),
        lang="en",
        expect="safe",
    ),
    Sample(
        id="hi_family_message",
        text="बेटा, घर आते समय 500 रुपये का दूध और सब्जी ले आना। शाम तक आ जाना।",
        lang="hi",
        expect="safe",
    ),
    Sample(
        id="gu_salary_credit",
        text="તમારા ખાતામાં પગાર જમા થયો છે. ખાતા નંબર XXXX4321, રકમ 32000 રૂપિયા.",
        lang="gu",
        expect="safe",
    ),
)


ALL_SAMPLES: tuple[Sample, ...] = SCAM_SAMPLES + SAFE_SAMPLES
