import { forwardRef } from "react";
import { getStreakTier } from "@/lib/streak-tiers";
import { formatTokensCompact, formatUsd } from "@/lib/format";

interface ShareCardProps {
  username: string;
  image: string | null;
  totalCost: string;
  totalTokens: number;
  rank: number;
  totalUsers: number;
  percentile: number;
  streak: number;
}


/**
 * Pure presentational card matching the OG image layout.
 * Fixed 1200x630px with hardcoded colors for reliable html-to-image capture.
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  function ShareCard(
    {
      username,
      image,
      totalCost,
      totalTokens,
      rank,
      totalUsers,
      percentile,
      streak,
    },
    ref
  ) {
    const initials = username.slice(0, 2).toUpperCase();
    const streakTier = getStreakTier(streak);
    const ringColor = streakTier.staticRingColor;

    return (
      <div
        ref={ref}
        style={{
          display: "flex",
          flexDirection: "column",
          width: 1200,
          height: 630,
          backgroundColor: "#09090b",
          padding: "48px 56px",
          fontFamily: "'Syne', sans-serif",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Top section - User identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Avatar with streak aura ring */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 128,
              height: 128,
              borderRadius: 64,
              background: ringColor,
              flexShrink: 0,
            }}
          >
            {image ? (
              <img
                src={image}
                alt={username}
                crossOrigin="anonymous"
                width={120}
                height={120}
                style={{
                  borderRadius: 60,
                  border: "3px solid #09090b",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  backgroundColor: "#111113",
                  border: "3px solid #09090b",
                  fontSize: 40,
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
              flex: 1,
              fontSize: 48,
              fontWeight: 700,
              color: "#fafafa",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {username}
          </div>

          {/* Rank badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "#F9A615",
              fontSize: 24,
              fontWeight: 700,
              color: "#09090b",
              flexShrink: 0,
            }}
          >
            #{rank}
          </div>
        </div>

        {/* Stats section */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 24,
            marginTop: 48,
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
              borderRadius: 16,
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontFamily: "'Fira Code', monospace",
                color: "#5a5a6e",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Total Cost
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: "#F9A615",
              }}
            >
              {formatUsd(totalCost)}
            </div>
          </div>

          {/* Streak */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: 16,
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontFamily: "'Fira Code', monospace",
                color: "#5a5a6e",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Streak
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: "#fafafa",
              }}
            >
              {streak > 0 ? `${streak}d` : "0d"}
            </div>
          </div>

          {/* Rank */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: 16,
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontFamily: "'Fira Code', monospace",
                color: "#5a5a6e",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Rank
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                #{rank}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontFamily: "'Fira Code', monospace",
                  color: "#5a5a6e",
                }}
              >
                of {totalUsers}
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontFamily: "'Fira Code', monospace",
                color: "#F9A615",
                marginTop: 4,
              }}
            >
              Top {percentile}%
            </div>
          </div>

          {/* Tokens */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: "#111113",
              borderRadius: 16,
              border: "1px solid #23232a",
              padding: "28px 32px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontFamily: "'Fira Code', monospace",
                color: "#5a5a6e",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Total Tokens
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: "#fafafa",
              }}
            >
              {formatTokensCompact(totalTokens)}
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
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#F9A615",
            }}
          >
            clawdboard
          </div>
          <div
            style={{
              fontSize: 16,
              fontFamily: "'Fira Code', monospace",
              color: "#5a5a6e",
            }}
          >
            clawdboard.ai
          </div>
        </div>
      </div>
    );
  }
);
