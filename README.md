# clawdboard

The open-source leaderboard for Claude Code users. Track and compare usage, costs, tokens, streaks, and model breakdowns across developers.

[clawdboard.ai](https://clawdboard.ai)

## How It Works

1. Run `npx clawdboard` in your terminal
2. Sign in with GitHub (device flow — no secrets in the terminal)
3. Your local Claude Code usage logs are extracted, aggregated, and synced
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

## Self-Hosting

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) database (free tier works)
- A [GitHub OAuth App](https://github.com/settings/developers)

### Setup

```bash
git clone https://github.com/morgen-so/clawdboard-oss.git
cd clawdboard
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your values (see `.env.example` for all variables).

Push the database schema:

```bash
export DATABASE_URL="your-connection-string"
npx drizzle-kit push
```

Start the dev server:

```bash
npm run dev
```

The app runs on [localhost:3001](http://localhost:3001).

Create the materialized view for rank snapshots:

```
GET http://localhost:3001/api/cron/refresh
```

## Project Structure

```
src/
  app/          # Next.js App Router pages and API routes
  components/   # React components
  lib/          # Shared utilities (db, auth, env, sync)
  actions/      # Server actions
cli/            # CLI package (npm: clawdboard)
plugin/         # Claude Code plugin
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)

---

Built with Claude Code by the team at [Morgen](https://morgen.so).

