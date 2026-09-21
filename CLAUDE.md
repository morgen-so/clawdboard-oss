# clawdboard

AI coding agent leaderboard — track and compare usage, costs, tokens, streaks, and model breakdowns across Claude Code, OpenCode, and Codex.

## Monorepo Structure

```
clawdboard/
├── src/                    ← Next.js web app
│   ├── app/                  Pages, layouts, API routes, cron
│   ├── components/           React components (auth, layout, leaderboard, profile, teams, ui)
│   ├── lib/                  Shared utilities (db, auth, env, sync)
│   └── actions/              Server actions
├── cli/                    ← CLI package (npm: clawdboard)
├── opencode-plugin/        ← OpenCode plugin (npm: clawdboard-opencode)
├── messages/               ← i18n translation files (EN, FR, DE, ES)
├── drizzle/                ← DB migrations
└── docker-compose.yml      ← Local Postgres for dev
```

## Tech Stack

- **Framework:** Next.js 15.5 (App Router, Turbopack)
- **Language:** TypeScript
- **Auth:** NextAuth v5 (GitHub OAuth; dev credentials mode for local)
- **Database:** Neon (serverless Postgres) + Drizzle ORM
- **Styling:** Tailwind CSS v4
- **i18n:** next-intl (EN/FR/DE/ES)
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics, Vercel Speed Insights, Plausible

## Development

### Quick start (no secrets needed)

```bash
npm install
npm run db:setup    # Docker Postgres + schema push + seed data
npm run dev         # http://localhost:3001 — sign in as dev-alice
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3001 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests (`node --test`, no framework) |
| `npm run db:setup` | Docker Postgres + schema push + seed |
| `npm run db:push` | Push Drizzle schema to DB |
| `npm run seed` | Seed sample data |

### Dev auth mode

When `AUTH_GITHUB_ID` is not set, the app uses credentials-based login instead of GitHub OAuth. Sign in at `/signin` with any seeded username (e.g., `dev-alice`). Hardcoded to `NODE_ENV=development` only.

### Database driver auto-detection

- URLs containing `neon.tech` use Neon HTTP driver (production)
- All other URLs use standard `pg` driver (local Docker Postgres)

## Important Rules

### CSP (Content Security Policy)
Defined in `next.config.ts`. When adding third-party scripts/services, update CSP accordingly. Key gotcha: `form-action` must include OAuth provider domains — Chrome enforces it on redirect targets, causing silent failures.

### Database
- **No `db.transaction()`** — Neon HTTP driver does not support transactions. Use individual queries.
- **drizzle-kit** needs `DATABASE_URL` exported manually (does not read `.env.local`).
- **Materialized views** are created via raw SQL (`db.execute()` in `/api/cron/refresh`). In production, Vercel cron runs this hourly.
- **Local dev uses `pg` driver** — `docker-compose.yml` provides Postgres. Seed script creates materialized views automatically.

### Streaks and free passes
A streak counts days the user was active, back from today (or yesterday, since today isn't over). Every 75 days of an unbroken streak banks one free pass; a pass covers one missed day and unused passes accumulate. A covered day keeps the run alive but does not add to the count.

Passes apply to the current streak only and never reach back before `PASSES_LIVE_FROM` (the ship date, in `src/lib/streak.ts`; bump it if the deploy slips). A gap from before that date stays a break, so shipping the feature didn't stitch anyone's old run onto their current one. The current streak's pre-launch days do count towards earning passes. For local dev, `STREAK_PASSES_LIVE_FROM=2000-01-01` on both `npm run seed` and `npm run dev` lets the seeded demo gaps (which sit a few days in the past) be covered.

- **The fold is the source of truth:** `src/lib/streak.ts`. Whether a gap survives depends on the pass balance, which depends on how the run got there, so this can't be a window function. `computeStreakSnapshot()` is a pure function of the dates; `resolveStreak()` applies the clock.
- **The result is stored, not recomputed per query.** One row per user in `user_streaks`, written by `/api/sync` and rebuilt for everyone by the hourly cron. A snapshot only changes when the user's daily rows change, so nothing else writes it (page views never do). The leaderboard, teams, recaps and `leaderboard_mv` all read it.
- **`streakSelect()` in `src/lib/db/streak-state.ts` is the SQL mirror of `resolveStreak()`.** It ages a stored snapshot to `CURRENT_DATE`. Change one, change the other (and the inline copies in the `leaderboard_mv` definition in `schema.ts`, `/api/cron/refresh`, and `scripts/seed.mjs`).
- **Free-pass state is private to its owner.** The streak *number* is public, but how many passes someone has banked, and whether a pass is currently holding their streak open, is not. The queries fetch it for every row, so `redactStreakPasses()` zeroes it for everyone but the viewer before it reaches a client component. The profile page builds a redacted `StreakState` for non-owners and mounts `StreakPassCelebration` for the owner only. Redact server-side, never by hiding it in the component: a client component's props ship in the serialized page payload whether or not it renders anything. `GET /api/leaderboard` is unauthenticated and must never carry it, and `leaderboard_mv` feeds public stats so it holds the streak number only. The token-authenticated `POST /api/sync` response returns the caller's own.
- **After deploying a change to the fold**, run the cron once so stored snapshots are rebuilt: `curl -H "Authorization: Bearer $CRON_SECRET" https://clawdboard.ai/api/cron/refresh`. Until it runs, users with no row read as a 0 streak.
- `src/lib/streak.test.ts` covers the fold. Run with `npm test`.

### i18n
Translation files live in `messages/` (EN, FR, DE, ES). Use `next-intl` APIs for all user-facing strings.

### CLI Publishing (npm)

Publishing runs in GitHub Actions via npm trusted publishing (`.github/workflows/publish-cli.yml`); there is no npm token anywhere. To release:

```bash
cd cli && npm version patch --no-git-tag-version && npm install
cd .. && git add cli/package.json cli/package-lock.json cli/CHANGELOG.md
git commit -m "chore(cli): release X.Y.Z" && git tag vX.Y.Z && git push origin main vX.Y.Z
```

The workflow checks that the tag matches `cli/package.json`, runs the tests, builds, and publishes with provenance. Date the `[Unreleased]` section of `cli/CHANGELOG.md` in the same commit. `README.md` in `cli/` is the npm landing page.

### Environment
- Variables validated with `@t3-oss/env-nextjs` in `src/lib/env.ts`
- Set `SKIP_ENV_VALIDATION=1` to build without secrets (static pages work without env vars)
- Never commit `.env*` files
