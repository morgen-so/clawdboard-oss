import { ImageResponse } from "next/og";
import { getRecapById } from "@/lib/db/recaps";
import { loadGoogleFont } from "@/lib/og-fonts";
import type { RecapData } from "@/lib/db/schema";
import { formatTokensCompact, formatUsdWhole } from "@/lib/format";

export const revalidate = 3600;

function getMedalEmoji(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  return "";
}

const barColors = ["#F9A615", "#3b82f6", "#10b981"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const recap = await getRecapById(id);

  if (!recap) {
    return new Response("Recap not found", { status: 404 });
  }

  const [displayFont, monoFont] = await Promise.all([
    loadGoogleFont("Syne", "700"),
    loadGoogleFont("Fira Code", "400"),
  ]);

  const data = recap.data as RecapData;
  const periodLabel = recap.type === "weekly" ? "Weekly Recap" : "Monthly Recap";
  const s = new Date(recap.periodStart + "T12:00:00Z");
  const e = new Date(recap.periodEnd + "T12:00:00Z");
  const dateRange = `${s.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} \u2013 ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  const modelBars = data.modelBreakdown.slice(0, 3);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "48px 56px",
          background: "linear-gradient(135deg, #0a0a0c 0%, #1a1a2e 50%, #0a0a0c 100%)",
        }}
      >
        {/* Top row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: "36px",
                fontFamily: "Syne",
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              <span style={{ color: "#F9A615" }}>$</span> clawdboard
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "18px",
                fontFamily: "Fira Code",
                color: "rgba(255,255,255,0.3)",
                marginTop: "4px",
              }}
            >
              {periodLabel} &middot; {dateRange}
            </div>
          </div>
          {data.stateTier === "podium" && (
            <div style={{ display: "flex", fontSize: "64px" }}>
              {getMedalEmoji(data.rank)}
            </div>
          )}
        </div>

        {/* Center rank */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "144px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#ffffff",
            }}
          >
            #{data.rank}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "24px",
              fontFamily: "Fira Code",
              color: "rgba(255,255,255,0.3)",
              marginTop: "8px",
            }}
          >
            of {data.totalUsers} developers
          </div>
        </div>

        {/* Bottom stats */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: "48px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "16px",
                  fontFamily: "Fira Code",
                  color: "rgba(255,255,255,0.3)",
                }}
              >
                Spent
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "40px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#ffffff",
                }}
              >
                {formatUsdWhole(data.totalCost)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "16px",
                  fontFamily: "Fira Code",
                  color: "rgba(255,255,255,0.3)",
                }}
              >
                Tokens
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "40px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#ffffff",
                }}
              >
                {formatTokensCompact(data.totalTokens)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "16px",
                  fontFamily: "Fira Code",
                  color: "rgba(255,255,255,0.3)",
                }}
              >
                Streak
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "40px",
                  fontFamily: "Syne",
                  fontWeight: 700,
                  color: "#F9A615",
                }}
              >
                {data.currentStreak}d
              </div>
            </div>
          </div>

          {/* Model bars */}
          {modelBars.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "6px",
              }}
            >
              {modelBars.map((m, i) => (
                <div
                  key={m.name}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontSize: "14px",
                      fontFamily: "Fira Code",
                      color: "rgba(255,255,255,0.3)",
                    }}
                  >
                    {m.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      height: "8px",
                      borderRadius: "4px",
                      width: `${Math.max(20, m.percentage * 1.6)}px`,
                      backgroundColor: barColors[i],
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
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
