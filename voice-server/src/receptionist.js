export const PRICING = [
  "Fast Launch / Starter Site: $499 one-time.",
  "E-Commerce & Systems / Full Build: $1,499 one-time.",
  "Website Care: $99 per month.",
  "AI Workflow Automation: from $3,000 plus $99 per month.",
  "Brain Pack: $149.",
  "Sentinel Protection: $299.",
  "Appraze: Starter $15/month or $150/year; Pro $30/month."
];

export function escapeXml(value = "") {
  return String(value).replace(/[<>&"']/g, (ch) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[ch]);
}

export const DEFAULT_GREETING = "Thank you for calling CRTC AI. I'm the automated assistant. How can I help you?";

export function buildTeXML({ publicBaseUrl, publicWsUrl, webhookToken, voice = "Telnyx.Ultra.Callie", language = "en", transcriptionProvider = "deepgram", greeting = DEFAULT_GREETING }) {
  if (!publicBaseUrl || !publicWsUrl || !webhookToken) {
    throw new Error("PUBLIC_BASE_URL, PUBLIC_WS_URL and TEXML_WEBHOOK_TOKEN are required");
  }
  const base = publicBaseUrl.replace(/\/$/, "");
  const ws = new URL(publicWsUrl);
  if (ws.protocol !== "wss:") throw new Error("PUBLIC_WS_URL must use wss://");
  ws.searchParams.set("token", webhookToken);
  const action = new URL("/texml/action", base);
  action.searchParams.set("token", webhookToken);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${escapeXml(action.toString())}">
    <ConversationRelay
      url="${escapeXml(ws.toString())}"
      voice="${escapeXml(voice)}"
      language="${escapeXml(language)}"
      transcriptionProvider="${escapeXml(transcriptionProvider)}"
      welcomeGreeting="${escapeXml(greeting)}"
      dtmfDetection="true"
    />
  </Connect>
</Response>`;
}

export function classifyIntent(text = "") {
  const s = text.toLowerCase();
  if (/\b(emergency|urgent|danger|fire|police|ambulance|911)\b/.test(s)) return "urgent";
  if (/\b(support|broken|error|not working|existing customer|help with my site)\b/.test(s)) return "support";
  if (/\b(price|pricing|quote|website|automation|app|build|sales|interested)\b/.test(s)) return "sales";
  if (/\b(human|person|owner|manager|call me back|callback)\b/.test(s)) return "handoff";
  return "general";
}

export function extractLead(text = "") {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = text.match(/(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]?\d{4}/)?.[0] ?? null;
  return { email, phone };
}

export function buildSystemPrompt() {
  return [
    "You are the CRTC AI virtual receptionist. Be concise, professional, accurate, and natural over a telephone call.",
    "Identify yourself as CRTC AI's virtual receptionist. Never claim to be human.",
    "CRTC AI provides software development, websites, automation, and related software products. It is not a lawn-care, junk-removal, or resale company.",
    "Approved public pricing:",
    ...PRICING.map((item) => "- " + item),
    "Never invent prices, discounts, availability, appointments, payments, completed work, or callback completion.",
    "Qualify sales leads by asking one question at a time: caller name, business name, what they need, preferred contact method, and timeline.",
    "For support, collect the product/site, problem, impact, and callback details. Do not claim to have fixed anything.",
    "For urgent safety situations, tell the caller to contact local emergency services. Do not attempt to handle emergencies.",
    "If asked for a person, explain you can take a callback request. Do not claim a transfer unless the system confirms one.",
    "Do not request passwords, payment-card numbers, API keys, or other secrets.",
    "Keep responses short enough to speak aloud. Ask one question at a time."
  ].join("\n");
}
