import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createVoiceService } from "../src/server.js";
import { openStore } from "../src/store.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("simulated TeXML call exchanges prompt and speech text with local AI", async () => {
  const store = openStore(":memory:");
  const service = createVoiceService({
    store,
    config: {
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://voice.example.test",
      publicWsUrl: "wss://voice.example.test/conversation-relay",
      webhookToken: "integration-test-secret",
      ollamaUrl: "http://ollama.test/v1",
      model: "qwen3:4b",
      maxReplyMs: 1000
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://ollama.test/v1/chat/completions");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "qwen3:4b");
      assert.equal(body.messages.at(-1).content, "I need a website quote. Email me at caller@example.com.");
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "I can help with a website. Our starter site is $499. What business is this for?" } }] })
      };
    }
  });

  let socket;
  try {
    const port = await listen(service.server);
    const texml = await fetch(`http://127.0.0.1:${port}/texml/voice?token=integration-test-secret`);
    assert.equal(texml.status, 200);
    const xml = await texml.text();
    assert.match(xml, /<ConversationRelay/);
    assert.match(xml, /wss:\/\/voice\.example\.test\/conversation-relay\?token=integration-test-secret/);

    socket = new WebSocket(`ws://127.0.0.1:${port}/conversation-relay?token=integration-test-secret`);
    await once(socket, "open");
    socket.send(JSON.stringify({
      type: "setup",
      sessionId: "simulated-call-001",
      callSid: "simulated-telnyx-call",
      from: "+18435550100",
      to: "+18435550199",
      direction: "inbound"
    }));
    socket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "I need a website quote. Email me at caller@example.com.",
      lang: "en",
      last: true
    }));

    const [raw] = await once(socket, "message");
    const frame = JSON.parse(raw.toString());
    assert.deepEqual(frame, {
      type: "text",
      token: "I can help with a website. Our starter site is $499. What business is this for?",
      last: true
    });
    assert.deepEqual(service.store.history("simulated-call-001"), [
      { role: "user", content: "I need a website quote. Email me at caller@example.com." },
      { role: "assistant", content: "I can help with a website. Our starter site is $499. What business is this for?" }
    ]);
    assert.equal(service.store.leadCount("simulated-call-001"), 1);
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
      await once(socket, "close");
    }
    await new Promise((resolve) => service.server.close(resolve));
    service.wss.close();
    service.store.close();
  }
});
