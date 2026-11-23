// Per-business (tenant) settings. One JSON file per business in TENANTS_DIR (default ./tenants, git-ignored);
// see tenants.example/ for the format. A call or text is routed to the tenant that owns the dialed number;
// anything unmatched goes to the built-in "crtc" tenant (CRTC AI's own line).
import fs from "node:fs";
import path from "node:path";
import { normalizeE164, validateTemplate } from "./sms.js";
import { PRICING } from "./receptionist.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const DEFAULT_TEMPLATES = {
  missed_call: "Sorry we missed your call at {business}. Reply with what you need and {owner} will get back to you. Reply STOP to opt out.",
  after_hours: "Thanks for contacting {business}. We're closed right now; {owner} will reply when we open. Reply STOP to opt out.",
  booking_request: "Thanks, {business} got your appointment request. It is NOT booked until {owner} confirms it with you. Reply STOP to opt out."
};

export const DEFAULT_RECORDING_ANNOUNCEMENT = "This call may be recorded.";

export const CRTC_TENANT = {
  slug: "crtc",
  businessName: "CRTC AI",
  ownerName: "the CRTC team",
  phoneNumbers: [],
  ownerNumbers: [],
  helpContact: "",
  liveSms: false,
  recording: { enabled: false, announcement: DEFAULT_RECORDING_ANNOUNCEMENT },
  templates: { ...DEFAULT_TEMPLATES },
  profile: [
    "CRTC AI provides software development, websites, automation, and related software products. It is not a lawn-care, junk-removal, or resale company.",
    "Approved public pricing:",
    ...PRICING.map((p) => "- " + p),
    "Qualify sales leads: caller name, business name, what they need, preferred contact method, timeline.",
    "For support, collect the product/site, problem, impact, and callback details."
  ].join("\n")
};

export function normalizeTenant(raw) {
  if (!raw || typeof raw !== "object") throw new Error("tenant must be an object");
  if (!SLUG_RE.test(String(raw.slug || ""))) throw new Error("tenant slug must be lowercase letters, digits, dashes");
  if (!raw.businessName) throw new Error(`tenant ${raw.slug}: businessName is required`);
  const templates = { ...DEFAULT_TEMPLATES, ...(raw.templates || {}) };
  for (const t of Object.values(templates)) validateTemplate(t);
  const recording = {
    enabled: Boolean(raw.recording?.enabled),
    announcement: String(raw.recording?.announcement || DEFAULT_RECORDING_ANNOUNCEMENT)
  };
  if (recording.enabled && !/record/i.test(recording.announcement)) {
    throw new Error(`tenant ${raw.slug}: recording is on but the announcement does not say the call is recorded`);
  }
  return {
    slug: raw.slug,
    businessName: String(raw.businessName),
    ownerName: String(raw.ownerName || "the owner"),
    phoneNumbers: (raw.phoneNumbers || []).map(normalizeE164).filter(Boolean),
    ownerNumbers: (raw.ownerNumbers || []).map(normalizeE164).filter(Boolean),
    helpContact: String(raw.helpContact || ""),
    liveSms: raw.liveSms === true,
    recording,
    templates,
    profile: String(raw.profile || "")
  };
}

export function loadTenants(dir = process.env.TENANTS_DIR || "./tenants") {
  const tenants = new Map([[CRTC_TENANT.slug, CRTC_TENANT]]);
  if (!fs.existsSync(dir)) return tenants;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const t = normalizeTenant(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    tenants.set(t.slug, t);
  }
  return tenants;
}

/** The tenant that owns the dialed number, else the default. */
export function tenantForNumber(tenants, dialed, fallback = CRTC_TENANT.slug) {
  const e = normalizeE164(dialed || "");
  for (const t of tenants.values()) if (e && t.phoneNumbers.includes(e)) return t;
  return tenants.get(fallback) || CRTC_TENANT;
}

/** Spoken first on every call: names the business, says it is automated, and discloses recording when on. */
export function greetingFor(tenant) {
  let line = `Thanks for calling ${tenant.businessName}. I'm the automated assistant.`;
  if (tenant.recording?.enabled) line += " " + tenant.recording.announcement.trim();
  return line + " How can I help you?";
}
