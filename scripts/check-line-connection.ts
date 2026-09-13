import { pathToFileURL } from "node:url";
import { menuResponse, consultationReply } from "../lib/line";
import { richMenu } from "../lib/line-rich-menu";

// Validation endpoints do not send messages to friends.
export async function checkLineConnection() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const expectedId = process.env.LINE_EXPECTED_BASIC_ID;
  const endpoint = process.env.LINE_WEBHOOK_URL;
  if (!token || !expectedId || !endpoint) {
    throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN, LINE_EXPECTED_BASIC_ID and LINE_WEBHOOK_URL.");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Webhook must use HTTPS.");

  async function api(path: string, body?: unknown) {
    const response = await fetch(`https://api.line.me${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`LINE check failed: ${path} (${response.status})`);
    return response.json();
  }

  const bot = await api("/v2/bot/info");
  if (bot.basicId !== expectedId) throw new Error("Token belongs to a different LINE account.");
  console.log(`Account verified: ${bot.displayName} (${bot.basicId})`);
  for (const action of ["gyotaku", "fish_leather", "contact", "about", "gyotaku_flow", "leather_order"]) {
    await api("/v2/bot/message/validate/reply", { messages: [menuResponse(action)] });
  }
  for (const text of ["デジタル魚拓を相談したい", "フィッシュレザーの商品について問い合わせたい", "フィッシュレザーのオーダーメイドを相談したい", "その他の相談をしたい"]) {
    await api("/v2/bot/message/validate/reply", { messages: [consultationReply(text)] });
  }
  await api("/v2/bot/richmenu/validate", richMenu);
  const test = await api("/v2/bot/channel/webhook/test", { endpoint });
  if (!test.success) throw new Error(`Webhook verification failed (${test.statusCode ?? "unknown"}).`);
  const current = await api("/v2/bot/channel/webhook/endpoint");
  console.log("Flex, menu and webhook verification passed.");
  if (current.endpoint !== endpoint || current.active !== true) {
    throw new Error("Set the verified webhook URL and enable Use webhook in LINE Developers before activating the menu.");
  }
  console.log("Webhook URL and Use webhook are configured.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkLineConnection().catch(error => { console.error(error.message); process.exitCode = 1; });
}
