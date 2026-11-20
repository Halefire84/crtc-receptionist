import test from "node:test";
import assert from "node:assert/strict";
import { buildTeXML, classifyIntent, escapeXml, extractLead } from "../src/receptionist.js";

test("TeXML contains Connect and ConversationRelay with secure WSS", () => {
  const xml = buildTeXML({
    publicBaseUrl: "https://voice.example.test",
    publicWsUrl: "wss://voice.example.test/conversation-relay",
    webhookToken: "test-secret"
  });
  assert.match(xml, /<Connect action=/);
  assert.match(xml, /<ConversationRelay/);
  assert.match(xml, /wss:\/\/voice\.example\.test\/conversation-relay\?token=test-secret/);
});

test("TeXML refuses insecure websocket URLs", () => {
  assert.throws(() => buildTeXML({
    publicBaseUrl: "https://voice.example.test",
    publicWsUrl: "ws://voice.example.test/conversation-relay",
    webhookToken: "test-secret"
  }), /must use wss/);
});

test("XML values are escaped", () => {
  assert.equal(escapeXml(`A&B <"x">`), "A&amp;B &lt;&quot;x&quot;&gt;");
});

test("intent classification handles sales, support and urgency", () => {
  assert.equal(classifyIntent("I need a website quote"), "sales");
  assert.equal(classifyIntent("My website is not working"), "support");
  assert.equal(classifyIntent("There is an emergency"), "urgent");
});

test("lead extraction identifies email and phone without inventing missing values", () => {
  assert.deepEqual(extractLead("Call me at (843) 555-0100 or chris@example.com"), {
    email: "chris@example.com",
    phone: "(843) 555-0100"
  });
  assert.deepEqual(extractLead("I need a new website"), { email: null, phone: null });
});
