import crypto from "node:crypto";

type LineAction = Record<string, unknown>;
type FlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mihanada.site").replace(/\/$/, "");

const colors = {
  paper: "#F4F1EA",
  sand: "#EBE5D9",
  navy: "#1B2730",
  ink: "#2B3138",
  soft: "#5D646C",
  accent: "#6E9FC0",
};

function postback(label: string, action: string): LineAction {
  return { type: "postback", label, data: `action=${action}` };
}

function uri(label: string, path: string): LineAction {
  return { type: "uri", label, uri: path.startsWith("http") ? path : `${siteUrl}${path}` };
}

function message(label: string, text: string): LineAction {
  return { type: "message", label, text };
}

function button(action: LineAction, primary = false) {
  return {
    type: "button",
    style: primary ? "primary" : "secondary",
    ...(primary ? { color: colors.accent } : {}),
    action,
    margin: "md",
    height: "sm",
  };
}

function serviceFlex(input: {
  eyebrow: string;
  title: string;
  body: string;
  image: string;
  altText: string;
  actions: ReturnType<typeof button>[];
}): FlexMessage {
  return {
    type: "flex",
    altText: input.altText,
    contents: {
      type: "bubble",
      size: "mega",
      hero: {
        type: "image",
        url: `${siteUrl}${input.image}`,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: colors.paper,
        paddingAll: "22px",
        contents: [
          {
            type: "text",
            text: input.eyebrow,
            size: "xs",
            color: "#4D7C9C",
            weight: "bold",
            letterSpacing: "1px",
          },
          {
            type: "text",
            text: input.title,
            size: "xl",
            weight: "bold",
            color: colors.ink,
            margin: "md",
            wrap: true,
          },
          {
            type: "text",
            text: input.body,
            size: "sm",
            color: colors.soft,
            margin: "md",
            wrap: true,
            lineSpacing: "5px",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: colors.paper,
        paddingAll: "14px",
        contents: input.actions,
      },
    },
  };
}

export function digitalGyotakuFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "DIGITAL GYOTAKU",
    title: "写真から、魚拓作品へ。",
    body: "釣果の写真をもとに、一匹の記憶を作品として残します。制作の流れや作品例をご覧いただけます。",
    image: "/images/service-gyotaku.jpg",
    altText: "デジタル魚拓のご案内",
    actions: [
      button(postback("制作の流れを見る", "gyotaku_flow")),
      button(uri("作品例を見る", "/digital-gyotaku")),
      button(message("写真を送って相談する", "デジタル魚拓を相談したい"), true),
    ],
  });
}

export function fishLeatherFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "FISH LEATHER",
    title: "魚の皮を、革に。",
    body: "壱岐の海の魚の皮を、一枚ずつなめして革製品に仕立てます。商品とオーダー制作をご案内します。",
    image: "/images/fish-leather/hero.jpg",
    altText: "フィッシュレザーのご案内",
    actions: [
      button(uri("商品を見る", "/fish-leather")),
      button(postback("オーダーについて", "leather_order")),
      button(message("相談する", "フィッシュレザーを相談したい"), true),
    ],
  });
}

export function aboutFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "ABOUT MIHANADA",
    title: "壱岐の海から、ものづくりを。",
    body: "フィッシュレザー、デジタル魚拓、オーダー制作。MIHANADAの活動と最新情報をご覧いただけます。",
    image: "/images/about.jpg",
    altText: "MIHANADAについて",
    actions: [
      button(uri("ホームページを見る", "/")),
      button(uri("Instagramを見る", "https://www.instagram.com/mihanada.iki/")),
    ],
  });
}

export function contactFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "CONTACT",
    title: "何についてのご相談ですか？",
    body: "内容に近い項目を選んでください。写真送付や個別のご相談も、このトークで承ります。",
    image: "/images/material.jpg",
    altText: "お問い合わせのご案内",
    actions: [
      button(message("デジタル魚拓", "デジタル魚拓を相談したい")),
      button(message("フィッシュレザー", "フィッシュレザーを相談したい")),
      button(message("その他", "その他の相談をしたい"), true),
    ],
  });
}

export function gyotakuFlowFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "HOW IT WORKS",
    title: "デジタル魚拓ができるまで。",
    body: "1. 写真を送る  2. 仕上がりを相談する  3. 制作・お届け。まずは魚全体が分かる写真をお送りください。",
    image: "/images/service-gyotaku.jpg",
    altText: "デジタル魚拓の制作の流れ",
    actions: [
      button(uri("詳しい流れを見る", "/digital-gyotaku")),
      button(message("写真を送って相談する", "デジタル魚拓を相談したい"), true),
    ],
  });
}

export function leatherOrderFlex(): FlexMessage {
  return serviceFlex({
    eyebrow: "CUSTOM ORDER",
    title: "あなたの釣った一匹を、革に。",
    body: "魚種や皮の状態によって、仕立てられる製品や進め方が変わります。まずは魚種・サイズと写真をお送りください。",
    image: "/images/material.jpg",
    altText: "フィッシュレザーのオーダー制作",
    actions: [
      button(uri("オーダーの詳細を見る", "/fish-leather")),
      button(message("相談する", "フィッシュレザーを相談したい"), true),
    ],
  });
}

export function consultationReply(text: string) {
  if (text === "デジタル魚拓を相談したい") {
    return {
      type: "text",
      text: "デジタル魚拓のご相談ですね。\n\n魚全体が分かる写真を、このトークにお送りください。仕上がりのご希望があれば、あわせてお知らせください。\n\n内容を確認して、制作可否や進め方をご案内します。",
    };
  }
  if (text === "フィッシュレザーを相談したい") {
    return {
      type: "text",
      text: "フィッシュレザーのご相談ですね。\n\n魚種・サイズと、皮全体が分かる写真をお送りください。皮の保存方法や、仕立てられる製品についてご案内します。",
    };
  }
  return {
    type: "text",
    text: "お問い合わせありがとうございます。\n\nご相談内容をこのトークにお送りください。内容を確認して、MIHANADAからご案内します。",
  };
}

export function verifyLineSignature(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export async function replyLine(replyToken: string, messages: unknown[]) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`);
  }
}

export function menuResponse(action: string): FlexMessage | undefined {
  switch (action) {
    case "gyotaku": return digitalGyotakuFlex();
    case "fish_leather": return fishLeatherFlex();
    case "about": return aboutFlex();
    case "contact": return contactFlex();
    case "gyotaku_flow": return gyotakuFlowFlex();
    case "leather_order": return leatherOrderFlex();
    default: return undefined;
  }
}
