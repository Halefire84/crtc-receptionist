import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openStore(filename = process.env.DB_PATH || "./data/receptionist.sqlite") {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
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
  `);
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
    close() { db.close(); }
  };
}
