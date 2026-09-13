import fs from "node:fs/promises";
import { richMenu } from "../lib/line-rich-menu";
import { checkLineConnection } from "./check-line-connection";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN before running this script.");

const imagePath = new URL("../public/line/rich-menu.png", import.meta.url);

async function lineFetch(path: string, init: RequestInit = {}, origin = "https://api.line.me") {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

async function main() {
  // Verify the account and the deployed webhook before changing the default menu.
  await checkLineConnection();
  const image = await fs.readFile(imagePath);
  if (image.length > 1024 * 1024) throw new Error("Rich menu image exceeds 1 MB.");
  const previousResponse = await fetch("https://api.line.me/v2/bot/user/all/richmenu", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!previousResponse.ok && previousResponse.status !== 404) {
    throw new Error(`Cannot check previous default menu (${previousResponse.status}).`);
  }
  const previous = previousResponse.status === 404 ? null : await previousResponse.json();
  console.log("Previous API default menu:", previous?.richMenuId ?? "none (check Manager)");

  const created = (await lineFetch("/v2/bot/richmenu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(richMenu),
  }).then((response) => response.json())) as { richMenuId: string };

  console.log("Created menu:", created.richMenuId);
  await lineFetch(`/v2/bot/richmenu/${created.richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array(image),
  }, "https://api-data.line.me");
  await lineFetch(`/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: "POST" });

  const current = await lineFetch("/v2/bot/user/all/richmenu").then(r => r.json());
  if (current.richMenuId !== created.richMenuId) throw new Error("Default menu verification failed.");
  console.log(`Rich menu created and set as default: ${created.richMenuId}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
