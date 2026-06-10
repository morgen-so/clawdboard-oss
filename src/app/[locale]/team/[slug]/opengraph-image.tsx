export const dynamic = "force-dynamic";

import { ImageResponse } from "next/og";
import { getTeamBySlug } from "@/lib/db/teams";
import { getTeamStats } from "@/lib/db/cached";
import { loadGoogleFont } from "@/lib/og-fonts";
import { formatTokensCompact, formatUsd } from "@/lib/format";

// ─── Next.js OG Image file convention exports ──────────────────────────────

export const alt = "clawdboard team stats";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600; // 1 hour cache

// ─── Fallback card for missing teams ────────────────────────────────────────

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
        Team not found
      </div>
    </div>
  );
}

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
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
        {label}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: "36px",
          fontFamily: "Syne",
          fontWeight: 700,
          color: highlight ? "#F9A615" : "#fafafa",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Image handler ──────────────────────────────────────────────────────────

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(decodeURIComponent(slug));

  const [displayFont, monoFont] = await Promise.all([
    loadGoogleFont("Syne", "700"),
    loadGoogleFont("Fira Code", "400"),
  ]);

  const fonts = [
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
  ];

  if (!team) {
    return new ImageResponse(<FallbackCard />, { ...size, fonts });
  }

  const stats = await getTeamStats(team.id);

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
        {/* Top section - Team identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "24px",
          }}
        >
          {/* Team icon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "96px",
              height: "96px",
              borderRadius: "20px",
              backgroundColor: "#F9A615",
              fontSize: "40px",
              fontFamily: "Syne",
              fontWeight: 700,
              color: "#09090b",
              flexShrink: 0,
            }}
          >
            {team.name.slice(0, 2).toUpperCase()}
          </div>

          {/* Team name */}
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
            {team.name}
          </div>

          {/* Member count badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 20px",
              borderRadius: "32px",
              backgroundColor: "#111113",
              border: "1px solid #23232a",
              fontSize: "18px",
              fontFamily: "Fira Code",
              color: "#F9A615",
            }}
          >
            {stats.memberCount} {stats.memberCount === 1 ? "member" : "members"}
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
          <StatCard label="Total Cost" value={formatUsd(stats.totalCost)} highlight />
          <StatCard label="Total Tokens" value={formatTokensCompact(stats.totalTokens)} />
          <StatCard label="Active Days" value={String(stats.activeDays)} />
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
    { ...size, fonts }
  );
}
