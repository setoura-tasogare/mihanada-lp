import { handleLineWebhook, type LineEnv } from "../lib/line-webhook";
import { verifyLineIdToken } from "../lib/line-login";
import {
  calculateGyotakuAmount,
  createStripeCheckout,
  type GyotakuBackground,
  type GyotakuOption,
  verifyStripeWebhookSignature,
} from "../lib/stripe-checkout";

type KvNamespace = {
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { metadata?: Record<string, string> },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
};

type D1Result = { success: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<D1Result>;
  first<T>(): Promise<T | null>;
};
type D1Database = {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
};

type WorkerEnv = LineEnv & {
  LINE_LOGIN_CHANNEL_ID?: string;
  MIHANADA_GYOTAKU_ORDERS?: KvNamespace;
  MIHANADA_GYOTAKU_DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  LIFF_RETURN_URL?: string;
};

const ORDER_PATH = "/api/gyotaku/orders";
const ORDER_STATUS_PATH = "/api/gyotaku/orders/status";
const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
const ALLOWED_ORIGINS = new Set([
  "https://www.mihanada.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.mihanada.site";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null) {
  return Response.json(data, { status, headers: corsHeaders(origin) });
}

function field(form: FormData, name: string, maxLength = 200) {
  return String(form.get(name) ?? "").trim().slice(0, maxLength);
}

function positiveNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "photo";
}

function createOrderId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "").slice(2);
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `GY-${date}-${random}`;
}

async function pushOrderConfirmation(
  userId: string,
  orderId: string,
  species: string,
  token: string,
) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`payment-confirmed:${orderId}`)));
  digest[6] = (digest[6] & 15) | 80;
  digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const retryKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Line-Retry-Key": retryKey,
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: "text",
          text: `デジタル魚拓のお支払いを確認しました。\n\n注文番号：${orderId}\n魚種：${species}\n\n制作内容を確認して、このトークでご連絡します。`,
        },
      ],
    }),
  });
  return response.ok || (response.status === 409 && response.headers.has("x-line-accepted-request-id"));
}

