export const dynamic = "force-dynamic";

import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getLeaderboardData, getVibeCoderCount } from "@/lib/db/cached";
import { getStreakTier } from "@/lib/streak-tiers";
import { loadGoogleFont } from "@/lib/og-fonts";

// ─── Next.js OG Image file convention exports ──────────────────────────────

export const alt = "clawdboard — AI Coding Usage Leaderboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600; // 1 hour cache

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtCost(cost: string): string {
  const n = parseFloat(cost);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

function rankIcon(delta: number | null): string {
  if (delta === null) return "";  // NEW user — handled separately
  if (delta > 0) return "▲";
  if (delta < 0) return "▼";
  return "";
}

function rankIconColor(delta: number | null, rank: number): string {
  if (rank === 1) return "#F9A615";
  if (delta === null) return "#F9A615";
  if (delta > 0) return "#22c55e";
  if (delta < 0) return "#ef4444";
  return "#5a5a6e";
}

const AVATAR_COLORS = ["#F9A615", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

// ─── Image handler ──────────────────────────────────────────────────────────

export default async function Image() {
  const [{ rows }, vibeCoderCount, displayFont, monoFont, aggResult] =
    await Promise.all([
      getLeaderboardData("ytd", "cost", "desc"),
      getVibeCoderCount(),
      loadGoogleFont("Syne", "700"),
      loadGoogleFont("Fira Code", "400"),
      db.execute(
        sql`SELECT SUM(total_cost::numeric)::text AS total_cost, SUM(input_tokens + output_tokens) AS total_tokens FROM daily_aggregates`
      ),
    ]);

  const top5 = rows.slice(0, 5);
  const totalCost = parseFloat(
    (aggResult.rows[0]?.total_cost as string) ?? "0"
  );
  const totalTokens = Number(aggResult.rows[0]?.total_tokens ?? 0);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          width: "100%",
          height: "100%",
          backgroundColor: "#09090b",
          padding: "48px 52px",
          gap: "48px",
        }}
      >
        {/* ── Left column: headline + tagline + stats ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "480px",
            flexShrink: 0,
          }}
        >
          {/* Terminal prompt */}
          <div
            style={{
              display: "flex",
              fontSize: "16px",
              fontFamily: "Fira Code",
              color: "#F9A615",
              marginBottom: "12px",
            }}
          >
            $ whoami
          </div>

          {/* Headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: "48px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.1,
            }}
          >
            <span>{"Who's shipping"}</span>
            <span>
              {"the "}
              <span style={{ color: "#F9A615" }}>{"most"}</span>
            </span>
            <span>with Claude?</span>
          </div>

          {/* Tagline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: "17px",
              fontFamily: "Fira Code",
              color: "#5a5a6e",
              marginTop: "24px",
              lineHeight: 1.6,
            }}
          >
            <span>Track your AI coding usage.</span>
            <span>Compete with your team.</span>
            <span>Earn your streak.</span>
          </div>

          {/* Aggregate stats */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              marginTop: "auto",
              gap: "32px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "28px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                {fmtCost(String(totalCost))}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "11px",
                  fontFamily: "Fira Code",
                  color: "#5a5a6e",
                  letterSpacing: "1.5px",
                  marginTop: "4px",
                }}
              >
                TOTAL SPENT
              </div>
            </div>

            <div
              style={{
                display: "flex",
                width: "1px",
                backgroundColor: "#23232a",
                alignSelf: "stretch",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "28px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                {fmtTokens(totalTokens)}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "11px",
                  fontFamily: "Fira Code",
                  color: "#5a5a6e",
                  letterSpacing: "1.5px",
                  marginTop: "4px",
                }}
              >
                TOKENS USED
              </div>
            </div>

            <div
              style={{
                display: "flex",
                width: "1px",
                backgroundColor: "#23232a",
                alignSelf: "stretch",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "28px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#fafafa",
                }}
              >
                {vibeCoderCount.toLocaleString("en-US")}+
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "11px",
                  fontFamily: "Fira Code",
                  color: "#5a5a6e",
                  letterSpacing: "1.5px",
                  marginTop: "4px",
                }}
              >
                ENGINEERS
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column: mini leaderboard ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              padding: "0 16px 10px 16px",
              borderBottom: "1px solid #23232a",
              fontSize: "11px",
              fontFamily: "Fira Code",
              color: "#5a5a6e",
              letterSpacing: "1.5px",
            }}
          >
            <div style={{ display: "flex", width: "40px" }}>#</div>
            <div style={{ display: "flex", flex: 1 }}>USER</div>
            <div style={{ display: "flex", width: "100px", justifyContent: "flex-end" }}>
              COST
            </div>
            <div style={{ display: "flex", width: "80px", justifyContent: "flex-end" }}>
              TOKENS
            </div>
            <div style={{ display: "flex", width: "100px", justifyContent: "flex-end" }}>
              STREAK
            </div>
          </div>

          {/* Rows */}
          {top5.map((row, i) => {
            const rank = i + 1;
            const tier = getStreakTier(row.currentStreak);
            const initials = (row.githubUsername ?? "?")
              .slice(0, 2)
              .toUpperCase();
            const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
            const isFirst = rank === 1;

            return (
              <div
                key={row.userId}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  padding: "14px 16px",
                  borderBottom: "1px solid #1a1a1f",
                  backgroundColor: isFirst ? "rgba(249, 166, 21, 0.04)" : "transparent",
                }}
              >
                {/* Rank + movement icon */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "40px",
                    gap: "4px",
                    fontSize: "14px",
                    fontFamily: "Fira Code",
                    color: rank <= 3 ? "#F9A615" : "#5a5a6e",
                  }}
                >
                  {rank === 1 && (
                    <span style={{ color: "#F9A615", fontSize: "10px" }}>
                      {"◆"}
                    </span>
                  )}
                  {rank > 1 && rankIcon(row.rankDelta) && (
                    <span
                      style={{
                        color: rankIconColor(row.rankDelta, rank),
                        fontSize: "10px",
                      }}
                    >
                      {rankIcon(row.rankDelta)}
                    </span>
                  )}
                  <span>{rank}</span>
                </div>

                {/* Avatar initials */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "36px",
                    height: "36px",
                    borderRadius: "18px",
                    border: `2px solid ${avatarColor}`,
                    backgroundColor: "#111113",
                    fontSize: "13px",
                    fontFamily: "Syne",
                    fontWeight: 700,
                    color: avatarColor,
                    flexShrink: 0,
                    marginRight: "12px",
                  }}
                >
                  {initials}
                </div>

                {/* Username + badges */}
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "16px",
                    fontFamily: "Syne",
                    fontWeight: 700,
                    color: isFirst ? "#fafafa" : "#a1a1aa",
                    overflow: "hidden",
                  }}
                >
                  <span>{row.githubUsername ?? "anonymous"}</span>
                  {row.rankDelta === null && (
                    <span
                      style={{
                        display: "flex",
                        fontSize: "9px",
                        fontFamily: "Fira Code",
                        color: "#F9A615",
                        backgroundColor: "rgba(249, 166, 21, 0.15)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        letterSpacing: "0.5px",
                      }}
                    >
                      NEW
                    </span>
                  )}
                </div>

                {/* Cost */}
                <div
                  style={{
                    display: "flex",
                    width: "100px",
                    justifyContent: "flex-end",
                    fontSize: "15px",
                    fontFamily: "Fira Code",
                    color: "#F9A615",
                  }}
                >
                  ${parseFloat(row.totalCost).toFixed(2)}
                </div>

                {/* Tokens */}
                <div
                  style={{
                    display: "flex",
                    width: "80px",
                    justifyContent: "flex-end",
                    fontSize: "14px",
                    fontFamily: "Fira Code",
                    color: "#5a5a6e",
                  }}
                >
                  {fmtTokens(row.totalTokens)}
                </div>

                {/* Streak */}
                <div
                  style={{
                    display: "flex",
                    width: "100px",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "14px",
                    fontFamily: "Fira Code",
                    color: tier.tier >= 2 ? "#F9A615" : "#5a5a6e",
                  }}
                >
                  {tier.tier >= 2 && (
                    <span style={{ fontSize: "13px" }}>
                      {tier.icon}
                    </span>
                  )}
                  {row.currentStreak > 0 && (
                    <span>{row.currentStreak}</span>
                  )}
                  {tier.tier >= 2 && (
                    <span style={{ fontSize: "12px", color: "#5a5a6e" }}>
                      {tier.name}
                    </span>
                  )}
                  {tier.tier < 2 && row.currentStreak > 0 && (
                    <span style={{ fontSize: "10px" }}>{"·"}</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Bottom right — CTA */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "flex-end",
              alignItems: "center",
              marginTop: "auto",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "15px",
                fontFamily: "Fira Code",
                color: "#5a5a6e",
              }}
            >
              {"See where you rank \u2192"}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "15px",
                fontFamily: "Syne",
                fontWeight: 700,
                color: "#F9A615",
                border: "1px solid #F9A615",
                borderRadius: "8px",
                padding: "8px 16px",
              }}
            >
              clawdboard.ai
            </div>
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
