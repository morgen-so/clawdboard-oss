/**
 * Share text formatting and intent URL builders for social sharing.
 */

/**
 * Build the share text for a user's profile.
 * Uses challenge framing to provoke engagement from readers.
 */
export function buildShareText(
  rank: number,
  streak: number,
  totalCost: string,
  totalUsers?: number
): string {
  const formattedCost = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parseFloat(totalCost));
  const rankOf = totalUsers ? ` of ${totalUsers} devs` : "";
  return `I'm ranked #${rank}${rankOf} on clawdboard \u2014 ${streak}-day streak, ${formattedCost} spent vibecoding. Think you can beat me?`;
}

/**
 * Build share text for a streak tier-up celebration.
 */
export function buildStreakShareText(streak: number): string {
  return `${streak}-day vibecoding streak and counting. Can you keep up? \uD83D\uDD25`;
}

/**
 * Build Twitter/X intent URL with pre-populated tweet text.
 * Source: https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent
 */
export function buildTwitterIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url, hashtags: "vibecoding" });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/**
 * Build LinkedIn share intent URL.
 * LinkedIn reads OG tags from the URL automatically.
 */
export function buildLinkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}
