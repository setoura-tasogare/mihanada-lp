export const GYOTAKU_PRICING = {
  base: 3000,
  backgrounds: { mono: 0, pale: 1000, wood: 1000 },
  options: { square: 500, tackle: 500, witness: 500 },
} as const;

export type GyotakuBackground = keyof typeof GYOTAKU_PRICING.backgrounds;
export type GyotakuOption = keyof typeof GYOTAKU_PRICING.options;

const backgroundNames: Record<GyotakuBackground, string> = {
  mono: "白黒",
  pale: "淡彩",
  wood: "木目",
};

const optionNames: Record<GyotakuOption, string> = {
  square: "スクエア出力",
  tackle: "タックル欄",
  witness: "現認者欄",
};

export function calculateGyotakuAmount(
  background: GyotakuBackground,
  selected: Set<GyotakuOption>,
) {
  return (
    GYOTAKU_PRICING.base +
    GYOTAKU_PRICING.backgrounds[background] +
    [...selected].reduce((sum, option) => sum + GYOTAKU_PRICING.options[option], 0)
  );
}

type CheckoutInput = {
  secretKey: string;
  orderId: string;
  lineUserId: string;
  species: string;
  background: GyotakuBackground;
  options: Set<GyotakuOption>;
  returnUrl: string;
};

export async function createStripeCheckout(input: CheckoutInput) {
  const body = new URLSearchParams({
    mode: "payment",
    locale: "ja",
    client_reference_id: input.orderId,
    success_url: `${input.returnUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.returnUrl}?payment=cancelled&order_id=${encodeURIComponent(input.orderId)}`,
    "metadata[order_id]": input.orderId,
    "metadata[line_user_id]": input.lineUserId,
    "payment_intent_data[metadata][order_id]": input.orderId,
    "payment_intent_data[metadata][line_user_id]": input.lineUserId,
  });

  const items: Array<{ name: string; amount: number }> = [
    { name: `デジタル魚拓 基本制作（${input.species}）`, amount: GYOTAKU_PRICING.base },
  ];
  const backgroundAmount = GYOTAKU_PRICING.backgrounds[input.background];
  if (backgroundAmount > 0) {
    items.push({ name: `背景：${backgroundNames[input.background]}`, amount: backgroundAmount });
  }
  for (const option of input.options) {
    items.push({ name: `追加：${optionNames[option]}`, amount: GYOTAKU_PRICING.options[option] });
  }
  items.forEach((item, index) => {
    body.set(`line_items[${index}][price_data][currency]`, "jpy");
    body.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    body.set(`line_items[${index}][price_data][unit_amount]`, String(item.amount));
    body.set(`line_items[${index}][quantity]`, "1");
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `gyotaku-checkout-${input.orderId}`,
    },
    body,
  });
  const result = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !result.id || !result.url) {
    throw new Error(result.error?.message ?? "Stripe Checkout Sessionの作成に失敗しました");
  }
  return { id: result.id, url: result.url };
}

function parseStripeSignature(header: string) {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  return { timestamp, signatures };
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyStripeWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const { timestamp, signatures } = parseStripeSignature(header);
  const timestampNumber = Number(timestamp);
  if (!timestamp || !Number.isFinite(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > 300) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}
