export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function buildInviteUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/join/${slug}?token=${token}`;
}

export function buildProfileHref(
  username: string,
  period?: string,
  rangeFrom?: string,
  rangeTo?: string,
  timeZone?: string
): string {
  const base = `/user/${username}`;
  if (period === "custom" && rangeFrom && rangeTo) {
    return `${base}?period=custom&from=${rangeFrom}&to=${rangeTo}`;
  }
  if (!period || (period === "7d" && !timeZone)) return base;
  const params = new URLSearchParams({ period });
  if (timeZone) params.set("tz", timeZone);
  return `${base}?${params.toString()}`;
}
