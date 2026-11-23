// US texting rules that run BEFORE any AI: STOP / HELP / START keywords and number checks.
// Pure functions (no I/O) so the same golden cases can be ported to Android/Windows later.
// Not legal advice; see ../COMPLIANCE.md.

// CTIA opt-out keywords plus REVOKE/OPTOUT. The FCC revocation rule asks businesses to honour any reasonable
// wording, so plain-English opt-out phrases count too.
export const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT"]);
export const HELP_WORDS = new Set(["HELP", "INFO"]);
export const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const STOP_PHRASES = [
  "stop texting", "stop messaging", "stop sending", "do not text", "don't text", "dont text", "remove me",
  "take me off", "unsubscribe me", "leave me alone", "no more texts", "opt me out"
];

export function normalizeKeyword(text = "") {
  return String(text).replace(/[^A-Za-z ]+/g, " ").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
}

/** "stop" | "help" | "start" | null. Opt-out wins over everything else. */
export function classifyKeyword(text = "") {
  const k = normalizeKeyword(text);
  const low = String(text).toLowerCase().split(/\s+/).join(" ");
  if (STOP_WORDS.has(k) || STOP_PHRASES.some((p) => low.includes(p))) return "stop";
  if (HELP_WORDS.has(k)) return "help";
  if (START_WORDS.has(k)) return "start";
  return null;
}

export const stopReply = (business) =>
  `${business}: you are unsubscribed and will get no more texts from us. Reply START to resubscribe.`;
export const helpReply = (business, contact) =>
  `${business}: automated text assistant. For help contact ${contact}. Msg & data rates may apply. Reply STOP to opt out.`;
export const startReply = (business) =>
  `${business}: you are resubscribed to texts. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
export const FIRST_CONTACT_NOTICE = " (Automated assistant. Reply STOP to opt out.)";

/** US/Canada numbers only: "+1XXXXXXXXXX" or null (masked, short, or not a NANP number). */
export function normalizeE164(number) {
  if (typeof number !== "string") return null;
  let d = number.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10 || "01".includes(d[0]) || "01".includes(d[3])) return null;
  return "+1" + d;
}

export const ALLOWED_FIELDS = new Set(["business", "owner", "help_contact"]);

/** A customer-facing template must use known fields only, carry the opt-out line and fit two SMS segments. */
export function validateTemplate(template) {
  if (typeof template !== "string" || !template.trim()) throw new Error("template is empty");
  const unknown = [...template.matchAll(/{([^{}]*)}/g)].map((m) => m[1]).filter((f) => !ALLOWED_FIELDS.has(f));
  if (unknown.length) throw new Error(`template uses unknown fields: ${unknown.join(", ")}`);
  if (!template.includes("STOP")) throw new Error("template must include 'Reply STOP to opt out'");
  if (template.length > 300) throw new Error("template is too long (300 characters max)");
}

export function renderTemplate(template, tenant) {
  validateTemplate(template);
  return template
    .replaceAll("{business}", tenant.businessName)
    .replaceAll("{owner}", tenant.ownerName)
    .replaceAll("{help_contact}", tenant.helpContact || tenant.businessName);
}

/**
 * Every outbound text (draft, reply, or approved draft) passes this. Returns {ok, to} or {ok:false, reason}.
 * While the tenant's liveSms is off, only the owner's own numbers can receive a text.
 */
export function mayText(tenant, store, number) {
  const to = normalizeE164(number);
  if (!to) return { ok: false, reason: "number is not a full valid US number (masked or missing)" };
  if (store.isOptedOut(tenant.slug, to)) return { ok: false, reason: "opted out (STOP)" };
  const owners = new Set((tenant.ownerNumbers || []).map(normalizeE164));
  if (!tenant.liveSms && !owners.has(to)) {
    return { ok: false, reason: "live texting is off for this business: owner's own number only" };
  }
  return { ok: true, to };
}
