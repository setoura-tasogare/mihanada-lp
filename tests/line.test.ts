import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "../workers/line";
const env = { LINE_CHANNEL_SECRET: "test-secret", LINE_CHANNEL_ACCESS_TOKEN: "test-token" };
const POST = (request: Request) => worker.fetch(request, env);
import { menuResponse } from "../lib/line";
import { richMenu } from "../lib/line-rich-menu";

const oldSecret = process.env.LINE_CHANNEL_SECRET;
const oldToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const originalFetch = globalThis.fetch;
process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
const replies: { replyToken: string; messages: { type: string; text?: string }[] }[] = [];
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://api.line.me/v2/bot/message/reply");
  replies.push(JSON.parse(String(init?.body)));
  return Response.json({});
};
after(() => {
  globalThis.fetch = originalFetch;
  if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
  else process.env.LINE_CHANNEL_SECRET = oldSecret;
  if (oldToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  else process.env.LINE_CHANNEL_ACCESS_TOKEN = oldToken;
});

function request(body: string, signature = crypto.createHmac("sha256", "test-secret").update(body).digest("base64")) {
  return new Request("http://localhost/api/line/webhook", {
    method: "POST", body, headers: { "x-line-signature": signature },
  });
}

test("rejects forged signatures and signed malformed payloads without replying", async () => {
  replies.length = 0;
  assert.equal((await POST(request('{"events":[]}', "wrong"))).status, 401);
  for (const body of ["{", "null", '{"events":{}}']) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(replies.length, 0);
});

test("accepts LINE verification and leaves greetings/photos/free text to Manager", async () => {
  replies.length = 0;
  assert.equal((await POST(request('{"events":[]}'))).status, 200);
  const events = [
    { type: "follow", replyToken: "follow" },
    { type: "message", replyToken: "photo", message: { type: "image" } },
    { type: "message", replyToken: "free", message: { type: "text", text: "真鯛で作れますか？" } },
  ];
  assert.equal((await POST(request(JSON.stringify({ events })))).status, 200);
  assert.equal(replies.length, 0);
});

test("each rich-menu message returns a Flex and homepage stays a direct link", async () => {
  replies.length = 0;
  const events = richMenu.areas.filter(area => area.action.type === "message").map((area, i) => ({
    type: "message", replyToken: `menu-${i}`, message: { type: "text", text: area.action.text },
  }));
  await POST(request(JSON.stringify({ events })));
  assert.equal(replies.length, 3);
  assert.ok(replies.every(reply => reply.messages[0].type === "flex"));
  assert.equal(richMenu.areas[2].action.uri, "https://www.mihanada.site/");
});

test("all reachable Flex message buttons lead to a consultation reply", async () => {
  replies.length = 0;
  const texts = new Set<string>();
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    const v = value as Record<string, unknown>;
    if (v.type === "message" && typeof v.text === "string") texts.add(v.text);
    Object.values(v).forEach(walk);
  }
  for (const action of ["gyotaku", "fish_leather", "contact", "about", "gyotaku_flow", "leather_order"]) walk(menuResponse(action));
  const events = [...texts].map((text, i) => ({ type: "message", replyToken: `consult-${i}`, message: { type: "text", text } }));
  await POST(request(JSON.stringify({ events })));
  assert.equal(replies.length, texts.size);
  assert.ok(replies.every(reply => reply.messages[0].type === "text"));
  assert.ok(replies.find(reply => reply.replyToken === `consult-${[...texts].indexOf("フィッシュレザーを相談したい")}`)?.messages[0].text?.includes("オーダーメイド"));
});

test("digital gyotaku Flex uses the approved homepage and application labels", () => {
  const flex = menuResponse("gyotaku") as {
    contents: { footer: { contents: Array<{ action: Record<string, string> }> } };
  };
  const actions = flex.contents.footer.contents.map(button => button.action);
  assert.deepEqual(actions, [
    { type: "uri", label: "ホームページを見る", uri: "https://www.mihanada.site/digital-gyotaku" },
    { type: "message", label: "デジタル魚拓を申し込む", text: "デジタル魚拓を申し込む" },
  ]);
});

test("known postbacks respond and unknown postbacks are ignored", async () => {
  replies.length = 0;
  const events = ["gyotaku", "fish_leather", "contact", "unknown"].map(action => ({
    type: "postback", replyToken: action, postback: { data: `action=${action}` },
  }));
  await POST(request(JSON.stringify({ events })));
  assert.equal(replies.length, 3);
});


test("Worker rejects other routes and methods, and fails closed without secrets", async () => {
  assert.equal((await worker.fetch(new Request("https://example.com/health"), env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://example.com/health"), { ...env, LINE_CHANNEL_SECRET: "" })).status, 503);
  assert.equal((await POST(new Request("https://example.com/unknown"))).status, 404);
  assert.equal((await POST(new Request("https://example.com/api/line/webhook"))).status, 405);
  assert.equal((await worker.fetch(request('{"events":[]}'), { ...env, LINE_CHANNEL_ACCESS_TOKEN: "" })).status, 503);
});

test("signature covers exact Unicode request bytes and rejects modified content", async () => {
  const body = JSON.stringify({ events: [], destination: "日本語" });
  assert.equal((await POST(request(body))).status, 200);
  const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("base64");
  assert.equal((await POST(request(body + " ", signature))).status, 401);
});

test("upstream failure returns retryable error without exposing tokens or customer data", async () => {
  const mock = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("sensitive upstream body", { status: 500 });
    const response = await POST(request(JSON.stringify({ events: [{
      type: "message", replyToken: "private-token", message: { type: "text", text: "お問い合わせをしたい" },
    }] })));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "LINE reply failed" });
  } finally { globalThis.fetch = mock; }
});
