# Hindi and Kannada notice text for the 9 seed purposes

**Status: draft for native-speaker review. Not applied.** Nothing in `shared/seed.ts` has changed yet.

Today the seed puts `[hi] Check your credit eligibility` and `[kn] Check your credit eligibility` in the consent notice, so switching the wallet to Hindi or Kannada (demo Act 1) shows English with a tag in front. This file proposes the real text. The purposes are the ones in `docs/drd.md` §5; the English is exactly what `shared/seed.ts` has today.

## For the reviewer

Please check each Hindi and Kannada cell for:

1. **Same meaning as the English.** Nothing added, nothing dropped. In particular the *sharing* purposes (rows 3, 5, 9) must clearly say the data goes to someone else.
2. **Plain words** a non-expert would use, in the polite "you" form (आप / ನೀವು).
3. **Short enough** to sit under a switch on a phone.
4. **Consistent with the wallet's own screens**, which already use सहमति / ಒಪ್ಪಿಗೆ (consent), उद्देश्य / ಉದ್ದೇಶ (purpose), डेटा / ಡೇಟಾ, कंपनी / ಕಂಪನಿ, साझा / ಹಂಚು (share).

Mark any cell you change; the "Choices to check" list below says where I was least sure.

## The table

| Code | English title | English description | Hindi title | Hindi description | Kannada title | Kannada description |
|---|---|---|---|---|---|---|
| `credit_check` | Credit check | Check your credit eligibility | क्रेडिट जाँच | कर्ज़ के लिए आपकी पात्रता की जाँच करना | ಕ್ರೆಡಿಟ್ ಪರಿಶೀಲನೆ | ಸಾಲಕ್ಕೆ ನಿಮ್ಮ ಅರ್ಹತೆಯನ್ನು ಪರಿಶೀಲಿಸುವುದು |
| `marketing` | Loan offers | Send you loan offers | लोन ऑफ़र | आपको लोन के ऑफ़र भेजना | ಸಾಲದ ಆಫರ್‌ಗಳು | ನಿಮಗೆ ಸಾಲದ ಆಫರ್‌ಗಳನ್ನು ಕಳುಹಿಸುವುದು |
| `bureau_share` | Credit bureau sharing | Share repayment history with credit bureaus | क्रेडिट ब्यूरो से साझा करना | कर्ज़ चुकाने का आपका इतिहास क्रेडिट ब्यूरो के साथ साझा करना | ಕ್ರೆಡಿಟ್ ಬ್ಯೂರೊಗೆ ಹಂಚಿಕೆ | ನೀವು ಸಾಲ ಮರುಪಾವತಿಸಿದ ಇತಿಹಾಸವನ್ನು ಕ್ರೆಡಿಟ್ ಬ್ಯೂರೊಗಳೊಂದಿಗೆ ಹಂಚುವುದು |
| `treatment` | Treatment | Use your records for your treatment | इलाज | आपके इलाज के लिए आपके रिकॉर्ड का उपयोग करना | ಚಿಕಿತ್ಸೆ | ನಿಮ್ಮ ಚಿಕಿತ್ಸೆಗಾಗಿ ನಿಮ್ಮ ದಾಖಲೆಗಳನ್ನು ಬಳಸುವುದು |
| `insurance_claim` | Insurance claims | Share records with your insurer for claims | बीमा दावे | बीमा दावों के लिए आपके रिकॉर्ड आपकी बीमा कंपनी के साथ साझा करना | ವಿಮಾ ಕ್ಲೈಮ್‌ಗಳು | ವಿಮಾ ಕ್ಲೈಮ್‌ಗಾಗಿ ನಿಮ್ಮ ದಾಖಲೆಗಳನ್ನು ನಿಮ್ಮ ವಿಮಾ ಕಂಪನಿಯೊಂದಿಗೆ ಹಂಚುವುದು |
| `research` | Medical research | Use anonymised data for medical research | चिकित्सा अनुसंधान | चिकित्सा अनुसंधान के लिए पहचान हटाए गए डेटा का उपयोग करना | ವೈದ್ಯಕೀಯ ಸಂಶೋಧನೆ | ವೈದ್ಯಕೀಯ ಸಂಶೋಧನೆಗಾಗಿ ಗುರುತು ತೆಗೆದ ಡೇಟಾವನ್ನು ಬಳಸುವುದು |
| `delivery` | Delivery | Use your location to deliver orders | डिलीवरी | ऑर्डर पहुँचाने के लिए आपकी लोकेशन का उपयोग करना | ಡೆಲಿವರಿ | ಆರ್ಡರ್ ತಲುಪಿಸಲು ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಬಳಸುವುದು |
| `ad_targeting` | Personalised ads | Personalise ads from your order history | व्यक्तिगत विज्ञापन | आपके ऑर्डर के इतिहास के आधार पर विज्ञापन दिखाना | ವೈಯಕ್ತಿಕ ಜಾಹೀರಾತುಗಳು | ನಿಮ್ಮ ಆರ್ಡರ್ ಇತಿಹಾಸದ ಆಧಾರದ ಮೇಲೆ ಜಾಹೀರಾತುಗಳನ್ನು ತೋರಿಸುವುದು |
| `partner_share` | Restaurant partners | Share your orders with restaurant partners | रेस्तराँ साझेदार | आपके ऑर्डर की जानकारी रेस्तराँ साझेदारों के साथ साझा करना | ರೆಸ್ಟೋರೆಂಟ್ ಪಾಲುದಾರರು | ನಿಮ್ಮ ಆರ್ಡರ್‌ಗಳ ಮಾಹಿತಿಯನ್ನು ರೆಸ್ಟೋರೆಂಟ್ ಪಾಲುದಾರರೊಂದಿಗೆ ಹಂಚುವುದು |

