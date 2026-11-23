import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createVoiceService } from "../src/server.js";
import { openStore } from "../src/store.js";
import { createBrain } from "../src/brain.js";
import { CRTC_TENANT } from "../src/tenants.js";
import { defaultFake, testTenant } from "./helpers.js";

const TOKEN = "claude-integration-secret";

async function start({ operatorToken, send = null, telnyxPublicKey } = {}) {
  const store = openStore(":memory:");
  const fake = defaultFake({ reply: "Sure. What day works best? Mike will confirm the time." });
  const tenant = testTenant();
  const service = createVoiceService({
    store,
    tenants: new Map([[CRTC_TENANT.slug, CRTC_TENANT], [tenant.slug, tenant]]),
    brain: createBrain({ client: fake, usage: store }),
    send,
    config: {
      aiBackend: "claude",
      publicBaseUrl: "https://voice.example.test",
      publicWsUrl: "wss://voice.example.test/conversation-relay",
      webhookToken: TOKEN,
      operatorToken,
      telnyxPublicKey
    }
  });
  await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
  return { service, fake, store, port: service.server.address().port };
}

async function stop({ service }) {
  await new Promise((resolve) => service.server.close(resolve));
  service.wss.close();
  await service.pending;
  service.store.close();
}

async function waitIdle(service) {
  // the server sees the socket close a moment after the client does; after-call work starts then
  for (let i = 0; i < 200 && service.sessions.size; i++) await new Promise((r) => setTimeout(r, 5));
  await service.pending;
}

async function call(port, { from = "+18435550100", to = "+18435550199", prompts = [], sessionId = "call-1" }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/conversation-relay?token=${TOKEN}`);
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "setup", sessionId, callSid: "c", from, to, direction: "inbound" }));
  const frames = [];
  for (const p of prompts) {
    ws.send(JSON.stringify({ type: "prompt", voicePrompt: p, last: true }));
    const [raw] = await once(ws, "message");
    frames.push(JSON.parse(raw.toString()));
  }
  ws.close();
  await once(ws, "close");
  return frames;
}

test("TeXML greets with the dialed business's name and the automated-assistant disclosure", async () => {
  const rig = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${rig.port}/texml/voice?token=${TOKEN}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "To=%2B18435550199&From=%2B18435550100"
    });
    const xml = await res.text();
    assert.match(xml, /welcomeGreeting="Thanks for calling Coastal Comfort HVAC\. I&apos;m the automated assistant\. How can I help you\?"/);
    assert.doesNotMatch(xml, /<Record/);
  } finally { await stop(rig); }
});

test("a simulated call: Haiku triage + voice turns, a lead, a Sonnet owner summary and a cost row per request", async () => {
  const rig = await start();
  try {
    const frames = await call(rig.port, { prompts: ["Hi, this is Pat. Can someone come out Tuesday for an AC tune-up?"] });
    assert.deepEqual(frames, [{ type: "text", token: "Sure. What day works best? Mike will confirm the time.", last: true }]);
    await waitIdle(rig.service);
    const lead = rig.store.leads()[0];
    assert.equal(lead.intent, "booking");
    assert.equal(lead.tenant, "coastal-hvac");
    assert.match(lead.owner_summary, /Pat/);
    assert.ok(!lead.owner_summary.includes("555-0100"));
    const purposes = rig.store.usageRows().map((r) => `${r.purpose}:${r.model}`).sort();
    assert.deepEqual(purposes, ["summary:claude-sonnet-5-5", "triage:claude-haiku-5-5", "voice_turn:claude-haiku-5-5"]);
    assert.ok(rig.store.monthSpend() > 0);
    const voiceCall = rig.fake.calls.find((c) => c.params.model === "claude-haiku-5-5" && !c.params.output_config.format);
    assert.match(voiceCall.params.system[1].text, /Coastal Comfort HVAC/);
  } finally { await stop(rig); }
});

test("a caller who hangs up without speaking gets a text-back DRAFT, not a sent text", async () => {
  const sent = [];
  const rig = await start({ send: async (to, body) => { sent.push({ to, body }); return { ok: true }; } });
  try {
    await call(rig.port, { prompts: [], sessionId: "silent-1" });
    await waitIdle(rig.service);
    const drafts = rig.store.drafts("coastal-hvac");
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, "draft");
    assert.match(drafts[0].body, /Coastal Comfort HVAC.*Reply STOP to opt out/);
    assert.equal(sent.length, 0);
  } finally { await stop(rig); }
});

test("inbound SMS webhook needs the token (or a Telnyx signature) and drafts the reply", async () => {
  const rig = await start();
  const body = JSON.stringify({ data: { event_type: "message.received", payload: { from: { phone_number: "+18435550100" }, to: [{ phone_number: "+18435550199" }], text: "Do you service Carrier units?" } } });
  try {
    const denied = await fetch(`http://127.0.0.1:${rig.port}/sms/inbound`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(denied.status, 403);
    const ok = await fetch(`http://127.0.0.1:${rig.port}/sms/inbound?token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.deepEqual(await ok.json(), { action: "replied", delivery: "drafted" });
  } finally { await stop(rig); }
  const signed = await start({ telnyxPublicKey: Buffer.alloc(32, 1).toString("base64") });
  try {
    const res = await fetch(`http://127.0.0.1:${signed.port}/sms/inbound?token=${TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json", "telnyx-signature-ed25519": "AAAA", "telnyx-timestamp": String(Math.floor(Date.now() / 1000)) }, body
    });
    assert.equal(res.status, 403, "with a public key configured, a bad signature is refused even with the token");
  } finally { await stop(signed); }
});

test("operator API is off without OPERATOR_TOKEN, refuses a wrong token, and shows drafts and costs", async () => {
  const off = await start();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${off.port}/operator/costs`)).status, 403);
  } finally { await stop(off); }
  const rig = await start({ operatorToken: "op-secret" });
  try {
    const base = `http://127.0.0.1:${rig.port}`;
    assert.equal((await fetch(`${base}/operator/costs`, { headers: { authorization: "Bearer nope" } })).status, 401);
    await fetch(`${base}/calls/missed?token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "+18435550100", to: "+18435550199" }) });
    const auth = { authorization: "Bearer op-secret" };
    const drafts = await (await fetch(`${base}/operator/coastal-hvac/drafts`, { headers: auth })).json();
    assert.equal(drafts.drafts.length, 1);
    const approve = await (await fetch(`${base}/operator/coastal-hvac/drafts/${drafts.drafts[0].id}/approve`, { method: "POST", headers: auth })).json();
    assert.equal(approve.action, "refused", "no SMS provider configured in this test, so nothing is sent");
    assert.equal((await fetch(`${base}/operator/nobody/drafts`, { headers: auth })).status, 404);
    const costs = await (await fetch(`${base}/operator/costs`, { headers: auth })).json();
    assert.equal(typeof costs.monthSpendUsd, "number");
    assert.ok(Array.isArray(costs.totals));
  } finally { await stop(rig); }
});
