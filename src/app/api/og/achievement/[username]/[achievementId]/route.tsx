import { ImageResponse } from "next/og";
import { BADGES } from "@/lib/badges";
import { getUserByUsername } from "@/lib/db/profile";
import {
  getUserSummary,
  getUserRank,
  getUserDailyData,
} from "@/lib/db/cached";
import { computeCurrentStreak } from "@/lib/streak";
import { loadGoogleFont } from "@/lib/og-fonts";
import { formatUsd } from "@/lib/format";

// ─── Cache ──────────────────────────────────────────────────────────────────

export const revalidate = 3600; // 1 hour

function getInitials(name: string | null, username: string | null): string {
  return (username ?? name ?? "?").slice(0, 2).toUpperCase();
}

// ─── GET handler ────────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string; achievementId: string }> }
) {
  const { username, achievementId } = await params;

  // Look up achievement definition
  const achievement = BADGES.find((a) => a.id === achievementId);
  if (!achievement) {
    return new Response("Achievement not found", { status: 404 });
  }

  // Look up user
  const user = await getUserByUsername(decodeURIComponent(username));
  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // Fetch data and fonts in parallel
  const [summary, rank, dailyData, displayFont, monoFont] = await Promise.all([
    getUserSummary(user.id),
    getUserRank(user.id),
    getUserDailyData(user.id),
    loadGoogleFont("Syne", "700"),
    loadGoogleFont("Fira Code", "400"),
  ]);

  const currentStreak = computeCurrentStreak(dailyData);
  const initials = getInitials(user.name, user.githubUsername);

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
        {/* Top section - Achievement highlight */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginBottom: "36px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "40px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#F9A615",
              marginBottom: "8px",
            }}
          >
            {achievement.label}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "20px",
              fontFamily: "Fira Code",
              color: "#5a5a6e",
            }}
          >
            {achievement.description}
          </div>
        </div>

        {/* Middle section - User identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "24px",
            marginBottom: "36px",
          }}
        >
          {/* Avatar */}
          {user.image ? (
            <img
              src={user.image}
              alt={user.githubUsername ?? "avatar"}
              width={80}
              height={80}
              style={{
                borderRadius: "40px",
                border: "3px solid #23232a",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "80px",
                height: "80px",
                borderRadius: "40px",
                backgroundColor: "#111113",
                border: "3px solid #23232a",
                fontSize: "28px",
                fontFamily: "Syne",
                fontWeight: 700,
                color: "#F9A615",
              }}
            >
              {initials}
            </div>
          )}

          {/* Username */}
          <div
            style={{
              display: "flex",
              flex: 1,
              fontSize: "36px",
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
              width: "48px",
              height: "48px",
              borderRadius: "24px",
              backgroundColor: "#F9A615",
              fontSize: "18px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#09090b",
            }}
          >
            #{rank.rank}
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: "24px",
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

          {/* Current Streak */}
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
              Current Streak
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
              {currentStreak} days
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