By company: QuickLoan has the first three, MediCare+ the next three, FoodRush the last three.

## Choices to check

These are the places a reviewer is most likely to want something different.

| Where | What I chose | Why, and the alternative |
|---|---|---|
| "credit eligibility" (row 1) | hi: **कर्ज़ के लिए … पात्रता**; kn: **ಸಾಲಕ್ಕೆ … ಅರ್ಹತೆ** ("eligibility for a loan") | "Credit" alone is vague for a lay reader. Alternative: keep the loanword, "क्रेडिट पात्रता". The *title* keeps the loanword (क्रेडिट जाँच / ಕ್ರೆಡಿಟ್ ಪರಿಶೀಲನೆ) because that is what lenders call it. |
| "credit bureau" (row 3) | Transliterated: **क्रेडिट ब्यूरो**, **ಕ್ರೆಡಿಟ್ ಬ್ಯೂರೊ** | The institutions are known by this name in India. A translated term would be longer and less recognisable. |
| "repayment history" (row 3) | hi: **कर्ज़ चुकाने का … इतिहास**; kn: **ಸಾಲ ಮರುಪಾವತಿಸಿದ ಇತಿಹಾಸ** | Spelled out as "history of paying back the loan" so it is not read as a payment schedule. |
| "anonymised" (row 6) | hi: **पहचान हटाए गए** ("identity removed"); kn: **ಗುರುತು ತೆಗೆದ** | The formal word (अनामित / ಅನಾಮಧೇಯ) is less plain. The meaning matters: it must not read as "secret" or "unknown". |
| "Personalised ads" (row 8) | hi: **व्यक्तिगत विज्ञापन**; kn: **ವೈಯಕ್ತಿಕ ಜಾಹೀರಾತುಗಳು** | Could be read as "private ads". Alternative for Hindi: "आपकी पसंद के विज्ञापन" ("ads to your taste"). The description says what actually happens (ads shown from order history). |
| "your location" (row 7) | hi: **लोकेशन** (loanword); kn: **ಸ್ಥಳ** | Hindi apps use "लोकेशन" almost universally; Kannada apps are more mixed. Say if you prefer स्थान, or ಲೊಕೇಶನ್. |
| Loanwords | लोन, ऑफ़र, ऑर्डर, डिलीवरी, रिकॉर्ड, ಆಫರ್, ಕ್ಲೈಮ್, ಆರ್ಡರ್, ಡೆಲಿವರಿ | Everyday words in both languages and consistent with the wallet's existing strings (लेजर, रिकॉर्ड, एक्सेस). Replace any you think read as too English. |
| Verb form | Descriptions end in a verb noun (करना / ಬಳಸುವುದು), like the English "Use…", "Share…" | The wallet shows them as a plain statement of what the company will do. |
| Kannada spelling | Loanwords carry a zero-width non-joiner before the plural ending (ಆಫರ್‌ಗಳು, ಕ್ಲೈಮ್‌ಗಳು, ಆರ್ಡರ್‌ಗಳ) | Matches how the wallet's own Kannada strings are written (e.g. ಲೆಡ್ಜರ್‌ನಲ್ಲಿ, ಫೋನ್‌ನಲ್ಲೇ). Please keep these characters when editing. |
| `ಹಂಚುವುದು` for "share" | The same verb in all three sharing rows | The wallet already uses ಹಂಚಲಾಗುತ್ತದೆ for "shared with third parties". |

## Not covered here

- **Data categories and retention** (`PAN`, `income`, `12 months of statements`, `phone`, `email`, `repayment history`, `medical records`, `billing`, `anonymised records`, `location`, `order history`) are shown in the notice too and are English-only in the seed today. If they should be translated, that needs a small change to the data model (they are plain strings, not per-language text), so it is a separate decision.
- **The Hindi and Kannada company names** (QuickLoan, MediCare+, FoodRush) are brands and stay as they are.

## When this is approved

1. Put the approved text into the `title` and `description` of the 9 purposes in `shared/src/seed.ts` (today built by `text()` with the `[hi]` / `[kn]` prefix).
2. The notice hash (`docs/drd.md` §4.2) and each purpose's `descHash` on chain are computed from this text, so they change. Run `pnpm demo:reset` (or restart `pnpm demo:up`) after applying; existing consents were signed against the old hash.
3. `pnpm -r test` and `pnpm e2e` should pass unchanged (they recompute the hash from the served text).