async function handleOrder(request: Request, env: WorkerEnv) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "許可されていない送信元です" }, 403, origin);
  }
  if (
    !env.LINE_LOGIN_CHANNEL_ID ||
    !env.MIHANADA_GYOTAKU_ORDERS ||
    !env.MIHANADA_GYOTAKU_DB ||
    !env.STRIPE_SECRET_KEY ||
    !env.LIFF_RETURN_URL
  ) {
    return json({ error: "注文受付は準備中です" }, 503, origin);
  }
  const orderStore = env.MIHANADA_GYOTAKU_ORDERS;
  const db = env.MIHANADA_GYOTAKU_DB;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "送信内容を読み取れませんでした" }, 400, origin);
  }

  const identity = await verifyLineIdToken(
    field(form, "idToken", 4096),
    env.LINE_LOGIN_CHANNEL_ID,
  );
  if (!identity) {
    return json({ error: "LINEログインを確認できませんでした。LINEから開き直してください" }, 401, origin);
  }

  const species = field(form, "species", 80);
  const lengthCm = positiveNumber(field(form, "length", 20));
  const weightKgRaw = field(form, "weight", 20);
  const weightKg = weightKgRaw ? positiveNumber(weightKgRaw) : undefined;
  const caughtOn = field(form, "date", 10);
  const place = field(form, "place", 120);
  const angler = field(form, "angler", 80);
  const background = field(form, "background", 10);
  const optionValues = form.getAll("options").map(String);
  const options = new Set(optionValues) as Set<GyotakuOption>;
  const photos = form.getAll("photos").filter((value): value is File => value instanceof File);

  if (!species || !lengthCm || !caughtOn || !place || !angler) {
    return json({ error: "必須項目を確認してください" }, 400, origin);
  }
  if (weightKgRaw && !weightKg) {
    return json({ error: "重さは0より大きい数字で入力してください" }, 400, origin);
  }
  if (!/^(mono|pale|wood)$/.test(background)) {
    return json({ error: "背景の選択を確認してください" }, 400, origin);
  }
  if (optionValues.some((value) => !["square", "tackle", "witness"].includes(value))) {
    return json({ error: "オプションの選択を確認してください" }, 400, origin);
  }
  if (photos.length < 1 || photos.length > MAX_PHOTOS) {
    return json({ error: "写真は1〜3枚選んでください" }, 400, origin);
  }
  if (photos.some((photo) => !photo.type.startsWith("image/") || photo.size > MAX_PHOTO_BYTES)) {
    return json({ error: "写真は1枚10MB以下の画像を選んでください" }, 400, origin);
  }

  const orderId = createOrderId();
  const photoKeys: string[] = [];
  let checkoutAttempted = false;
  try {
    for (const [index, photo] of photos.entries()) {
      const key = `orders/${orderId}/photos/${index + 1}-${safeFilename(photo.name)}`;
      await orderStore.put(key, await photo.arrayBuffer(), {
        metadata: { contentType: photo.type, orderId },
      });
      photoKeys.push(key);
    }

    const order = {
      id: orderId,
      createdAt: new Date().toISOString(),
      lineUserId: identity.userId,
      lineDisplayName: identity.displayName,
      species,
      lengthCm,
      ...(weightKg ? { weightKg } : {}),
      caughtOn,
      place,
      angler,
      note: field(form, "note", 500),
      background,
      options: {
        square: options.has("square"),
        tackle: options.has("tackle"),
        witness: options.has("witness"),
      },
      tackle: field(form, "tackle", 200),
      lure: field(form, "lure", 120),
      witness: field(form, "witness", 80),
      message: field(form, "msg", 1000),
      photoKeys,
      amountJpy: calculateGyotakuAmount(background as GyotakuBackground, options),
    };

    const metaKey = `orders/${orderId}/meta.json`;
    await orderStore.put(metaKey, JSON.stringify(order));
    await db.prepare(
      `INSERT INTO gyotaku_orders
        (id, line_user_id, line_display_name, species, amount_jpy, status, metadata_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'awaiting_payment', ?, datetime('now'), datetime('now'))`,
    ).bind(
      orderId,
      identity.userId,
      identity.displayName,
      species,
      order.amountJpy,
      metaKey,
    ).run();

    checkoutAttempted = true;
    const checkout = await createStripeCheckout({
      secretKey: env.STRIPE_SECRET_KEY,
      orderId,
      lineUserId: identity.userId,
      species,
      background: background as GyotakuBackground,
      options,
      returnUrl: env.LIFF_RETURN_URL,
    });
    await db.prepare(
      `UPDATE gyotaku_orders
       SET stripe_session_id = ?, updated_at = datetime('now')
       WHERE id = ? AND stripe_session_id IS NULL`,
    ).bind(checkout.id, orderId).run();

    return json({ orderId, displayName: identity.displayName, checkoutUrl: checkout.url }, 201, origin);
  } catch {
    // Preserve recoverable order data if Stripe may already have created a session.
    if (!checkoutAttempted) await Promise.allSettled(photoKeys.map((key) => orderStore.delete(key)));
    return json({ error: "注文を保存できませんでした。時間をおいてお試しください" }, 500, origin);
  }
}

async function handleOrderStatus(request: Request, env: WorkerEnv) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "許可されていない送信元です" }, 403, origin);
  if (!env.LINE_LOGIN_CHANNEL_ID || !env.MIHANADA_GYOTAKU_DB) {
    return json({ error: "注文確認は準備中です" }, 503, origin);
  }
  const data = await request.formData();
  const identity = await verifyLineIdToken(field(data, "idToken", 4096), env.LINE_LOGIN_CHANNEL_ID);
  if (!identity) return json({ error: "LINEログインを確認できませんでした" }, 401, origin);
  const sessionId = field(data, "sessionId", 255);
  const order = await env.MIHANADA_GYOTAKU_DB.prepare(
    `SELECT id, status, amount_jpy AS amountJpy
     FROM gyotaku_orders WHERE stripe_session_id = ? AND line_user_id = ?`,
  ).bind(sessionId, identity.userId).first<{ id: string; status: string; amountJpy: number }>();
  if (!order) return json({ error: "注文を確認できませんでした" }, 404, origin);
  return json({ orderId: order.id, status: order.status, amountJpy: order.amountJpy }, 200, origin);
}

