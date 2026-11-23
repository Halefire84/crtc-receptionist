import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildTeXML, buildSystemPrompt, classifyIntent, extractLead } from "./receptionist.js";
import { openStore } from "./store.js";
import { createBrain } from "./brain.js";
import { loadTenants, tenantForNumber, greetingFor } from "./tenants.js";
import {
  handleInboundSms, createTextbackDraft, approveDraft, discardDraft, telnyxSender, parseTelnyxMessage,
  verifyTelnyxSignature
} from "./messaging.js";

const defaults = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8789),
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  publicWsUrl: process.env.PUBLIC_WS_URL,
  webhookToken: process.env.TEXML_WEBHOOK_TOKEN,
  operatorToken: process.env.OPERATOR_TOKEN,
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY,
  // "claude" (default when ANTHROPIC_API_KEY is set) or "ollama" (local model, no key)
  aiBackend: process.env.AI_BACKEND || (process.env.ANTHROPIC_API_KEY ? "claude" : "ollama"),
  ollamaUrl: (process.env.OLLAMA_OPENAI_URL || "http://127.0.0.1:11435/v1").replace(/\/$/, ""),
  model: process.env.OLLAMA_MODEL || "qwen3:4b",
  voice: process.env.TELNYX_VOICE || "Telnyx.Ultra.Callie",
  language: process.env.TELNYX_LANGUAGE || "en",
  transcriptionProvider: process.env.TELNYX_TRANSCRIPTION_PROVIDER || "deepgram",
  maxReplyMs: Number(process.env.AI_TIMEOUT_MS || 18000)
};

const LEAD_INTENTS = new Set(["message", "booking", "urgent", "complaint", "handoff", "sales", "support"]);

