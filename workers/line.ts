import { handleLineWebhook, type LineEnv } from "../lib/line-webhook";
import { verifyLineIdToken } from "../lib/line-login";

type KvNamespace = {
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { metadata?: Record<string, string> },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

type WorkerEnv = LineEnv & {
  LINE_LOGIN_CHANNEL_ID?: string;
  MIHANADA_GYOTAKU_ORDERS?: KvNamespace;
};

const ORDER_PATH = "/api/gyotaku/orders";
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

function calculateAmount(form: FormData) {
  const background = field(form, "background", 10);
  const options = new Set(form.getAll("options").map(String));
  return (
    3000 +
    (background === "pale" || background === "wood" ? 1000 : 0) +
    ["square", "tackle", "witness"].reduce(
      (sum, option) => sum + (options.has(option) ? 500 : 0),
      0,
    )
  );
}

async function pushOrderConfirmation(
  userId: string,
  orderId: string,
  species: string,
  token: string,
) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: "text",
          text: `デジタル魚拓のお申し込みを受け付けました。\n\n注文番号：${orderId}\n魚種：${species}\n\n内容を確認して、このトークでご連絡します。`,
        },
      ],
    }),
  });
  return response.ok;
}

async function handleOrder(request: Request, env: WorkerEnv) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "許可されていない送信元です" }, 403, origin);
  }
  if (!env.LINE_LOGIN_CHANNEL_ID || !env.MIHANADA_GYOTAKU_ORDERS) {
    return json({ error: "注文受付は準備中です" }, 503, origin);
  }
  const orderStore = env.MIHANADA_GYOTAKU_ORDERS;

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
  const options = new Set(optionValues);
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
      status: "received",
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
      amountJpy: calculateAmount(form),
      confirmationSent: false,
    };

    const metaKey = `orders/${orderId}/meta.json`;
    await orderStore.put(metaKey, JSON.stringify(order));
    const confirmationSent = env.LINE_CHANNEL_ACCESS_TOKEN
      ? await pushOrderConfirmation(
          identity.userId,
          orderId,
          species,
          env.LINE_CHANNEL_ACCESS_TOKEN,
        )
      : false;
    if (confirmationSent) {
      await orderStore.put(
        metaKey,
        JSON.stringify({ ...order, confirmationSent: true }),
      );
    }

    return json({ orderId, displayName: identity.displayName, confirmationSent }, 201, origin);
  } catch {
    await Promise.allSettled(photoKeys.map((key) => orderStore.delete(key)));
    return json({ error: "注文を保存できませんでした。時間をおいてお試しください" }, 500, origin);
  }
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
    if (path === ORDER_PATH) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
      }
      return handleOrder(request, env);
    }
    if (path !== "/api/line/webhook") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    return handleLineWebhook(request, env);
  },
};
