# Hosting: the cheapest self-owned way to run this

Owner policy (2026-11): no Render and no paid hosted backend without the owner's approval. Nothing in this file has
been signed up for, bought or deployed.

## Why a server is needed at all
Telnyx has to reach this service over the internet:
- the TeXML Voice URL (`POST /texml/voice`) when a call comes in,
- the Conversation Relay WebSocket (`wss://.../conversation-relay`) for every spoken turn,
- the messaging webhook (`POST /sms/inbound`) for every text.

A phone-only app cannot accept those, so some always-on machine with a public HTTPS address is required.

## Option A (recommended first): the CRTC laptop + Cloudflare Tunnel — $0 extra
- Run `npm start` on the laptop (binds 127.0.0.1:8789). Add a systemd user service so it restarts on reboot.
- `cloudflared tunnel` publishes `https://receptionist.<owned-domain>` to that port without opening router ports.
  Cloudflare Tunnel has a free tier. crtcai.com already runs on Cloudflare Pages (crtc-site `functions/`), so a
  subdomain there is the likely choice; confirm the DNS zone is in the same Cloudflare account.
- Set `PUBLIC_BASE_URL`, `PUBLIC_WS_URL` to the tunnel hostname, and point the Telnyx TeXML app and messaging
  profile webhooks at it.
- Cost: $0 beyond electricity and the Telnyx/Anthropic usage below.
- Weakness: when the laptop is off or offline (as it is on 2026-11-23), calls get Telnyx's failure behaviour and
  texts are not answered. Set a Telnyx failover (forward to the owner's cell) before giving the number to anyone.
- Exit path: the service is a plain Node process with a SQLite file; it moves to any Linux box by copying the folder
  and `data/receptionist.sqlite`.

## Option B (if always-on is required): a small VPS — needs owner approval (paid)
A 1 vCPU / 1 GB Linux VPS runs this comfortably (one Node process, SQLite). Typical list prices are a few dollars a
month; prices were not checked in this session. Same Cloudflare Tunnel setup; keep secrets in the VPS environment,
not in the repo.

## Usage costs (estimates; check provider pricing pages before relying on them)
| Item | Basis | Status |
|---|---|---|
| Claude, one call of ~6 turns | Haiku 5.5 triage + voice turns (~1.5K input / ~60 output tokens each, $0.10/$0.50 per MTok) + one Sonnet 5.5 summary (~2K in / ~150 out, $2/$10 per MTok) ≈ **$0.01** | Estimate from list prices in the claude-api skill (2026-11-03); thinking tokens bill as output and are not included. `npm run costs` shows the real logged numbers. |
| Claude, one SMS exchange | Haiku triage + Sonnet reply ≈ **$0.004** | same |
| Telnyx Conversation Relay | "from $0.05/minute" per the original prototype README; carrier voice extra | Not re-checked |
| Telnyx number, SMS, voice minutes | per Telnyx pricing page | Not checked |
| 10DLC brand/campaign fees | per Telnyx 10DLC page | Not checked; see COMPLIANCE.md |

Budget guard: `CLAUDE_MONTHLY_BUDGET_USD` (default $20) stops Claude requests when the logged estimate reaches it;
the service then answers with fixed lines and keyword rules. The promo credit ($193.99, expires Dec 4) and the org's
$200/month cap are enforced by Anthropic, not by this service.
