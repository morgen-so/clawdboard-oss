# clawdboard

The open-source leaderboard for AI coding agents. Track and compare usage, costs, tokens, streaks, and model breakdowns across developers. Supports Claude Code, OpenCode, and Codex.

[clawdboard.ai](https://clawdboard.ai)

## How It Works

1. Run `npx clawdboard` in your terminal
2. Sign in with GitHub (device flow — no secrets in the terminal)
3. Your local usage logs are extracted, aggregated, and synced
4. A hook auto-syncs every 2 hours in the background

**Privacy first:** Only aggregate numbers (date, token counts, cost, model names) leave your machine. Prompts, code, file paths, and project names never do.

## Features

- **Leaderboard** — sort by cost, tokens, or streaks across 7d / 30d / YTD
- **Profiles** — usage chart, activity heatmap, model breakdown, earned badges
- **Teams** — create a team, invite via link, compete and track AI adoption
- **Shareable cards** — OG images and social sharing for profiles and teams
- **i18n** — English, French, German, Spanish

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Language:** TypeScript
- **Auth:** NextAuth v5 (GitHub OAuth)
- **Database:** Neon (serverless Postgres) + Drizzle ORM
- **Styling:** Tailwind CSS v4
- **Hosting:** Vercel

## Quick Start

Requires [Node.js](https://nodejs.org/) 18+ and [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/morgen-so/clawdboard-oss.git
cd clawdboard
npm install
npm run db:setup    # starts Postgres, pushes schema, seeds sample data
npm run dev         # http://localhost:3001 — sign in as dev-alice
```

No secrets, no Neon account, no GitHub OAuth app needed for local dev.

### Self-Hosting / Production

For production, set these environment variables (see `.env.example`):

- **DATABASE_URL** — [Neon](https://neon.tech) connection string (or any Postgres)
- **AUTH_SECRET** — `openssl rand -base64 32`
- **AUTH_GITHUB_ID / AUTH_GITHUB_SECRET** — [GitHub OAuth App](https://github.com/settings/developers) with callback `https://your-domain/api/auth/callback/github`

Push the schema and create the materialized view:

```bash
npx drizzle-kit push
curl http://localhost:3001/api/cron/refresh
```

## Project Structure

```
src/
  app/          # Next.js App Router pages and API routes
  components/   # React components
  lib/          # Shared utilities (db, auth, env, sync)
  actions/      # Server actions
cli/            # CLI package (npm: clawdboard)
opencode-plugin/# OpenCode plugin (npm: clawdboard-opencode)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)

---

Built with Claude Code by the team at [Morgen](https://morgen.so).

