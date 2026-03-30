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

### i18n
Translation files live in `messages/` (EN, FR, DE, ES). Use `next-intl` APIs for all user-facing strings.

### CLI Publishing (npm)

```bash
cd cli && npm version patch && npm publish
```

Always run from `cli/`, not project root. `README.md` in `cli/` is the npm landing page.

### Environment
- Variables validated with `@t3-oss/env-nextjs` in `src/lib/env.ts`
- Set `SKIP_ENV_VALIDATION=1` to build without secrets (static pages work without env vars)
- Never commit `.env*` files
