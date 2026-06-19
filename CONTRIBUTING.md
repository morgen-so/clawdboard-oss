# Contributing to clawdboard

Thanks for your interest in contributing! Here's how to get started.

## Local Setup (zero config)

1. **Fork and clone** the repo
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start Postgres and seed data** (requires [Docker](https://docs.docker.com/get-docker/)):
   ```bash
   npm run db:setup
   ```
   This starts a local Postgres container, pushes the schema, and seeds sample users with usage data.

4. **Start the dev server:**
   ```bash
   npm run dev
   ```
   The app runs on [localhost:3001](http://localhost:3001).

5. **Sign in** at `/signin` with any seeded username: `dev-alice`, `dev-bob`, `dev-carol`, `dev-dave`, or `dev-eve`.

No GitHub OAuth app, no Neon account, no secrets needed.

### Optional: Real GitHub OAuth

To test real GitHub sign-in locally, create a [GitHub OAuth App](https://github.com/settings/developers) and add to `.env.local`:

```bash
AUTH_GITHUB_ID=your-client-id
AUTH_GITHUB_SECRET=your-client-secret
AUTH_SECRET=$(openssl rand -base64 32)
```

Callback URL: `http://localhost:3001/api/auth/callback/github`

## Project Structure

```
src/
  app/          # Next.js App Router pages and API routes
  components/   # React components
  lib/          # Shared utilities (db, auth, env, sync)
  actions/      # Server actions
cli/              # CLI package (npm: clawdboard)
opencode-plugin/  # OpenCode plugin (npm: clawdboard-opencode)
```

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm run build` to check for errors
4. Open a PR with a clear description of what you changed and why

## CLI Development

The CLI lives in `cli/`. To work on it:

```bash
cd cli
npm install
npm run dev    # runs with tsx
npm test       # runs vitest
```

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style (TypeScript, Tailwind CSS v4)
- Don't commit `.env*` files or secrets
- Test your changes locally before opening a PR
