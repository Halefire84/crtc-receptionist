# CRTC AI Receptionist

A CRTC AI receptionist product for local service businesses. The voice prototype uses Telnyx for telephony, speech recognition and speech synthesis, while CRTC's local Ollama model handles reasoning and business logic.

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

The new `voice-server/` prototype adds:
- Telnyx TeXML voice webhook.
- Telnyx Conversation Relay WebSocket.
- Local Ollama/Qwen reasoning.
- SQLite call, transcript and lead persistence.
- Basic sales/support/urgent intent classification.
- Automated tests and local setup documentation.

## Privacy and service model

The voice product is **not fully on-device**: Telnyx necessarily carries the telephone call and performs speech-to-text/text-to-speech. The transcribed text is sent to CRTC's self-hosted local Ollama model for reasoning. The prototype does not enable call recording and does not send transcripts to a cloud LLM. A privacy notice and retention policy must be established before customer production use.

Telnyx Conversation Relay has usage-based pricing, published as starting at $0.05/minute, with carrier voice charges potentially additional. Do not advertise unlimited calls or a flat all-inclusive price until actual carrier, TeXML, speech and relay costs are verified.

## Repository layout

- `voice-server/` — isolated Node.js TeXML / Conversation Relay service.
- Android receptionist application — existing separate repository: [crtc-receptionist-app](https://github.com/Halefire84/crtc-receptionist-app).
- Phone-to-PC bridge — existing separate repository: [phone-api-hub](https://github.com/Halefire84/phone-api-hub).

## Current implementation status

The TeXML/WebSocket service is a prototype only. It has not yet been installed or tested on the CRTC laptop, connected to a Telnyx TeXML application, or exercised on a live call. No production phone routing has been changed.

See [voice-server/README.md](voice-server/README.md) for setup and known blockers.
