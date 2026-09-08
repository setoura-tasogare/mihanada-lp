import { NextResponse } from "next/server";
import {
  consultationReply,
  menuResponse,
  replyLine,
  verifyLineSignature,
} from "@/lib/line";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!verifyLineSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body) as { events?: LineEvent[] };
  const events = payload.events ?? [];

  await Promise.all(
    events.map(async (event) => {
      if (!event.replyToken) return;

      if (event.type === "postback") {
        const response = menuResponse(getPostbackAction(event.postback?.data) ?? "");
        if (response) await replyLine(event.replyToken, [response]);
        return;
      }

      if (event.type === "message" && event.message?.type === "text" && event.message.text) {
        const text = event.message.text;
        const richMenuAction = richMenuMessages[text];
        if (richMenuAction) {
          const response = menuResponse(richMenuAction);
          if (response) await replyLine(event.replyToken, [response]);
          return;
        }
        if (
          text === "デジタル魚拓を相談したい" ||
          text === "フィッシュレザーの商品について問い合わせたい" ||
          text === "フィッシュレザーのオーダーメイドを相談したい" ||
          text === "その他の相談をしたい"
        ) {
          await replyLine(event.replyToken, [consultationReply(text)]);
        }
      }
    })
  );

  return NextResponse.json({ ok: true });
}