type StripeEvent = {
  id: string;
  type: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      amount_total?: number | null;
      currency?: string;
      payment_status?: string;
      payment_intent?: string | null;
    };
  };
};

async function handleStripeWebhook(request: Request, env: WorkerEnv) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.MIHANADA_GYOTAKU_DB) {
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  }
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeWebhookSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!event || !event.id || !event.type) return Response.json({ error: "Invalid event" }, { status: 400 });

  const session = event.data?.object;
  const sessionId = session?.id ?? "";
  const orderId = session?.client_reference_id ?? "";
  const amountTotal = session?.amount_total;
  const shouldMarkPaid =
    (event.type === "checkout.session.completed" && session?.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded";
  const shouldReset = ["checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type);

  const statements = [
    env.MIHANADA_GYOTAKU_DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, datetime('now'))",
    ).bind(event.id, event.type),
  ];
  if (shouldMarkPaid && sessionId && session?.currency === "jpy" && Number.isInteger(amountTotal)) {
    statements.push(env.MIHANADA_GYOTAKU_DB.prepare(
      `UPDATE gyotaku_orders
       SET status = 'paid', stripe_session_id = ?, stripe_payment_intent = ?, updated_at = datetime('now')
       WHERE (stripe_session_id = ? OR (id = ? AND stripe_session_id IS NULL))
         AND amount_jpy = ? AND status = 'awaiting_payment'`,
    ).bind(sessionId, session?.payment_intent ?? null, sessionId, orderId, amountTotal));
  } else if (shouldReset && sessionId) {
    statements.push(env.MIHANADA_GYOTAKU_DB.prepare(
      `UPDATE gyotaku_orders SET status = 'draft', updated_at = datetime('now')
       WHERE (stripe_session_id = ? OR (id = ? AND stripe_session_id IS NULL))
         AND status = 'awaiting_payment'`,
    ).bind(sessionId, orderId));
  }
  await env.MIHANADA_GYOTAKU_DB.batch(statements);

  if (shouldMarkPaid && sessionId && env.LINE_CHANNEL_ACCESS_TOKEN && env.MIHANADA_GYOTAKU_ORDERS) {
    const order = await env.MIHANADA_GYOTAKU_DB.prepare(
      `SELECT id, line_user_id AS lineUserId, species, metadata_key AS metadataKey
       FROM gyotaku_orders WHERE stripe_session_id = ? AND status = 'paid' AND confirmation_sent_at IS NULL`,
    ).bind(sessionId).first<{ id: string; lineUserId: string; species: string; metadataKey: string }>();
    if (order) {
      try {
        const sent = await pushOrderConfirmation(order.lineUserId, order.id, order.species, env.LINE_CHANNEL_ACCESS_TOKEN);
        if (!sent) {
          return Response.json({ error: "LINE push failed" }, { status: 502 });
        }
        await env.MIHANADA_GYOTAKU_DB.prepare(
          "UPDATE gyotaku_orders SET confirmation_sent_at = datetime('now') WHERE id = ? AND confirmation_sent_at IS NULL",
        ).bind(order.id).run();
      } catch {
        return Response.json({ error: "LINE push failed" }, { status: 502 });
      }
    }
  }
  return Response.json({ received: true });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      const ready = Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);
      return Response.json({ ok: ready }, { status: ready ? 200 : 503 });
    }
    if (path === ORDER_PATH && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
    }
    if (path === ORDER_STATUS_PATH && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
    }
    if (path === ORDER_STATUS_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
      return handleOrderStatus(request, env);
    }
    if (path === ORDER_PATH) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
      }
      return handleOrder(request, env);
    }
    if (path === STRIPE_WEBHOOK_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return handleStripeWebhook(request, env);
    }
    if (path !== "/api/line/webhook") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    return handleLineWebhook(request, env);
  },
};
