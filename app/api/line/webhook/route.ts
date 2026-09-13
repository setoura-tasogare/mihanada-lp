import { handleLineWebhook } from "@/lib/line-webhook";

// Compatibility endpoint. Production LINE traffic uses Cloudflare Workers.
export async function POST(request: Request) {
  return handleLineWebhook(request, {
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET ?? "",
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  });
}
