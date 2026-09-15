import {
  consultationReply,
  menuResponse,
} from "./line";

export type LineEnv = {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
};

async function verifyLineSignature(body: ArrayBuffer, signature: string | null, secret: string) {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, bytes, body);
}

async function replyLine(replyToken: string, messages: unknown[], token: string) {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  // Never include LINE response bodies, customer messages or credentials in logs.
  if (!response.ok) throw new Error(`LINE reply failed: ${response.status}`);
}

type LineEvent = {
  type: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  postback?: { data?: string };
};

const richMenuMessages: Record<string, string> = {
  "デジタル魚拓について知りたい": "gyotaku",
  "フィッシュレザーについて知りたい": "fish_leather",
  "お問い合わせをしたい": "contact",
};

function getPostbackAction(data?: string) {
  if (!data) return undefined;
  return new URLSearchParams(data).get("action") ?? undefined;
}

export async function handleLineWebhook(request: Request, env: LineEnv) {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    return Response.json({ error: "LINE is not configured" }, { status: 503 });
  }
  const body = await request.arrayBuffer();
  const signature = request.headers.get("x-line-signature");
  if (!await verifyLineSignature(body, signature, env.LINE_CHANNEL_SECRET)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || !Array.isArray(payload.events)) {
    return Response.json({ error: "Invalid events" }, { status: 400 });
  }
  const events = payload.events;

  const results = await Promise.allSettled(
    events.map(async (event) => {
      if (!event || !event.replyToken) return;

      if (event.type === "postback") {
        const response = menuResponse(getPostbackAction(event.postback?.data) ?? "");
        if (response) await replyLine(event.replyToken, [response], env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (event.type === "message" && event.message?.type === "text" && event.message.text) {
        const text = event.message.text;
        const richMenuAction = richMenuMessages[text];
        if (richMenuAction) {
          const response = menuResponse(richMenuAction);
          if (response) await replyLine(event.replyToken, [response], env.LINE_CHANNEL_ACCESS_TOKEN);
          return;
        }
        if (
          text === "デジタル魚拓を申し込む" ||
          text === "デジタル魚拓を相談したい" ||
          text === "フィッシュレザーの商品について問い合わせたい" ||
          text === "フィッシュレザーのオーダーメイドを相談したい" ||
          text === "フィッシュレザーを相談したい" ||
          text === "その他の相談をしたい"
        ) {
          await replyLine(event.replyToken, [consultationReply(text)], env.LINE_CHANNEL_ACCESS_TOKEN);
        }
      }
    })
  );

  if (results.some(result => result.status === "rejected")) {
    return Response.json({ error: "LINE reply failed" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
