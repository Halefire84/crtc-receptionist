# CRTC AI Receptionist

On-device AI receptionist for local service businesses. No cloud. No per-call fees. No contracts.

**Pricing:** $299 setup + $99/mo flat  
**Powered by:** Starship OS (GPU-trained on-device model)  
**Managed with:** Claude Controller (Android app)

---

## What it does

- Answers calls and texts 24/7 in the business's voice
- Knows prices, hours, services, and service area
- Books appointments or takes messages
- Escalates to the owner when needed (angry caller, emergency, out-of-scope)
- Runs entirely on the client's device — no customer data ever leaves

## Who it's for

Local service businesses with 1–10 employees:
- HVAC companies
- Pool service
- Painting contractors
- Pest control
- Plumbing / electrical
- Pressure washing
- Lawn / landscaping

## Why on-device

Cloud AI receptionists charge per call or per minute. A busy service business in summer takes 300–500 calls/month. At $0.14/min × 2 min avg × 400 calls = $112/mo in call fees alone, plus the plan cost. We're $99 flat. Unlimited.

The privacy angle also sells: "Your customers' names and phone numbers never leave your device."

---

## Repo structure

```
clients/           — one folder per active client, contains their profile.md
profiles/
  templates/       — starter templates by business type
scripts/           — local-forge / Starship OS integration scripts
docs/              — internal product docs
```

## How a client gets set up

See the full runbook at:  
`~/crtc-site/docs/runbooks/RECEPTIONIST-CLIENT-SETUP.md`

Short version:
1. Discovery interview (collect services, hours, FAQ, tone)
2. Build Receptionist Profile via Claude Controller
3. QA with Test Receptionist job
4. Load profile to Starship OS
5. Wire SMS interface via Termux:API
6. Send client handoff email

---

## Related repos

- [claude-controller](https://github.com/Halefire84/claude-controller) — Android app that manages receptionist jobs
- starship-os — GPU model runtime (private)
- starship-llm — model training (private)
