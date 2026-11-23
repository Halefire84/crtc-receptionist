import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openStore(filename = process.env.DB_PATH || "./data/receptionist.sqlite", clock = () => new Date()) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS calls (
      session_id TEXT PRIMARY KEY,
      call_sid TEXT,
      caller TEXT,
      dialed_number TEXT,
      direction TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES calls(session_id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      intent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE REFERENCES calls(session_id),
      caller TEXT,
      email TEXT,
      phone TEXT,
      intent TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      session_id TEXT,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      est_usd REAL
    );
    CREATE TABLE IF NOT EXISTS sms_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL, phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sms ON sms_messages(tenant, phone, id);
    CREATE TABLE IF NOT EXISTS optouts (
      tenant TEXT NOT NULL, phone TEXT NOT NULL, word TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (tenant, phone)
    );
    CREATE TABLE IF NOT EXISTS consent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL, phone TEXT NOT NULL, event TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sms_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL, to_phone TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','failed','discarded','skipped')),
      detail TEXT, day TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drafts ON sms_drafts(tenant, to_phone, day);
  `);
  for (const col of ["tenant TEXT", "owner_summary TEXT"]) {
    const table = col.startsWith("tenant") ? "calls" : "leads";
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* column already exists */ }
  }
  const insertCall = db.prepare("INSERT OR IGNORE INTO calls(session_id,call_sid,caller,dialed_number,direction,started_at) VALUES(?,?,?,?,?,?)");
  const insertMessage = db.prepare("INSERT INTO messages(session_id,role,content,intent,created_at) VALUES(?,?,?,?,?)");
  const getMessages = db.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?");
  const updateCall = db.prepare("UPDATE calls SET ended_at=?,status=? WHERE session_id=?");
  const insertLead = db.prepare(`INSERT INTO leads(session_id,caller,email,phone,intent,summary,created_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      caller=COALESCE(excluded.caller,leads.caller),
      email=COALESCE(excluded.email,leads.email),
      phone=COALESCE(excluded.phone,leads.phone),
      intent=excluded.intent,
      summary=excluded.summary`);
  return {
    startCall(call) {
      insertCall.run(call.sessionId, call.callSid ?? null, call.from ?? null, call.to ?? null, call.direction ?? "inbound", new Date().toISOString());
    },
    addMessage(sessionId, role, content, intent = null) {
      insertMessage.run(sessionId, role, content, intent, new Date().toISOString());
    },
    history(sessionId, limit = 12) {
      return getMessages.all(sessionId, limit).reverse().map(({ role, content }) => ({ role, content }));
    },
    endCall(sessionId, status = "ended") {
      updateCall.run(new Date().toISOString(), status, sessionId);
    },
    addLead(lead) {
      insertLead.run(lead.sessionId, lead.caller ?? null, lead.email ?? null, lead.phone ?? null, lead.intent, lead.summary, new Date().toISOString());
    },
    leadCount(sessionId) {
      return db.prepare("SELECT COUNT(*) AS count FROM leads WHERE session_id=?").get(sessionId).count;
    },
    setCallTenant(sessionId, tenant) {
      db.prepare("UPDATE calls SET tenant=? WHERE session_id=?").run(tenant, sessionId);
    },
    callInfo(sessionId) {
      return db.prepare("SELECT * FROM calls WHERE session_id=?").get(sessionId) ?? null;
    },
    setOwnerSummary(sessionId, summary) {
      db.prepare("UPDATE leads SET owner_summary=? WHERE session_id=?").run(summary, sessionId);
    },
    leads(limit = 100) {
      return db.prepare("SELECT l.*, c.tenant FROM leads l LEFT JOIN calls c USING(session_id) ORDER BY l.id DESC LIMIT ?").all(limit);
    },

    // Claude usage / cost log (one row per API request)
    log(row) {
      db.prepare(`INSERT INTO usage_log(ts,session_id,purpose,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,est_usd)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(clock().toISOString(), row.sessionId ?? null, row.purpose, row.model,
        row.inputTokens, row.outputTokens, row.cacheReadTokens || 0, row.cacheWriteTokens || 0, row.estUsd ?? null);
    },
    usageRows(limit = 200) {
      return db.prepare("SELECT * FROM usage_log ORDER BY id DESC LIMIT ?").all(limit);
    },
    monthSpend() {
      const month = clock().toISOString().slice(0, 7);
      return db.prepare("SELECT COALESCE(SUM(est_usd),0) AS usd FROM usage_log WHERE substr(ts,1,7)=?").get(month).usd;
    },
    usageTotals() {
      return db.prepare(`SELECT substr(ts,1,7) AS month, model, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens, ROUND(COALESCE(SUM(est_usd),0), 4) AS est_usd
        FROM usage_log GROUP BY month, model ORDER BY month DESC, model`).all();
    },

    // SMS threads, opt-outs and drafts (all keyed by tenant)
    addSms(tenant, phone, role, content) {
      db.prepare("INSERT INTO sms_messages(tenant,phone,role,content,created_at) VALUES(?,?,?,?,?)").run(tenant, phone, role, content, clock().toISOString());
    },
    smsHistory(tenant, phone, limit = 12) {
      return db.prepare("SELECT role,content FROM sms_messages WHERE tenant=? AND phone=? ORDER BY id DESC LIMIT ?").all(tenant, phone, limit).reverse().map(({ role, content }) => ({ role, content }));
    },
    isNewSmsContact(tenant, phone) {
      return !db.prepare("SELECT 1 FROM sms_messages WHERE tenant=? AND phone=? AND role='assistant' LIMIT 1").get(tenant, phone);
    },
    optOut(tenant, phone, word) {
      db.prepare("INSERT OR REPLACE INTO optouts(tenant,phone,word,created_at) VALUES(?,?,?,?)").run(tenant, phone, word, clock().toISOString());
      db.prepare("INSERT INTO consent_log(tenant,phone,event,detail,created_at) VALUES(?,?,?,?,?)").run(tenant, phone, "opt_out", word, clock().toISOString());
    },
    optIn(tenant, phone, word) {
      db.prepare("DELETE FROM optouts WHERE tenant=? AND phone=?").run(tenant, phone);
      db.prepare("INSERT INTO consent_log(tenant,phone,event,detail,created_at) VALUES(?,?,?,?,?)").run(tenant, phone, "opt_in", word, clock().toISOString());
    },
    isOptedOut(tenant, phone) {
      return Boolean(db.prepare("SELECT 1 FROM optouts WHERE tenant=? AND phone=?").get(tenant, phone));
    },
    consentLog(tenant) {
      return db.prepare("SELECT * FROM consent_log WHERE tenant=? ORDER BY id").all(tenant);
    },
    addDraft(tenant, toPhone, kind, body, status = "draft", detail = null) {
      const now = clock();
      return Number(db.prepare("INSERT INTO sms_drafts(tenant,to_phone,kind,body,status,detail,day,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(tenant, toPhone, kind, body, status, detail, now.toISOString().slice(0, 10), now.toISOString()).lastInsertRowid);
    },
    drafts(tenant, status = null) {
      return status
        ? db.prepare("SELECT * FROM sms_drafts WHERE tenant=? AND status=? ORDER BY id DESC").all(tenant, status)
        : db.prepare("SELECT * FROM sms_drafts WHERE tenant=? ORDER BY id DESC").all(tenant);
    },
    draft(tenant, id) {
      return db.prepare("SELECT * FROM sms_drafts WHERE tenant=? AND id=?").get(tenant, id) ?? null;
    },
    setDraftStatus(tenant, id, status, detail = null) {
      return db.prepare("UPDATE sms_drafts SET status=?, detail=?, updated_at=? WHERE tenant=? AND id=?").run(status, detail, clock().toISOString(), tenant, id).changes === 1;
    },
    textbackToday(tenant) {
      const day = clock().toISOString().slice(0, 10);
      return new Set(db.prepare("SELECT to_phone FROM sms_drafts WHERE tenant=? AND day=? AND kind IN ('missed_call','after_hours') AND status IN ('draft','sent')").all(tenant, day).map((r) => r.to_phone));
    },

    close() { db.close(); }
  };
}
