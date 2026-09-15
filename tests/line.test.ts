import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "../workers/line";
const env = { LINE_CHANNEL_SECRET: "test-secret", LINE_CHANNEL_ACCESS_TOKEN: "test-token" };
const POST = (request: Request) => worker.fetch(request, env);
import { menuResponse } from "../lib/line";
import { richMenu } from "../lib/line-rich-menu";
import { verifyLineIdToken } from "../lib/line-login";
import {
  calculateGyotakuAmount,
  createStripeCheckout,
  verifyStripeWebhookSignature,
} from "../lib/stripe-checkout";

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

test("digital gyotaku Flex opens the LIFF order form", () => {
  const flex = menuResponse("gyotaku") as {
    contents: { footer: { contents: Array<{ action: Record<string, string> }> } };
  };
  const actions = flex.contents.footer.contents.map(button => button.action);
  assert.deepEqual(actions, [
    { type: "uri", label: "ホームページを見る", uri: "https://www.mihanada.site/digital-gyotaku" },
    { type: "uri", label: "デジタル魚拓を申し込む", uri: "https://liff.line.me/2011607510-4wOg38uG" },
  ]);
});

test("LINE ID tokens are verified against the login channel", async () => {
  const verified = await verifyLineIdToken("signed-token", "2011607510", async () =>
    Response.json({
      sub: "U1234567890",
      name: "水縹 太郎",
      picture: "https://profile.line-scdn.net/example",
      aud: "2011607510",
    }),
  );
  assert.deepEqual(verified, {
    userId: "U1234567890",
    displayName: "水縹 太郎",
    pictureUrl: "https://profile.line-scdn.net/example",
  });

  assert.equal(
    await verifyLineIdToken("signed-token", "wrong-channel", async () =>
      Response.json({ sub: "U1234567890", aud: "2011607510" }),
    ),
    undefined,
  );
});

test("verified LIFF orders are saved with their LINE user ID", async () => {
  const values = new Map<string, string | ArrayBuffer>();
  const databaseWrites: Array<{ query: string; values: unknown[] }> = [];
  function statement(query: string) {
    let bound: unknown[] = [];
    return {
      bind(...values: unknown[]) { bound = values; return this; },
      async run() { databaseWrites.push({ query, values: bound }); return { success: true, meta: { changes: 1 } }; },
      async first() { return null; },
    };
  }
  const orderEnv = {
    ...env,
    LINE_LOGIN_CHANNEL_ID: "2011607510",
    STRIPE_SECRET_KEY: "sk_test_example",
    LIFF_RETURN_URL: "https://liff.line.me/test",
    MIHANADA_GYOTAKU_DB: {
      prepare: statement,
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        await Promise.all(statements.map((item) => item.run()));
        return [];
      },
    },
    MIHANADA_GYOTAKU_ORDERS: {
      async put(key: string, value: string | ArrayBuffer) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
      async get(key: string) { return typeof values.get(key) === "string" ? String(values.get(key)) : null; },
    },
  };
  const form = new FormData();
  form.set("idToken", "signed-token");
  form.set("species", "真鯛");
  form.set("length", "52");
  form.set("date", "2026-09-15");
  form.set("place", "壱岐沖");
  form.set("angler", "水縹 太郎");
  form.set("background", "mono");
  form.append("photos", new File(["image"], "madai.jpg", { type: "image/jpeg" }));

  const savedFetch = globalThis.fetch;
  let checkoutBody = "";
  try {
    globalThis.fetch = async (url, init) => {
      if (url === "https://api.line.me/oauth2/v2.1/verify") {
        return Response.json({ sub: "U1234567890", name: "水縹 太郎", aud: "2011607510" });
      }
      if (url === "https://api.stripe.com/v1/checkout/sessions") {
        checkoutBody = String(init?.body);
        return Response.json({ id: "cs_test_order", url: "https://checkout.stripe.com/test" });
      }
      throw new Error(`unexpected request: ${url}`);
    };
    const response = await worker.fetch(new Request(
      "https://worker.example/api/gyotaku/orders",
      { method: "POST", body: form, headers: { origin: "https://www.mihanada.site" } },
    ), orderEnv);
    assert.equal(response.status, 201);
    const result = await response.json() as { orderId: string; checkoutUrl: string };
    const metadata = JSON.parse(String(values.get(`orders/${result.orderId}/meta.json`)));
    assert.equal(metadata.lineUserId, "U1234567890");
    assert.equal(metadata.species, "真鯛");
    assert.equal(metadata.status, "awaiting_payment");
    assert.equal(metadata.confirmationSent, false);
    assert.equal(result.checkoutUrl, "https://checkout.stripe.com/test");
    assert.match(checkoutBody, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=3000/);
    assert.equal(databaseWrites.length, 2);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("server pricing and Stripe Checkout line items match every selected option", async () => {
  assert.equal(calculateGyotakuAmount("wood", new Set(["square", "tackle", "witness"])), 5500);
  const savedFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      const amounts = [...body.entries()]
        .filter(([key]) => key.endsWith("[unit_amount]"))
        .map(([, value]) => Number(value));
      assert.deepEqual(amounts, [3000, 1000, 500, 500, 500]);
      assert.equal(body.get("client_reference_id"), "GY-TEST");
      assert.equal(body.get("metadata[line_user_id]"), "U123");
      return Response.json({ id: "cs_test_123", url: "https://checkout.stripe.com/test" });
    };
    await createStripeCheckout({
      secretKey: "sk_test_example",
      orderId: "GY-TEST",
      lineUserId: "U123",
      species: "真鯛",
      background: "wood",
      options: new Set(["square", "tackle", "witness"]),
      returnUrl: "https://liff.line.me/test",
    });
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("Stripe webhook signatures cover the exact raw request body", async () => {
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
  const timestamp = 1_800_000_000;
  const signature = crypto.createHmac("sha256", "whsec_test")
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(await verifyStripeWebhookSignature(payload, header, "whsec_test", timestamp), true);
  assert.equal(await verifyStripeWebhookSignature(`${payload} `, header, "whsec_test", timestamp), false);
  assert.equal(await verifyStripeWebhookSignature(payload, header, "whsec_test", timestamp + 301), false);
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
