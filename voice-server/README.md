# CRTC AI Telnyx Voice Receptionist (prototype)

This isolated Node.js service is the voice adapter for the existing CRTC AI receptionist. It uses Telnyx TeXML to start Conversation Relay, a WebSocket for text-based speech turns, local Ollama for reasoning, and SQLite for call/message/lead persistence.

## Important status

This is an implementation prototype. It has **not** been built or tested on the CRTC laptop, connected to a Telnyx TeXML application, or used on a live call. It does not change phone-number routing. Do not configure a production number until local tests and a controlled test number/call pass.

## Requirements

- Node.js 22.13 or newer (the CRTC laptop has previously reported Node 22.22.1).
- Existing local Ollama OpenAI-compatible endpoint; default is `http://127.0.0.1:11435/v1`.
- `qwen3:4b` available locally.
- A public HTTPS/WSS endpoint for Telnyx to reach. Do not publish or change DNS as part of local development.
- A Telnyx number with voice enabled and a TeXML application with Conversation Relay available.

## Local setup

1. Copy `.env.example` to `.env` and fill local values. Generate a random `TEXML_WEBHOOK_TOKEN`; never commit it.
2. Install dependencies with `npm install`.
3. Run `npm run check` and `npm test`.
4. Start with `npm start`.
5. Check `GET /health`.

The service binds to loopback by default. Public exposure is intentionally not configured here.

## Telnyx flow

1. The TeXML application's Voice URL must point to `/texml/voice?token=...`.
2. The service returns a TeXML `<Connect><ConversationRelay>` document.
3. Telnyx connects to `/conversation-relay?token=...` over WSS and sends a `setup` frame.
4. Final `prompt` frames are sent to the local Ollama OpenAI-compatible endpoint.
5. The generated response is returned in a `text` frame with `last: true`.
6. Calls, transcript messages, and lead summaries are written to SQLite.

The TeXML Voice URL and WebSocket token are separate request paths but share the same high-entropy secret in this prototype. Use a dedicated secret and HTTPS/WSS only.

## Existing CRTC components reused

- The existing Android app's AIClient already targets an OpenAI-compatible local endpoint.
- The existing Android app's business profile, SMS, booking, conversation, and operator-console features remain untouched.
- The existing Termux phone-api-hub remains untouched and continues to serve phone controls, SMS/TTS, and AI-bus functions.

## Known limitations / next engineering tasks

- Confirm Telnyx account feature availability and provision a TeXML application in the portal.
- Validate Telnyx TeXML webhook request behavior and WebSocket session connectivity with a test number.
- Add signed/request-origin verification for inbound TeXML requests if supported by the selected TeXML configuration; the shared webhook token is an interim endpoint guard.
- Add structured operator APIs and connect the Moto G console.
- Add robust callback/handoff routing after the owner supplies and approves a destination.
- Add call idempotency, rate limits, retention controls, SQLite backup/restore, and systemd service files.
- Verify pricing for TeXML, Conversation Relay, STT/TTS, and carrier voice before live use.
- Measure actual local inference latency under concurrent load.

## Privacy and safety

No call recording is enabled. The service stores caller number, transcript text, and extracted contact details locally. Set a retention period before production. It does not collect payment data or secrets. Human transfer is deliberately not enabled. It never uses cloud LLM fallback.
