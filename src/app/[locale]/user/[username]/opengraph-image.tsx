export const dynamic = "force-dynamic";

import { ImageResponse } from "next/og";
import {
  getUserByUsername,
  getUserSummary,
  getUserRank,
  getUserDailyData,
} from "@/lib/db/profile";
import { loadGoogleFont } from "@/lib/og-fonts";
import { computeCurrentStreak } from "@/lib/streak";
import { getStreakTier } from "@/lib/streak-tiers";
import { formatTokensCompact, formatUsd } from "@/lib/format";

// ─── Next.js OG Image file convention exports ──────────────────────────────

export const alt = "clawdboard profile stats";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600; // 1 hour cache

// ─── Fallback card for missing users ────────────────────────────────────────

function FallbackCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#09090b",
        padding: "60px",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: "48px",
          fontFamily: "Syne",
          fontWeight: 700,
          color: "#F9A615",
          marginBottom: "24px",
        }}
      >
        clawdboard
      </div>
      <div
        style={{
          display: "flex",
          fontSize: "32px",
          fontFamily: "Syne",
          fontWeight: 700,
          color: "#5a5a6e",
        }}
      >
        User not found
      </div>
    </div>
  );
}

// ─── Image handler ──────────────────────────────────────────────────────────

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params; // Next.js 15: params is a Promise
  const user = await getUserByUsername(decodeURIComponent(username));

  // Load fonts (do this before branching so fallback also gets fonts)
  const [displayFont, monoFont] = await Promise.all([
    loadGoogleFont("Syne", "700"),
    loadGoogleFont("Fira Code", "400"),
  ]);

  if (!user) {
    return new ImageResponse(<FallbackCard />, {
      ...size,
      fonts: [
        {
          name: "Syne",
          data: displayFont,
          weight: 700 as const,
          style: "normal" as const,
        },
        {
          name: "Fira Code",
          data: monoFont,
          weight: 400 as const,
          style: "normal" as const,
        },
      ],
    });
  }

  // Fetch user data in parallel
  const [summary, rank, dailyData] = await Promise.all([
    getUserSummary(user.id),
    getUserRank(user.id),
    getUserDailyData(user.id),
  ]);

  const currentStreak = computeCurrentStreak(dailyData);
  const streakTier = getStreakTier(currentStreak);
  const ringColor = streakTier.staticRingColor;

  const totalTokens =
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheCreation +
    summary.totalCacheRead;

  // Generate initials for avatar fallback
  const initials = (user.githubUsername ?? user.name ?? "?")
    .slice(0, 2)
    .toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#09090b",
          padding: "48px 56px",
        }}
      >
        {/* Top section - User identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "24px",
          }}
        >
          {/* Avatar with streak aura ring */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "128px",
              height: "128px",
              borderRadius: "64px",
              background: ringColor,
              flexShrink: 0,
            }}
          >
            {user.image ? (
              <img
                src={user.image}
                alt={user.githubUsername ?? "avatar"}
                width={120}
                height={120}
                style={{
                  borderRadius: "60px",
                  border: "3px solid #09090b",
                }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "120px",
                  height: "120px",
                  borderRadius: "60px",
                  backgroundColor: "#111113",
                  border: "3px solid #09090b",
                  fontSize: "40px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#F9A615",
                }}
              >
                {initials}
              </div>
            )}
          </div>

          {/* Username */}
          <div
            style={{
              display: "flex",
              flex: 1,
              fontSize: "48px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#fafafa",
            }}
          >
            {user.githubUsername ?? user.name ?? "Unknown"}
          </div>

          {/* Rank badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "64px",
              height: "64px",
              borderRadius: "32px",
              backgroundColor: "#F9A615",
              fontSize: "24px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#09090b",
            }}
          >
            #{rank.rank}
          </div>
        </div>

        {/* Stats section */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: "24px",
            marginTop: "48px",
            flex: 1,
          }}
        >
          {/* Total Cost */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: "16px",
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "14px",
                fontFamily: "Fira Code",
                color: "#5a5a6e",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Total Cost
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "36px",
                fontFamily: "Syne",
                fontWeight: 700,
                color: "#F9A615",
              }}
            >
              {formatUsd(summary.totalCost)}
            </div>
          </div>

          {/* Total Tokens */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: "16px",
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "14px",
                fontFamily: "Fira Code",
                color: "#5a5a6e",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Total Tokens
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "36px",
                fontFamily: "Syne",
                fontWeight: 700,
                color: "#fafafa",
              }}
            >
              {formatTokensCompact(totalTokens)}
            </div>
          </div>

          {/* Rank */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: "16px",
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "14px",
                fontFamily: "Fira Code",
                color: "#5a5a6e",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Rank
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "baseline",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: "36px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                #{rank.rank}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "18px",
                  fontFamily: "Fira Code",
                  color: "#5a5a6e",
                }}
              >
                of {rank.totalUsers}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom branding */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "auto",
            paddingTop: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "24px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#F9A615",
            }}
          >
            clawdboard
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "16px",
              fontFamily: "Fira Code",
              color: "#5a5a6e",
            }}
          >
            clawdboard.ai
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Syne",
          data: displayFont,
          weight: 700 as const,
          style: "normal" as const,
        },
        {
          name: "Fira Code",
          data: monoFont,
          weight: 400 as const,
          style: "normal" as const,
        },
      ],
    }
  );
}
