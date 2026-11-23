# Compliance notes: texting, call recording, AI disclosure

Not legal advice. These are the rules the code enforces today and the steps only the owner can take.
A telecom lawyer should read this before the first paying customer goes live (STARSHIP
`OPS/rd/TRECEPTIONEST-SPEC-2026-11-21.md` section 8 says the same).

## 1. US texting (SMS)

### What the code does
| Rule | Where | Test |
|---|---|---|
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT, "opt out" (whole message, any case) and plain phrases such as "stop texting me" opt the number out of **that business's** texts | `src/sms.js` `classifyKeyword` | `test/sms.test.js` golden cases |
| One opt-out confirmation, then silence; later texts from that number get no reply and never reach the AI | `src/messaging.js` | "STOP: one confirmation..." |
| START / UNSTOP / YES re-subscribe only a number that is opted out ("Yes" from anyone else is a normal message) | `src/messaging.js` | same test |
| HELP / INFO reply names the business, a contact, "Msg & data rates may apply" and STOP | `src/sms.js` `helpReply` | "HELP answers..." |
| First AI reply to a new number ends with "(Automated assistant. Reply STOP to opt out.)" | `src/messaging.js` | "a normal text is triaged..." |
| Every outbound text (reply, missed-call text-back, approved draft) is checked against the opt-out list at send time | `src/sms.js` `mayText`, `approveDraft` | "approving a draft re-checks STOP..." |
| Texts only to full valid US numbers; masked/blocked callers get nothing | `normalizeE164` | golden cases |
| While a business has `liveSms: false` (the default) only the owner's own numbers can be texted; everything else is a draft for the owner | `mayText` | "mayText..." |
| Missed-call text-back: at most one per caller per day, from the business's own template, and every template must contain "STOP" | `createTextbackDraft`, `validateTemplate` | "missed-call text-back drafts..." |
| Opt-outs and opt-ins are written to `consent_log` with time and keyword | `src/store.js` | STOP test |

Known gaps: `CANCEL` and `END` are CTIA opt-out words, so a customer who texts only "Cancel" to cancel an
appointment is opted out (the confirmation tells them how to resubscribe). There is no quiet-hours rule for
texts yet; replies only go to people who texted first, and text-backs are drafts the owner sends by hand.

### A2P 10DLC (owner-only steps)
US carriers block or filter business texts sent from ordinary 10-digit numbers unless the sender is registered
through The Campaign Registry (TCR). Through Telnyx this is done in Mission Control (Messaging > 10DLC):

1. **Brand** registration for CRTC LLC (needs the legal name and EIN exactly as on IRS records; the 2026-11-23
   money audit notes 10DLC needs the EIN).
2. **Campaign** registration per use case. For this product: "Customer Care" (replies to people who contacted the
   business) and, if text-backs are used, a missed-call follow-up description. The sample messages should be the
   templates in `tenants/*.json`. Opt-in description: "the customer texts or calls the business first".
3. Assign the Telnyx number(s) to the campaign, then set `TELNYX_MESSAGING_PROFILE_ID`.
4. For each client business that texts from its own number, that business is its own brand (its EIN) unless the
   lawyer and Telnyx agree on another structure. Do not turn on `liveSms` for a client until its campaign is approved.

Fees for brand, vetting and campaigns are charged by TCR/carriers through Telnyx; check Telnyx's 10DLC pricing page
before registering (amounts were not checked in this session). Toll-free numbers use a separate verification process
and are an alternative to 10DLC.

## 2. Call recording

- **Recording is OFF.** This service never emits a `<Record>` verb and Conversation Relay is used for live speech
  only. The prototype's fallback TeXML also records nothing.
- A business can only set `recording.enabled: true` together with an announcement that contains the word
  "record"; `normalizeTenant` refuses anything else (test: "tenant config: recording needs an announcement").
  When on, the announcement is spoken in the greeting, before the caller says anything.
- South Carolina is a one-party-consent state (S.C. Code 17-30-30, per STARSHIP
  `OPS/rd/AUTOMATIONS-TO-SELL-2026-11-21.md`), but callers from all-party-consent states (for example California,
  Florida, Washington) may call a SC business, so the rule here is: announce on every call whenever recording is on.
- Transcripts are stored in SQLite (`messages` table) even with recording off. The owner still needs to set a
  retention period and a privacy notice (open item from the original prototype README).

## 3. AI disclosure

- Every greeting says "I'm the automated assistant" (`greetingFor`), and the model's rules say it must never claim
  to be human. The first SMS reply carries "(Automated assistant...)".
- The receptionist does not place outbound calls. Outbound AI-voice calls fall under the FCC's rule that AI voices
  are "artificial" voices under the TCPA (prior express consent needed); do not add outbound calling without a
  lawyer read.

## 4. Caller data and the Claude API

With `AI_BACKEND=claude`, what callers say and text is sent to Anthropic's API to generate replies, labels and
summaries. That replaces the earlier "never uses cloud LLM" statement for this backend. The privacy notice for
clients must say so. Key handling: `ANTHROPIC_API_KEY` comes from the environment only and is never logged.
