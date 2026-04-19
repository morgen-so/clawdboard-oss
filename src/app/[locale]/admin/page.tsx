import type { Metadata } from "next";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { users, pageVisits, feedback } from "@/lib/db/schema";
import { sql, count, countDistinct, gte, desc } from "drizzle-orm";
import { AdminLogin } from "./AdminLogin";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-session";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

async function verifyAdmin(): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const isAdmin = await verifyAdmin();

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AdminLogin configured={!!env.ADMIN_PASSWORD} />
      </div>
    );
  }

  // ── Queries ─────────────────────────────────────────
  const now = new Date();
  const day1 = daysAgo(1);
  const day7 = daysAgo(7);
  const day30 = daysAgo(30);

  const [
    totalUsersResult,
    dauResult,
    wauResult,
    mauResult,
    signupsResult,
    activationResult,
    feedbackResult,
  ] = await Promise.all([
    // Total users
    db.select({ value: count() }).from(users),

    // DAU — distinct users with visits in last 24h
    db
      .select({ value: countDistinct(pageVisits.userId) })
      .from(pageVisits)
      .where(gte(pageVisits.visitedAt, day1)),

    // WAU — last 7 days
    db
      .select({ value: countDistinct(pageVisits.userId) })
      .from(pageVisits)
      .where(gte(pageVisits.visitedAt, day7)),

    // MAU — last 30 days
    db
      .select({ value: countDistinct(pageVisits.userId) })
      .from(pageVisits)
      .where(gte(pageVisits.visitedAt, day30)),

    // New signups last 30 days — daily breakdown
    db.execute<{ day: string; signups: string }>(sql`
      SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*) AS signups
      FROM users
      WHERE created_at >= ${day30}
      GROUP BY day
      ORDER BY day DESC
    `),

    // Activation rate: % of users created in last 30d who have 3+ page visits in first 7 days
    db.execute<{ total_new: string; activated: string }>(sql`
      WITH new_users AS (
        SELECT id, created_at FROM users WHERE created_at >= ${day30}
      ),
      visit_counts AS (
        SELECT nu.id, COUNT(pv.id) AS visits
        FROM new_users nu
        LEFT JOIN page_visits pv
          ON pv.user_id = nu.id
          AND pv.visited_at <= nu.created_at + interval '7 days'
        GROUP BY nu.id
      )
      SELECT
        COUNT(*)::text AS total_new,
        COUNT(*) FILTER (WHERE visits >= 3)::text AS activated
      FROM visit_counts
    `),

    // Recent feedback
    db
      .select()
      .from(feedback)
      .orderBy(desc(feedback.createdAt))
      .limit(50),
  ]);

  const totalUsers = totalUsersResult[0]?.value ?? 0;
  const dau = dauResult[0]?.value ?? 0;
  const wau = wauResult[0]?.value ?? 0;
  const mau = mauResult[0]?.value ?? 0;

  const signupsRows = signupsResult.rows ?? [];
  const recentSignups = signupsRows.reduce(
    (sum: number, r: { signups: string }) => sum + Number(r.signups),
    0
  );

  const activationRows = activationResult.rows ?? [];
  const totalNew = Number(activationRows[0]?.total_new ?? 0);
  const activated = Number(activationRows[0]?.activated ?? 0);
  const activationRate = totalNew > 0 ? ((activated / totalNew) * 100).toFixed(1) : "—";

  // ── Cumulative signups (last 30d) ───────────────────
  let cumulative = 0;
  const cumulativeData = [...signupsRows].reverse().map((r: { day: string; signups: string }) => {
    cumulative += Number(r.signups);
    return { day: r.day, total: cumulative };
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold text-foreground">
            <span className="text-accent">$</span> admin --growth
          </h1>
          <p className="text-xs text-muted mt-1 font-mono">
            Growth metrics dashboard &middot; updated on each page load
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total Users" value={totalUsers} />
          <StatCard label="DAU" value={dau} sub="24h" />
          <StatCard label="WAU" value={wau} sub="7d" />
          <StatCard label="MAU" value={mau} sub="30d" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          <StatCard label="New Signups" value={recentSignups} sub="30d" />
          <StatCard label="Activated" value={`${activated}/${totalNew}`} sub="3+ visits in 7d" />
          <StatCard label="Activation Rate" value={`${activationRate}%`} sub="30d cohort" />
        </div>

        {/* Daily signups table */}
        <div className="mb-8">
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">
            <span className="text-accent">$</span> signups --daily
          </h2>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-2 text-muted font-medium">Date</th>
                  <th className="text-right px-4 py-2 text-muted font-medium">Signups</th>
                </tr>
              </thead>
              <tbody>
                {signupsRows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-muted">
                      No signups in last 30 days
                    </td>
                  </tr>
                ) : (
                  signupsRows.map((row: { day: string; signups: string }) => (
                    <tr key={row.day} className="border-b border-border last:border-0 hover:bg-surface-hover">
                      <td className="px-4 py-2 text-foreground">{row.day}</td>
                      <td className="px-4 py-2 text-right text-accent font-semibold">{row.signups}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cumulative signups */}
        {cumulativeData.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display text-sm font-semibold text-foreground mb-3">
              <span className="text-accent">$</span> signups --cumulative
            </h2>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="text-left px-4 py-2 text-muted font-medium">Date</th>
                    <th className="text-right px-4 py-2 text-muted font-medium">Cumulative</th>
                    <th className="text-right px-4 py-2 text-muted font-medium">Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {cumulativeData.map((row) => {
                    const maxTotal = cumulativeData[cumulativeData.length - 1]?.total ?? 1;
                    const pct = maxTotal > 0 ? (row.total / maxTotal) * 100 : 0;
                    return (
                      <tr key={row.day} className="border-b border-border last:border-0 hover:bg-surface-hover">
                        <td className="px-4 py-2 text-foreground">{row.day}</td>
                        <td className="px-4 py-2 text-right text-accent font-semibold">{row.total}</td>
                        <td className="px-4 py-2">
                          <div className="h-3 rounded-sm bg-surface overflow-hidden">
                            <div
                              className="h-full bg-accent/40 rounded-sm"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Engagement ratios */}
        <div className="mb-8">
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">
            <span className="text-accent">$</span> engagement --ratios
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <RatioCard
              label="DAU/MAU"
              value={mau > 0 ? ((dau / mau) * 100).toFixed(1) + "%" : "—"}
              description="Daily stickiness"
            />
            <RatioCard
              label="WAU/MAU"
              value={mau > 0 ? ((wau / mau) * 100).toFixed(1) + "%" : "—"}
              description="Weekly stickiness"
            />
          </div>
        </div>

        {/* Feedback */}
        <div className="mb-8">
          <h2 className="font-display text-sm font-semibold text-foreground mb-3">
            <span className="text-accent">$</span> feedback --recent
          </h2>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-2 text-muted font-medium">Date</th>
                  <th className="text-left px-4 py-2 text-muted font-medium">User</th>
                  <th className="text-left px-4 py-2 text-muted font-medium">Message</th>
                  <th className="text-left px-4 py-2 text-muted font-medium">Email</th>
                </tr>
              </thead>
              <tbody>
                {feedbackResult.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted">
                      No feedback yet
                    </td>
                  </tr>
                ) : (
                  feedbackResult.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0 hover:bg-surface-hover align-top">
                      <td className="px-4 py-2 text-muted whitespace-nowrap">
                        {row.createdAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-2 text-foreground whitespace-nowrap">
                        {row.username ? `@${row.username}` : "anonymous"}
                      </td>
                      <td className="px-4 py-2 text-foreground max-w-md">
                        {row.message}
                      </td>
                      <td className="px-4 py-2 text-muted whitespace-nowrap">
                        {row.email ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="border border-border rounded-lg bg-surface p-4">
      <div className="text-[10px] text-muted font-mono uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-2xl font-display font-bold text-foreground">{value}</div>
      {sub && (
        <div className="text-[10px] text-dim font-mono mt-0.5">--{sub}</div>
      )}
    </div>
  );
}

function RatioCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="border border-border rounded-lg bg-surface p-4">
      <div className="text-[10px] text-muted font-mono uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-xl font-display font-bold text-accent">{value}</div>
      <div className="text-[10px] text-dim font-mono mt-0.5">{description}</div>
    </div>
  );
}
