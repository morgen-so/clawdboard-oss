import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, cachedAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deviceCodes, users } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { hashApiToken } from "@/lib/api-auth";
import { DeviceSuccess } from "./DeviceSuccess";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize Device",
  robots: { index: false, follow: false },
};

async function claimDevice(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user?.id) {
    return;
  }

  const userCode = (formData.get("user_code") as string)
    ?.trim()
    .toUpperCase();
  if (!userCode) {
    redirect("/auth/device?error=missing_code");
  }

  // Find the device code that is valid and not yet claimed
  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(
      and(
        eq(deviceCodes.code, userCode),
        eq(deviceCodes.claimed, false),
        gt(deviceCodes.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!record) {
    redirect("/auth/device?error=invalid_code");
  }

  // Check if user already has an API token -- reuse it
  const [currentUser] = await db
    .select({ apiToken: users.apiToken })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  let apiToken = currentUser?.apiToken;

  // Generate a new API token if the user doesn't have one
  if (!apiToken) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    apiToken = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Store the API token on the user record, with the hash auth uses
    await db
      .update(users)
      .set({ apiToken, apiTokenHash: hashApiToken(apiToken) })
      .where(eq(users.id, session.user.id));
  }

  // Claim the device code
  await db
    .update(deviceCodes)
    .set({
      claimed: true,
      apiToken,
      userId: session.user.id,
    })
    .where(eq(deviceCodes.code, userCode));

  redirect("/auth/device?success=true");
}

