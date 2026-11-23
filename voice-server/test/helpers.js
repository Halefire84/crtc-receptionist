// Test doubles. No test talks to the real Claude or Telnyx APIs.
import { normalizeTenant } from "../src/tenants.js";

export function textResponse(text, { model = "claude-haiku-5-5", input = 100, output = 20, stop = "end_turn" } = {}) {
  return { model, stop_reason: stop, content: [{ type: "text", text }], usage: { input_tokens: input, output_tokens: output } };
}

/** A fake Anthropic client. `reply(params, kind)` returns the response; every call is recorded. */
export function fakeClaude(reply) {
  const calls = [];
  const make = (kind) => ({
    create: async (params) => {
      calls.push({ kind, params: structuredClone(params) });
      const r = await reply(params, kind);
      if (r instanceof Error) throw r;
      return r;
    }
  });
  return { calls, messages: make("messages"), beta: { messages: make("beta") } };
}

/** Default fake: triage -> booking JSON; everything else -> a short line, tagged with the model used. */
export function defaultFake(overrides = {}) {
  return fakeClaude((params) => {
    if (params.output_config?.format) {
      return textResponse(JSON.stringify(overrides.triage ?? { intent: "booking", urgency: "normal", summary: "Wants an AC tune-up next week." }), { model: params.model });
    }
    if (String(params.system).startsWith("Write a plain, factual summary")) {
      return textResponse(overrides.summary ?? "Caller Pat wants an AC tune-up next Tuesday morning. Call back at 843-555-0100.", { model: params.model, input: 400, output: 60 });
    }
    return textResponse(overrides.reply ?? "Happy to help. What day works best? The owner will confirm the time.", { model: params.model });
  });
}

export function memoryUsage() {
  const rows = [];
  return { rows, log: (r) => rows.push(r), monthSpend: () => rows.reduce((s, r) => s + (r.estUsd || 0), 0) };
}

export const testTenant = (over = {}) => normalizeTenant({
  slug: "coastal-hvac",
  businessName: "Coastal Comfort HVAC",
  ownerName: "Mike",
  phoneNumbers: ["+18435550199"],
  ownerNumbers: ["+18435550111"],
  helpContact: "843-555-0111",
  profile: "Services: AC tune-up $89. Hours: Mon-Fri 8-5. Service area: Mount Pleasant, Charleston.",
  ...over
});
