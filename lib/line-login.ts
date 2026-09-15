export const LINE_LOGIN_CHANNEL_ID =
  process.env.LINE_LOGIN_CHANNEL_ID ?? "2011607510";

export type VerifiedLineIdentity = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LineIdTokenPayload = {
  sub?: unknown;
  name?: unknown;
  picture?: unknown;
  aud?: unknown;
};

export async function verifyLineIdToken(
  idToken: string,
  channelId = LINE_LOGIN_CHANNEL_ID,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedLineIdentity | undefined> {
  if (!idToken || !channelId) return undefined;

  const response = await fetcher("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!response.ok) return undefined;

  const payload = (await response.json()) as LineIdTokenPayload;
  if (
    typeof payload.sub !== "string" ||
    !payload.sub.startsWith("U") ||
    payload.aud !== channelId
  ) {
    return undefined;
  }

  return {
    userId: payload.sub,
    displayName:
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : "LINEユーザー",
    ...(typeof payload.picture === "string" ? { pictureUrl: payload.picture } : {}),
  };
}
