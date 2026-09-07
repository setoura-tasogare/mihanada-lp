import fs from "node:fs/promises";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN before running this script.");

const imagePath = new URL("../public/line/rich-menu.png", import.meta.url);

async function lineFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.line.me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

const menu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "MIHANADA 基本メニュー",
  chatBarText: "MIHANADA メニュー",
  areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: "postback", data: "action=gyotaku" } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: "postback", data: "action=fish_leather" } },
    { bounds: { x: 0, y: 843, width: 1250, height: 843 }, action: { type: "postback", data: "action=about" } },
    { bounds: { x: 1250, y: 843, width: 1250, height: 843 }, action: { type: "postback", data: "action=contact" } },
  ],
};

const created = (await lineFetch("/v2/bot/richmenu", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(menu),
}).then((response) => response.json())) as { richMenuId: string };

const image = await fs.readFile(imagePath);
await lineFetch(`/v2/bot/richmenu/${created.richMenuId}/content`, {
  method: "POST",
  headers: { "Content-Type": "image/png" },
  body: image,
});
await lineFetch(`/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: "POST" });

console.log(`Rich menu created and set as default: ${created.richMenuId}`);
