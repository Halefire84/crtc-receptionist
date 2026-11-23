// Texting: inbound SMS handling, per-tenant SMS drafts (resume-plan step 5, rebuilt), and the Telnyx v2 sender.
//
// Order for one inbound text is fixed in code:
//   1. STOP / HELP / START (no AI; always honoured; one STOP confirmation only)
//   2. an opted-out number gets silence
//   3. triage (Haiku) -> a lead row for messages, booking requests, urgent, complaints, handoff
//   4. reply (Sonnet). Sent only when mayText() allows it (tenant liveSms on, or the owner's own number);
//      otherwise the reply is kept as a DRAFT for the owner to approve.
import { verify, createPublicKey } from "node:crypto";
import {
  classifyKeyword, normalizeKeyword, normalizeE164, stopReply, helpReply, startReply, FIRST_CONTACT_NOTICE,
  mayText, renderTemplate
} from "./sms.js";

const LEAD_INTENTS = new Set(["message", "booking", "urgent", "complaint", "handoff"]);
const MAX_INBOUND = 1600;

export async function handleInboundSms({ tenant, store, brain, from, text, send }) {
  const phone = normalizeE164(from) || String(from || "").slice(0, 32);
  const body = String(text || "").trim().slice(0, MAX_INBOUND);
  const kw = classifyKeyword(body);
  const optedOut = store.isOptedOut(tenant.slug, phone);

  // Compliance replies go straight out: a STOP/HELP answer to someone who just texted us is required, not marketing.
  if (kw === "stop") {
    store.optOut(tenant.slug, phone, normalizeKeyword(body).slice(0, 40) || "phrase");
    if (optedOut) return { action: "opted_out_again", reply: null };
    return { action: "opted_out", reply: stopReply(tenant.businessName), delivery: await deliverDirect(send, phone, stopReply(tenant.businessName)) };
  }
  if (kw === "start" && optedOut) {
    store.optIn(tenant.slug, phone, normalizeKeyword(body));
    return { action: "opted_in", reply: startReply(tenant.businessName), delivery: await deliverDirect(send, phone, startReply(tenant.businessName)) };
  }
  if (kw === "help") {
    const r = helpReply(tenant.businessName, tenant.helpContact || tenant.businessName);
    return { action: "help", reply: r, delivery: await deliverDirect(send, phone, r) };
  }
  if (optedOut) return { action: "ignored_opted_out", reply: null };
  if (!body) return { action: "empty", reply: null };

  const first = store.isNewSmsContact(tenant.slug, phone);
  const history = store.smsHistory(tenant.slug, phone);
  store.addSms(tenant.slug, phone, "user", body);

  const sessionId = `sms:${tenant.slug}:${phone}`;
  const label = await brain.triage(body, { sessionId });
  if (LEAD_INTENTS.has(label.intent)) {
    store.startCall({ sessionId, from: phone, to: null, direction: "sms" });
    store.setCallTenant(sessionId, tenant.slug);
    store.addLead({ sessionId, caller: phone, intent: label.intent, summary: label.summary || body.slice(0, 200) });
  }

  let reply = await brain.smsReply(tenant, history, body, { sessionId });
  if (first) reply += FIRST_CONTACT_NOTICE;
  store.addSms(tenant.slug, phone, "assistant", reply);
  const delivery = await sendOrDraft({ tenant, store, to: phone, kind: "reply", body: reply, send });
  return { action: "replied", reply, intent: label.intent, urgency: label.urgency, delivery };
}

async function deliverDirect(send, to, body) {
  if (!send || !normalizeE164(to)) return { action: "not_sent", reason: "no SMS sender configured" };
  const r = await send(to, body);
  return { action: r.ok ? "sent" : "failed", detail: r.detail };
}

/** Send now if every rule allows it and a sender exists; otherwise keep a draft (or skip, with the reason). */
export async function sendOrDraft({ tenant, store, to, kind, body, send }) {
  const check = mayText(tenant, store, to);
  if (!check.ok) {
    if (check.reason.startsWith("live texting is off")) {
      const id = store.addDraft(tenant.slug, normalizeE164(to), kind, body, "draft", check.reason);
      return { action: "drafted", draftId: id, reason: check.reason };
    }
    return { action: "skipped", reason: check.reason };
  }
  if (!send) {
    const id = store.addDraft(tenant.slug, check.to, kind, body, "draft", "no SMS sender configured");
    return { action: "drafted", draftId: id, reason: "no SMS sender configured" };
  }
  const r = await send(check.to, body);
  store.addDraft(tenant.slug, check.to, kind, body, r.ok ? "sent" : "failed", r.detail);
  return { action: r.ok ? "sent" : "failed", detail: r.detail };
}

