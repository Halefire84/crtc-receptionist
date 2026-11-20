import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildTeXML, buildSystemPrompt, classifyIntent, extractLead } from "./receptionist.js";
import { openStore } from "./store.js";

const defaults = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8789),
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  publicWsUrl: process.env.PUBLIC_WS_URL,
  webhookToken: process.env.TEXML_WEBHOOK_TOKEN,
  ollamaUrl: (process.env.OLLAMA_OPENAI_URL || "http://127.0.0.1:11435/v1").replace(/\/$/, ""),
  model: process.env.OLLAMA_MODEL || "qwen3:4b",
  voice: process.env.TELNYX_VOICE || "Telnyx.Ultra.Callie",
  language: process.env.TELNYX_LANGUAGE || "en",
  transcriptionProvider: process.env.TELNYX_TRANSCRIPTION_PROVIDER || "deepgram",
  maxReplyMs: Number(process.env.AI_TIMEOUT_MS || 18000)
};

export function createVoiceService(options = {}) {
  const config = { ...defaults, ...(options.config || {}) };
  if (process.env.NODE_ENV === "production" && (!config.webhookToken || !config.publicBaseUrl || !config.publicWsUrl)) {
    throw new Error("Production requires TEXML_WEBHOOK_TOKEN, PUBLIC_BASE_URL and PUBLIC_WS_URL");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.json({ limit: "32kb" }));
  const store = options.store || openStore(options.dbPath);
  const fetchImpl = options.fetchImpl || fetch;
  const sessions = new Map();

  function tokenMatches(candidate) {
    if (!config.webhookToken || typeof candidate !== "string") return false;
    const a = Buffer.from(config.webhookToken);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  function requireToken(req, res, next) {
    if (process.env.NODE_ENV !== "production" && !config.webhookToken) return next();
    if (!tokenMatches(String(req.query.token || ""))) return res.sendStatus(403);
    next();
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
    model: config.model,
    ollamaConfigured: Boolean(config.ollamaUrl),
    activeSessions: sessions.size
  }));

  app.all("/texml/voice", requireToken, (_req, res) => {
    try {
      xml(res, buildTeXML({
        publicBaseUrl: config.publicBaseUrl,
        publicWsUrl: config.publicWsUrl,
        webhookToken: config.webhookToken,
        voice: config.voice,
        language: config.language,
        transcriptionProvider: config.transcriptionProvider
      }));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "texml_build_failed", message: error.message }));
      xml(res, fallbackTeXML());
    }
  });

  app.all("/texml/action", requireToken, (_req, res) => {
    // A live transfer destination is intentionally not configured in this prototype.
    xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling CRTC AI. We are unable to complete the request right now. Goodbye.</Say><Hangup/></Response>');
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
          controller: null
        };
        sessions.set(session.sessionId, session);
        store.startCall(session);
        console.log(JSON.stringify({ level: "info", event: "call_setup", sessionId: session.sessionId, direction: session.direction }));
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
      const intent = classifyIntent(userText);
      store.addMessage(session.sessionId, "user", userText, intent);
      const lead = extractLead(userText);
      if (intent !== "general") {
        store.addLead({ sessionId: session.sessionId, caller: session.from, ...lead, intent, summary: userText.slice(0, 1000) });
      }
      try {
        const reply = await askOllama(session);
        if (ws.readyState !== 1) return;
        store.addMessage(session.sessionId, "assistant", reply, intent);
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
      session.controller?.abort();
      sessions.delete(session.sessionId);
      store.endCall(session.sessionId);
      console.log(JSON.stringify({ level: "info", event: "call_closed", sessionId: session.sessionId }));
    });
    ws.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "websocket_error", message: error.message })));
  });

  return { app, server, wss, store, sessions, config };
}

export function startVoiceService() {
  const service = createVoiceService();
  service.server.listen(service.config.port, service.config.host, () => {
    console.log(JSON.stringify({ level: "info", event: "server_started", host: service.config.host, port: service.config.port, model: service.config.model }));
  });
  process.on("SIGTERM", () => {
    for (const session of service.sessions.values()) session.controller?.abort();
    for (const session of service.sessions.values()) service.store.endCall(session.sessionId, "interrupted");
    service.server.close(() => { service.store.close(); process.exit(0); });
  });
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startVoiceService();
}
