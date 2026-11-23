import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";

test("SQLite stores call history and keeps one lead record per call", () => {
  const store = openStore(":memory:");
  try {
    store.startCall({
      sessionId: "session-test-1",
      callSid: "call-test-1",
      from: "+18435550100",
      to: "+18435550199",
      direction: "inbound"
    });
    store.addMessage("session-test-1", "user", "I need a website quote", "sales");
    store.addMessage("session-test-1", "assistant", "I can help with that.", "sales");
    assert.deepEqual(store.history("session-test-1"), [
      { role: "user", content: "I need a website quote" },
      { role: "assistant", content: "I can help with that." }
    ]);
    store.addLead({
      sessionId: "session-test-1",
      caller: "+18435550100",
      email: null,
      phone: null,
      intent: "sales",
      summary: "I need a website quote"
    });
    store.addLead({
      sessionId: "session-test-1",
      caller: "+18435550100",
      email: "caller@example.com",
      phone: null,
      intent: "sales",
      summary: "Caller supplied an email address"
    });
    assert.equal(store.leadCount("session-test-1"), 1);
  } finally {
    store.close();
  }
});