export function createVoiceService(options = {}) {
  const config = { ...defaults, ...(options.config || {}) };
  if (process.env.NODE_ENV === "production" && (!config.webhookToken || !config.publicBaseUrl || !config.publicWsUrl)) {
    throw new Error("Production requires TEXML_WEBHOOK_TOKEN, PUBLIC_BASE_URL and PUBLIC_WS_URL");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.json({ limit: "64kb", verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  const store = options.store || openStore(options.dbPath);
  const fetchImpl = options.fetchImpl || fetch;
  const tenants = options.tenants || loadTenants();
  const brain = options.brain || createBrain({ usage: store });
  const send = options.send !== undefined ? options.send : telnyxSender({
    apiKey: process.env.TELNYX_API_KEY,
    from: process.env.TELNYX_MESSAGING_FROM,
    messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID
  });
  const useClaude = config.aiBackend === "claude";
  const sessions = new Map();

  function safeEqual(expected, candidate) {
    if (!expected || typeof candidate !== "string") return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const tokenMatches = (candidate) => safeEqual(config.webhookToken, candidate);
  function requireToken(req, res, next) {
    if (process.env.NODE_ENV !== "production" && !config.webhookToken) return next();
    if (!tokenMatches(String(req.query.token || ""))) return res.sendStatus(403);
    next();
  }
  function requireOperator(req, res, next) {
    if (!config.operatorToken) return res.status(403).json({ error: "operator API disabled (OPERATOR_TOKEN not set)" });
    const auth = String(req.get("authorization") || "");
    if (!safeEqual(config.operatorToken, auth.replace(/^Bearer\s+/i, ""))) return res.sendStatus(401);
    next();
  }
  function tenantOr404(req, res) {
    const t = tenants.get(String(req.params.tenant || ""));
    if (!t) res.status(404).json({ error: "no such tenant" });
    return t;
  }
  function xml(res, body) {
    res.status(200).type("application/xml").send(body);
  }
  function fallbackTeXML() {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Our receptionist is unavailable right now. Please call back later. Goodbye.</Say><Hangup/></Response>';
  }

  app.get("/health", (_req, res) => res.json({
    ok: true,
    service: "crtc-texml-receptionist",
    aiBackend: config.aiBackend,
    claude: useClaude ? (brain.enabled() ? "ready" : "unavailable (no key or budget reached)") : "off",
    tenants: [...tenants.keys()],
    smsSender: send ? "telnyx" : "none (drafts only)",
    activeSessions: sessions.size
  }));

  app.all("/texml/voice", requireToken, (req, res) => {
    const dialed = req.body?.To || req.query.To;
    const tenant = tenantForNumber(tenants, dialed);
    try {
      xml(res, buildTeXML({
        publicBaseUrl: config.publicBaseUrl,
        publicWsUrl: config.publicWsUrl,
        webhookToken: config.webhookToken,
        voice: config.voice,
        language: config.language,
        transcriptionProvider: config.transcriptionProvider,
        greeting: greetingFor(tenant)
      }));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "texml_build_failed", message: error.message }));
      xml(res, fallbackTeXML());
    }
  });

  app.all("/texml/action", requireToken, (_req, res) => {
    // A live transfer destination is intentionally not configured in this prototype.
    xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. We are unable to complete the request right now. Goodbye.</Say><Hangup/></Response>');
  });

  // Inbound SMS: Telnyx Messaging API v2 webhook (JSON). Accepted with a valid Ed25519 signature when
  // TELNYX_PUBLIC_KEY is set, otherwise with the shared ?token=.
  app.post("/sms/inbound", async (req, res) => {
    const signed = config.telnyxPublicKey
      ? verifyTelnyxSignature({
        publicKeyB64: config.telnyxPublicKey,
        signatureB64: req.get("telnyx-signature-ed25519"),
        timestamp: req.get("telnyx-timestamp"),
        rawBody: req.rawBody || ""
      })
      : tokenMatches(String(req.query.token || "")) || (process.env.NODE_ENV !== "production" && !config.webhookToken);
    if (!signed) return res.sendStatus(403);
    const msg = parseTelnyxMessage(req.body);
    if (!msg) return res.status(200).json({ ignored: true });
    try {
      const tenant = tenantForNumber(tenants, msg.to);
      const result = await handleInboundSms({ tenant, store, brain, from: msg.from, text: msg.text, send });
      res.status(200).json({ action: result.action, delivery: result.delivery?.action ?? null });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "sms_inbound_failed", message: error.message }));
      res.status(200).json({ action: "error" }); // 200 so the provider does not retry into a loop
    }
  });

  // A missed call reported by another source (e.g. the Android app or a forwarding rule).
  app.post("/calls/missed", requireToken, (req, res) => {
    const tenant = tenantForNumber(tenants, req.body?.to);
    res.json(createTextbackDraft({ tenant, store, caller: req.body?.from, kind: req.body?.afterHours ? "after_hours" : "missed_call" }));
  });

  // Operator API (Bearer OPERATOR_TOKEN): leads, drafts, approve/discard, Claude cost log.
  app.get("/operator/leads", requireOperator, (_req, res) => res.json({ leads: store.leads() }));
  app.get("/operator/costs", requireOperator, (_req, res) => res.json({
    monthSpendUsd: store.monthSpend(), totals: store.usageTotals(), recent: store.usageRows(50)
  }));
  app.get("/operator/:tenant/drafts", requireOperator, (req, res) => {
    const t = tenantOr404(req, res);
    if (t) res.json({ tenant: t.slug, liveSms: t.liveSms, drafts: store.drafts(t.slug, req.query.status || null) });
  });
  app.post("/operator/:tenant/drafts/:id/approve", requireOperator, async (req, res) => {
    const t = tenantOr404(req, res);
    if (!t) return;
    const r = await approveDraft({ tenant: t, store, id: Number(req.params.id), send, ownerOverride: true });
    res.status(r.action === "not_found" ? 404 : 200).json(r);
  });
  app.post("/operator/:tenant/drafts/:id/discard", requireOperator, (req, res) => {
    const t = tenantOr404(req, res);
    if (!t) return;
    const r = discardDraft({ tenant: t, store, id: Number(req.params.id) });
    res.status(r.action === "not_found" ? 404 : 200).json(r);
  });

  async function askOllama(session) {
    const controller = new AbortController();
    session.controller?.abort();
    session.controller = controller;
    const timer = setTimeout(() => controller.abort(), config.maxReplyMs);
    try {
      // The current caller turn is persisted before this function is called.
      const messages = [
        { role: "system", content: buildSystemPrompt() },
        ...store.history(session.sessionId, 12)
      ];
      const response = await fetchImpl(config.ollamaUrl + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: config.model, messages, temperature: 0.3, max_tokens: 180, stream: false }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Ollama HTTP " + response.status);
      const payload = await response.json();
      const reply = payload.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("Ollama returned an empty response");
      return reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "I can take a message and arrange a callback. What is the best number to reach you?";
    } finally {
      clearTimeout(timer);
      if (session.controller === controller) session.controller = null;
    }
  }

  async function askClaude(session) {
    const controller = new AbortController();
    session.controller?.abort();
    session.controller = controller;
    try {
      return await brain.voiceTurn(session.tenant, store.history(session.sessionId, 12),
        { sessionId: session.sessionId, signal: controller.signal });
    } finally {
      if (session.controller === controller) session.controller = null;
    }
  }

  async function afterCall(session) {
    const history = store.history(session.sessionId, 40);
    const callerSpoke = history.some((m) => m.role === "user");
    if (!callerSpoke) {
      // Hung up before saying anything: draft a text-back from this business's template (never auto-sent).
      createTextbackDraft({ tenant: session.tenant, store, caller: session.from });
      return;
    }
    if (useClaude && store.leadCount(session.sessionId) > 0) {
      const summary = await brain.summarize(history, { sessionId: session.sessionId });
      if (summary) store.setOwnerSummary(session.sessionId, summary);
    }
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { socket.destroy(); return; }
    if (url.pathname !== "/conversation-relay" || !tokenMatches(url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (ws) => {
    let session = null;
    ws.on("message", async (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { ws.close(1003, "Invalid JSON"); return; }
      if (frame.type === "setup") {
        if (!frame.sessionId) { ws.close(1008, "Missing session id"); return; }
        session = {
          sessionId: String(frame.sessionId).slice(0, 128),
          callSid: frame.callSid,
          from: frame.from,
          to: frame.to,
          direction: frame.direction || "inbound",
          tenant: tenantForNumber(tenants, frame.to),
          controller: null
        };
        sessions.set(session.sessionId, session);
        store.startCall(session);
        store.setCallTenant(session.sessionId, session.tenant.slug);
        console.log(JSON.stringify({ level: "info", event: "call_setup", sessionId: session.sessionId, tenant: session.tenant.slug }));
        return;
      }
      if (!session) { ws.close(1008, "Setup frame required"); return; }
      if (frame.type === "interrupt" || frame.type === "turnResumed") {
        session.controller?.abort();
        return;
      }
      if (frame.type === "dtmf") {
        if (frame.digit === "0" && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "text", token: "I can take a callback request. What is your name and the best number to reach you?", last: true }));
        }
        return;
      }
      if (frame.type !== "prompt" || frame.last !== true) return;
      const userText = String(frame.voicePrompt || "").trim().slice(0, 2000);
      if (!userText) return;
      const label = useClaude
        ? await brain.triage(userText, { sessionId: session.sessionId })
        : { intent: classifyIntent(userText), summary: userText.slice(0, 1000) };
      store.addMessage(session.sessionId, "user", userText, label.intent);
      const lead = extractLead(userText);
      if (LEAD_INTENTS.has(label.intent)) {
        store.addLead({ sessionId: session.sessionId, caller: session.from, ...lead, intent: label.intent, summary: (label.summary || userText).slice(0, 1000) });
      }
      try {
        const reply = useClaude ? await askClaude(session) : await askOllama(session);
        if (reply === null || ws.readyState !== 1) return; // interrupted
        store.addMessage(session.sessionId, "assistant", reply, label.intent);
        ws.send(JSON.stringify({ type: "text", token: reply, last: true }));
      } catch (error) {
        if (error.name === "AbortError") return;
        console.error(JSON.stringify({ level: "error", event: "ai_reply_failed", sessionId: session.sessionId, message: error.message }));
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "text", token: "I'm having trouble accessing our receptionist system. I can take your name and number for a callback. What is the best way to reach you?", last: true }));
        }
      }
    });
    ws.on("close", () => {
      if (!session) return;
      const ended = session;
      ended.controller?.abort();
      sessions.delete(ended.sessionId);
      store.endCall(ended.sessionId);
      console.log(JSON.stringify({ level: "info", event: "call_closed", sessionId: ended.sessionId }));
      service.pending = afterCall(ended).catch((error) =>
        console.error(JSON.stringify({ level: "error", event: "after_call_failed", message: error.message })));
    });
    ws.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "websocket_error", message: error.message })));
  });

  const service = { app, server, wss, store, sessions, config, brain, tenants, pending: Promise.resolve() };
  return service;
}

export function startVoiceService() {
  const service = createVoiceService();
  service.server.listen(service.config.port, service.config.host, () => {
    console.log(JSON.stringify({ level: "info", event: "server_started", host: service.config.host, port: service.config.port, aiBackend: service.config.aiBackend }));
  });
  process.on("SIGTERM", () => {
    for (const session of service.sessions.values()) session.controller?.abort();
    for (const session of service.sessions.values()) service.store.endCall(session.sessionId, "interrupted");
    for (const client of service.wss.clients) client.close(1001, "Server shutting down");
    service.server.close(() => { service.store.close(); process.exit(0); });
  });
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startVoiceService();
}
