# CRTC AI Receptionist

A CRTC AI receptionist product for local service businesses. Telnyx carries calls (TeXML + Conversation Relay for speech) and texts (Messaging API v2); the Claude API is the brain (claude-haiku-5-5 for triage and live voice turns, claude-sonnet-5-5 for text replies and owner summaries). The earlier local Ollama path remains as the no-key fallback.

**Current approved CRTC AI pricing:**
- Fast Launch / Starter Site: $499
- E-Commerce & Systems / Full Build: $1,499
- Website Care: $99/month
- AI Workflow Automation: from $3,000 + $99/month
- Brain Pack: $149
- Sentinel Protection: $299
- Appraze: Starter $15/month or $150/year; Pro $30/month

## Product capabilities

The existing Android application provides SMS automation, business profiles, conversation history, booking workflows, missed-call detection, notifications and an operator console.

The `voice-server/` service adds:
- Telnyx TeXML voice webhook and Conversation Relay WebSocket.
- Claude API brain with prompt-injection guards and a per-request token/cost log.
- Per-business (tenant) settings, SMS webhook with STOP/HELP/START handling, per-tenant missed-call text drafts.
- SQLite call, transcript, lead, opt-out, draft and usage persistence; owner/operator API.
- 44 automated tests (fakes only) and setup, compliance and hosting notes.

## Privacy and service model

The voice product is **not fully on-device**: Telnyx necessarily carries the telephone call and performs speech-to-text/text-to-speech. With the Claude backend (the default when `ANTHROPIC_API_KEY` is set), what callers say and text is sent to Anthropic's API to write replies, labels and summaries. Call recording is off. A privacy notice and retention policy must be established before customer production use; see [voice-server/COMPLIANCE.md](voice-server/COMPLIANCE.md).

Telnyx Conversation Relay has usage-based pricing, published as starting at $0.05/minute, with carrier voice charges potentially additional. Do not advertise unlimited calls or a flat all-inclusive price until actual carrier, TeXML, speech and relay costs are verified.

## Repository layout

- `voice-server/` — isolated Node.js TeXML / Conversation Relay service.
- Android receptionist application — existing separate repository: [crtc-receptionist-app](https://github.com/Halefire84/crtc-receptionist-app).
- Phone-to-PC bridge — existing separate repository: [phone-api-hub](https://github.com/Halefire84/phone-api-hub).

## Current implementation status

The service is tested with fakes only. It has not yet been installed on the CRTC laptop, connected to a Telnyx TeXML application or messaging profile, called with a real Claude key, or exercised on a live call or text. No production phone routing has been changed.

See [voice-server/README.md](voice-server/README.md) for setup and known blockers.
