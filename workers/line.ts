import { handleLineWebhook, type LineEnv } from "../lib/line-webhook";

export default {
  async fetch(request: Request, env: LineEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      const ready = Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);
      return Response.json({ ok: ready }, { status: ready ? 200 : 503 });
    }
    if (path !== "/api/line/webhook") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    return handleLineWebhook(request, env);
  },
};
