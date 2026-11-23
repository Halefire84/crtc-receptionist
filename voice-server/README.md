# CRTC AI receptionist service (Telnyx voice + SMS, Claude API brain)

A self-hosted Node.js service that answers a local business's phone line and text messages, takes messages and
appointment requests for the owner, and drafts missed-call texts. Telnyx carries the call (TeXML + Conversation
Relay for speech) and the texts (Messaging API v2). The Claude API is the brain.

## Status (2026-11-23)
Tested here with fakes only: **44 tests pass** (`npm test`, Node 22.23). It has **not** been run against a real
Telnyx account, a real phone call, a real text or the real Claude API (no key in the build container). Nothing is
deployed, no number is bought, and no phone routing was changed. See "Not done" below.

## What it does
| Job | How | State |
|---|---|---|
| Answer calls | TeXML `<Connect><ConversationRelay>`; greeting names the business and says "automated assistant" | Built, simulated-call tested |
| Talk on the call | `claude-haiku-5-5` quick turns (low effort), rules: profile-only facts, never "booked", never human | Built, fake-client tested |
| Triage | `claude-haiku-5-5` structured label: message / booking / urgent / question / complaint / handoff / other; regex safety net for emergencies | Built, tested |
| Take a message / appointment request | Lead row per call or text thread; Sonnet after-call owner summary with numbers masked | Built, tested |
| Answer texts | `/sms/inbound` (Telnyx v2 webhook): STOP/HELP/START first, then triage + `claude-sonnet-5-5` reply | Built, tested |
| Per-business setup | `tenants/<slug>.json`: numbers, owner numbers, templates, recording policy, profile (see `tenants.example/`) | Built, tested |
| Missed-call text-back | Per-tenant template -> DRAFT (never auto-sent); once per caller per day; also `POST /calls/missed` | Built, tested |
| Owner console API | `/operator/leads`, `/operator/costs`, `/operator/<tenant>/drafts` + approve/discard (Bearer `OPERATOR_TOKEN`) | Built, tested (API only, no UI) |
| Claude cost log | One `usage_log` row per request: model, input/output/cache tokens, estimated USD; `npm run costs`; monthly stop `CLAUDE_MONTHLY_BUDGET_USD` | Built, tested |
| Recording | OFF; can only be turned on with a spoken announcement | Enforced in config |

Prompt-injection handling: caller speech and texts only ever go in `user` turns inside an escaped
`<caller_message>` wrapper; the system prompt is identical for every caller; replies that leak the prompt are
replaced; every side effect (opt-out, lead, draft, send) is decided by code, not the model. Tested with six
attack strings in `test/brain.test.js`, plus "add a recipient" in `test/sms.test.js`.

## Run
```bash
cp .env.example .env            # fill locally; .env and tenants/ are git-ignored
mkdir -p tenants && cp tenants.example/coastal-hvac.json tenants/<your-business>.json   # edit it
npm install
npm run check && npm test
npm start                       # 127.0.0.1:8789
curl localhost:8789/health
npm run costs                   # Claude spend logged by this service
```
`ANTHROPIC_API_KEY` must come from the environment / secret store. With no key, `AI_BACKEND` falls back to the
local Ollama path from the first prototype and SMS replies use fixed lines.

## Telnyx wiring (owner steps)
1. Buy/choose a Telnyx number; create a TeXML application whose Voice URL is
   `https://<host>/texml/voice?token=<TEXML_WEBHOOK_TOKEN>`; confirm Conversation Relay is enabled on the account.
2. Create a Messaging Profile with webhook `https://<host>/sms/inbound`; put its public key in `TELNYX_PUBLIC_KEY`
   so webhooks are signature-checked; put an API v2 key in `TELNYX_API_KEY` (secret store only).
3. Register A2P 10DLC before any customer texting (COMPLIANCE.md). Keep `liveSms: false` until then.
4. Hosting: HOSTING.md (laptop + Cloudflare Tunnel, $0 extra).

Owner note (2026-11-21): telephony should be "Telnyx API v2 (SIP, Call Control)". This service uses TeXML +
Conversation Relay (the PR #1 base) for calls, which needs no Call Control commands, and the v2 REST API for SMS.
Moving calls to Call Control or raw SIP would be a separate piece of work.

## Not done / not verified
- No live Telnyx call, text, webhook signature or 10DLC registration. The Ed25519 check follows Telnyx's documented
  `timestamp|body` scheme but has only been tested with locally generated keys.
- No real Claude API request has been made (no key here). Model ids, `output_config`, `fallbacks: "default"` and
  the beta header follow the claude-api skill reference; the first real run should be watched with `npm run costs`
  and the Anthropic Console.
- No calendar: booking requests are requests; the owner confirms. No live transfer to a person.
- No owner UI (API only); no push/SMS alert to the owner for new leads.
- Retention period and privacy notice are owner decisions (COMPLIANCE.md section 2 and 4).
- Resume-plan step 5 (per-tenant SMS drafts, commit f463236 on the laptop) was never pushed to GitHub; it was rebuilt
  here from the plan notes. "Step 6" and the four open decisions from that plan are not in any repo and are not done.
