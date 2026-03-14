# clawdboard

AI coding agent leaderboard — track and compare usage, costs, tokens, streaks, and model breakdowns across Claude Code, OpenCode, and Codex.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Language:** TypeScript
- **Auth:** NextAuth v5 (GitHub OAuth)
- **Database:** Neon (serverless Postgres) + Drizzle ORM
- **Styling:** Tailwind CSS v4
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics, Vercel Speed Insights, Plausible

## Project Structure

```
src/
  app/          # Next.js App Router pages and API routes
  components/   # React components (auth, layout, leaderboard, profile, teams, ui)
  lib/          # Shared utilities (db, auth, env, sync, etc.)
  actions/      # Server actions
cli/            # CLI package (npm: clawdboard)
opencode-plugin/# OpenCode plugin (npm: clawdboard-opencode)
```

## Development

### Quick start (zero secrets needed)
```bash
npm install
npm run db:setup    # starts Postgres in Docker, pushes schema, seeds data
npm run dev         # http://localhost:3001 — sign in as dev-alice
```

### Commands
- `npm run dev` — starts on **port 3001** (configured in package.json)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run db:setup` — Docker Postgres + schema push + seed data (one command)
- `npm run db:push` — push Drizzle schema to database
- `npm run seed` — seed sample users and usage data

### Dev auth mode
When `AUTH_GITHUB_ID` is not set (default for local dev), the app uses a credentials-based login instead of GitHub OAuth. Sign in at `/signin` with any seeded username (e.g., `dev-alice`). This mode is **hardcoded to `NODE_ENV=development` only** — it cannot activate in production.

### Database driver
The app auto-detects the database driver from `DATABASE_URL`:
- URLs containing `neon.tech` → Neon HTTP driver (production)
- All other URLs → standard `pg` driver (local Docker Postgres)

## Important Rules

### CSP (Content Security Policy)
The CSP is defined in `next.config.ts`. **When adding any third-party script or service**, update the CSP:
- Add the domain to `script-src` if it loads a script
- Add the domain to `connect-src` if it sends data (analytics, APIs)
- **`form-action` must include OAuth provider domains** — Chrome enforces `form-action` on redirect targets from form submissions, not just the initial action URL. A form POSTing to `/api/auth/signin/github` (self) that 302-redirects to `github.com` will be **silently blocked** if `github.com` isn't in `form-action`. This is invisible to users — the button appears to do nothing. Server actions (used in `SignInButton`, `JoinBanner`, `/signin`) are immune because Next.js handles the redirect client-side via JS.

### Database
- **No `db.transaction()`** — Neon's HTTP driver doesn't support transactions. Use individual queries (upserts are idempotent).
- **drizzle-kit needs DATABASE_URL exported manually** — it doesn't read `.env.local`. Quote the URL since it contains `&`.
- **Materialized views are created via raw SQL** (`db.execute()` in the cron endpoint), not drizzle-kit migrations.
- After initial setup, hit `GET /api/cron/refresh` to create the materialized view. In production, Vercel cron runs this hourly.
- **Local dev uses `pg` driver** — `docker-compose.yml` provides Postgres. The seed script creates the materialized view automatically.

### CLI Publishing (npm)
To publish a new version of the CLI to npm:
```bash
cd cli
npm version patch   # or minor/major
npm publish         # runs `tsc` via prepublishOnly, then publishes
```
- Always run from the `cli/` directory, not the project root.
- `npm version` bumps `package.json` and creates a git tag.
- `npm publish` builds automatically via the `prepublishOnly` script.
- The README.md in `cli/` is the npm landing page — keep it up to date.

### Environment
- Environment variables are validated with `@t3-oss/env-nextjs` in `src/lib/env.ts`
- Set `SKIP_ENV_VALIDATION=1` to build/run without secrets (static pages like FAQ, privacy, terms work without any env vars)
- Never commit `.env*` files (gitignored)