export default async function DeviceAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; code?: string }>;
}) {
  const session = await cachedAuth();
  const params = await searchParams;
  const prefilled = params.code?.trim().toUpperCase() ?? "";

  if (!session?.user) {
    const callbackUrl = prefilled
      ? `/auth/device?code=${prefilled}`
      : "/auth/device";
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const isSuccess = params.success === "true";

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
      {/* Blurred leaderboard teaser behind the card */}
      {isSuccess && (
        <div className="absolute inset-0 flex flex-col items-center pt-6 blur-[3px] opacity-60 pointer-events-none select-none" aria-hidden="true">
          <div className="w-full max-w-5xl px-6 font-mono text-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded bg-accent/60" />
                <span className="text-lg font-bold text-foreground">clawdboard</span>
                <span className="text-xs text-muted ml-2">{'// claude code leaderboard'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-foreground/25" />
                <span className="text-xs text-foreground/60">devuser42</span>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex gap-2 mb-5">
              <div className="h-8 px-4 rounded-md bg-accent/30 flex items-center text-xs font-medium text-accent">Individuals</div>
              <div className="h-8 px-4 rounded-md bg-foreground/8 flex items-center text-xs text-muted">Teams</div>
            </div>
            {/* Title + filters */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-base font-bold text-foreground">$ AI Coding Usage Leaderboard</span>
              <div className="flex gap-1">
                {["--today", "--7d", "--30d", "--month", "--ytd"].map((label, i) => (
                  <div key={i} className={`h-7 px-3 rounded-md flex items-center text-[11px] ${i === 2 ? "bg-accent/35 border border-accent/40 text-accent" : "bg-foreground/8 text-muted"}`}>{label}</div>
                ))}
              </div>
            </div>
            {/* Your position */}
            <div className="rounded-lg border border-border bg-surface/60 p-4 mb-4">
              <div className="text-[11px] text-accent/60 mb-2">$ whoami</div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-foreground/20" />
                <span className="font-medium text-foreground">devuser42</span>
                <span className="ml-auto text-xs text-accent">sync your data →</span>
              </div>
            </div>
            {/* Table */}
            <div className="rounded-lg border border-border bg-surface/40 overflow-hidden">
              {/* Table header */}
              <div className="flex items-center px-4 py-2.5 border-b border-border text-[11px] uppercase tracking-widest text-muted">
                <span className="w-12">#</span>
                <span className="w-8" />
                <span className="flex-1">User</span>
                <span className="w-24 text-right text-accent">Cost ▼</span>
                <span className="w-28 text-right">Tokens</span>
                <span className="w-24 text-right">Active Days</span>
                <span className="w-20 text-right">Streak</span>
                <span className="w-32 text-left pl-4">Cooking</span>
              </div>
              {/* Table rows */}
              {[
                { rank: 1, icon: "◆", name: "SkipTheDragon", cost: "2619.23", tokens: "5,137,877", days: "24", streak: "· 5", cooking: "Rideshare Compa…", movement: "NEW" },
                { rank: 2, icon: "▲", name: "Jimmyboyyy", cost: "1818.49", tokens: "4,002,000", days: "29", streak: "🔥 12 Flame", cooking: "—", movement: "NEW" },
                { rank: 3, icon: "●", name: "AlaaMouch", cost: "1688.36", tokens: "1,568,783", days: "23", streak: "· 2", cooking: "Morgen", movement: "▼ -2" },
                { rank: 4, icon: "", name: "ransurf", cost: "1588.35", tokens: "2,648,473", days: "27", streak: "· 5", cooking: "Morgen", movement: "▼ -1" },
                { rank: 5, icon: "", name: "McKenzieJDan", cost: "1044.38", tokens: "4,097,597", days: "25", streak: "🔥 18 Fire", cooking: "—", movement: "▼ -1" },
                { rank: 6, icon: "", name: "marcusj", cost: "971.87", tokens: "40,218,973", days: "28", streak: "—", cooking: "—", movement: "▼ -4" },
                { rank: 7, icon: "", name: "tchen92", cost: "821.03", tokens: "47,812,711", days: "26", streak: "—", cooking: "—", movement: "▼ -1" },
                { rank: 8, icon: "", name: "codewitch_", cost: "754.19", tokens: "3,291,048", days: "22", streak: "· 3", cooking: "—", movement: "" },
                { rank: 9, icon: "", name: "blazestack", cost: "698.42", tokens: "2,105,637", days: "19", streak: "—", cooking: "SaaS Dashboard", movement: "▲ 2" },
                { rank: 10, icon: "", name: "nullpointer", cost: "612.88", tokens: "1,842,319", days: "21", streak: "· 7", cooking: "—", movement: "▼ -3" },
              ].map((row) => (
                <div key={row.rank} className={`flex items-center px-4 py-3 border-b border-border/30 ${row.rank <= 3 ? "border-l-2 border-l-accent/40" : "border-l-2 border-l-transparent"} ${row.rank === 1 ? "bg-amber-400/[0.04]" : ""}`}>
                  <span className={`w-12 font-semibold ${row.rank <= 3 ? "text-accent" : "text-dim"}`}>
                    {row.icon && <span className="text-xs mr-1">{row.icon}</span>}{row.rank}
                  </span>
                  <span className="w-8 text-[10px]">
                    {row.movement && (
                      <span className={row.movement.startsWith("NEW") ? "text-accent font-bold" : row.movement.startsWith("▼") ? "text-red-400" : "text-green-400"}>
                        {row.movement}
                      </span>
                    )}
                  </span>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-foreground/20 flex-shrink-0" />
                    <span className={`font-medium ${row.rank <= 3 ? "text-foreground" : "text-foreground/80"}`}>{row.name}</span>
                  </div>
                  <span className="w-24 text-right tabular-nums text-foreground/70"><span className="text-muted">$</span>{row.cost}</span>
                  <span className="w-28 text-right tabular-nums text-foreground/70">{row.tokens}</span>
                  <span className="w-24 text-right text-foreground/70">{row.days}</span>
                  <span className="w-20 text-right text-foreground/70">{row.streak}</span>
                  <span className="w-32 text-left pl-4 text-accent truncate">{row.cooking !== "—" ? row.cooking : <span className="text-dim">—</span>}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-surface p-8">
        <h1 className="font-display text-xl font-bold text-foreground">
          Authorize Device
          <span className="animate-blink ml-0.5 text-accent">_</span>
        </h1>
        <p className="mt-2 font-mono text-xs text-muted">
          {prefilled
            ? '// confirm to link your terminal'
            : '// enter the code from your terminal'}
        </p>

        {params.success === "true" ? (
          <DeviceSuccess />
        ) : (
          <form action={claimDevice} className="mt-6">
            {prefilled ? (
              <>
                <p className="block font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                  Device Code
                </p>
                <p className="mt-2 text-center font-mono text-lg font-bold uppercase tracking-[0.3em] text-accent">
                  {prefilled}
                </p>
                <input type="hidden" name="user_code" value={prefilled} />
              </>
            ) : (
              <>
                <label
                  htmlFor="user_code"
                  className="block font-mono text-[11px] font-medium uppercase tracking-wider text-muted"
                >
                  Device Code
                </label>
                <input
                  type="text"
                  id="user_code"
                  name="user_code"
                  placeholder="A1B2C3"
                  maxLength={6}
                  className="mt-2 block w-full rounded-md border border-border bg-background px-4 py-3 text-center font-mono text-lg font-bold uppercase tracking-[0.3em] text-accent placeholder:text-muted transition-colors focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                  autoComplete="off"
                  autoFocus
                  required
                />
              </>
            )}

            {params.error === "invalid_code" && (
              <p className="mt-2 font-mono text-xs text-danger">
                Invalid or expired code. Try again.
              </p>
            )}
            {params.error === "missing_code" && (
              <p className="mt-2 font-mono text-xs text-danger">
                Enter the code from your terminal.
              </p>
            )}

            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-accent px-4 py-2.5 font-mono text-sm font-semibold text-background transition-all hover:bg-accent-bright hover:shadow-[0_0_20px_rgba(249,166,21,0.2)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:outline-none"
            >
              Authorize
            </button>
          </form>
        )}

        <p className="mt-6 text-center font-mono text-[11px] text-dim">
          Signed in as {session.user.name ?? session.user.email}
        </p>
      </div>
    </div>
  );
}