/** Missed call (or a call that ended with nothing captured) -> a text-back DRAFT from the tenant's template. */
export function createTextbackDraft({ tenant, store, caller, kind = "missed_call" }) {
  const to = normalizeE164(caller);
  if (!to) return { action: "skipped", reason: "number is not a full valid US number (masked or missing)" };
  if (store.textbackToday(tenant.slug).has(to)) return { action: "skipped", reason: "already texted (or drafted) today" };
  if (store.isOptedOut(tenant.slug, to)) return { action: "skipped", reason: "opted out (STOP)" };
  const body = renderTemplate(tenant.templates[kind], tenant);
  const id = store.addDraft(tenant.slug, to, kind, body);
  return { action: "drafted", draftId: id, body };
}

/** Owner approves a draft: every rule is checked again at send time (a STOP may have arrived since). */
export async function approveDraft({ tenant, store, id, send, ownerOverride = false }) {
  const d = store.draft(tenant.slug, id);
  if (!d) return { action: "not_found" };
  if (d.status !== "draft") return { action: "refused", reason: `draft is already ${d.status}` };
  // Owner approval counts as the human in the loop, but STOP and number validity still always apply.
  const check = mayText(ownerOverride ? { ...tenant, liveSms: true } : tenant, store, d.to_phone);
  if (!check.ok) {
    store.setDraftStatus(tenant.slug, id, "skipped", check.reason);
    return { action: "skipped", reason: check.reason };
  }
  if (!send) return { action: "refused", reason: "no SMS sender configured (TELNYX_API_KEY / TELNYX_MESSAGING_FROM)" };
  const r = await send(check.to, d.body);
  store.setDraftStatus(tenant.slug, id, r.ok ? "sent" : "failed", r.detail);
  if (r.ok) store.addSms(tenant.slug, check.to, "assistant", d.body);
  return { action: r.ok ? "sent" : "failed", detail: r.detail };
}

export function discardDraft({ tenant, store, id }) {
  const d = store.draft(tenant.slug, id);
  if (!d) return { action: "not_found" };
  if (d.status !== "draft") return { action: "refused", reason: `draft is already ${d.status}` };
  store.setDraftStatus(tenant.slug, id, "discarded", "owner discarded");
  return { action: "discarded" };
}

/**
 * Telnyx Messaging API v2 sender. Built only when TELNYX_API_KEY and TELNYX_MESSAGING_FROM are set.
 * The key is sent only to api.telnyx.com and never logged. Not exercised against the live API in this repo.
 */
export function telnyxSender({ apiKey, from, messagingProfileId, fetchImpl = fetch }) {
  if (!apiKey || !from) return null;
  return async (to, text) => {
    try {
      const body = { from, to, text };
      if (messagingProfileId) body.messaging_profile_id = messagingProfileId;
      const res = await fetchImpl("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) return { ok: false, detail: `telnyx HTTP ${res.status}` };
      const json = await res.json().catch(() => ({}));
      return { ok: true, detail: `telnyx id ${json?.data?.id ?? "unknown"}` };
    } catch (error) {
      return { ok: false, detail: `telnyx request failed (${error?.name ?? "error"})` };
    }
  };
}

/** Pull from / to / text out of a Telnyx v2 `message.received` webhook body. */
export function parseTelnyxMessage(body) {
  const p = body?.data?.payload;
  if (body?.data?.event_type !== "message.received" || !p) return null;
  return { from: p.from?.phone_number ?? null, to: p.to?.[0]?.phone_number ?? null, text: String(p.text ?? "") };
}

/**
 * Telnyx v2 webhook signature check: Ed25519 over `${timestamp}|${rawBody}`, public key from the Mission Control
 * portal (base64). Rejects timestamps older than toleranceS. Not yet checked against a real Telnyx webhook.
 */
export function verifyTelnyxSignature({ publicKeyB64, signatureB64, timestamp, rawBody, nowS = Date.now() / 1000, toleranceS = 300 }) {
  try {
    if (!publicKeyB64 || !signatureB64 || !timestamp) return false;
    if (Math.abs(nowS - Number(timestamp)) > toleranceS) return false;
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
