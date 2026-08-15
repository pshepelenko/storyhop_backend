# StoryHop Backend

NestJS API backend for StoryHop - interactive English story series for children.

## Quick Start

```bash
npm install
npm run start:dev
```

Backend runs on `http://localhost:3000` by default.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Production start |
| `npm run start:dev` | Development with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run deploy` | Full deploy (build + start:prod) |
| `npm run verify` | TypeScript verification without clearing `dist` |
| `npm run backfill:season-titles` | Explicit idempotent maintenance queue for legacy season titles |
| `npm run diagnose:openrouter` | Safe OpenRouter request/routing diagnostic (does not print the key) |
| `npm run smoke:pixazo-r2` | Opt-in Pixazo/R2 smoke test (`SMOKE_ALLOW_GENERATION=true`) |
| `npm run smoke:migrations` | Run every SQL migration in an isolated PostgreSQL schema and roll it back |
| `npm run release:check` | TypeScript, unit/e2e tests and clean-schema migration smoke |
| `npm run lint` | ESLint check |
| `npm run test` | Unit tests |

## Environment

Local development may use `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME`. Railway uses `DATABASE_URL`. Also configure `OPEN_ROUTER_API_KEY`, Pixazo, R2 credentials/bucket, `FRONTEND_URL=https://app.story-hop.com`, `BACKEND_URL=https://api.story-hop.com`, `ALLOWED_ORIGINS=https://app.story-hop.com`, `SESSION_COOKIE_DOMAIN=.story-hop.com`, `HEALTH_DIAGNOSTICS_TOKEN`, and `WORKER_ENABLED=true`. Production startup validates these values and rejects `DB_SYNCHRONIZE=true`.

## Deploy

Target: Railway. Use `railway.toml`; build is `npm ci && npm run build`, start is `npm run start:prod`, and the Railway healthcheck is `/ready`.

Database: Railway Postgres. Object storage: Cloudflare R2. AI: OpenRouter. Production uses a single backend replica with the embedded worker enabled.

After the first successful migration, run `npm run seed:demo` once as a Railway one-off command. It is idempotent and seeds the text/content records for the public demo. Run `npm run seed:demo-media` separately only after the AI and storage dependency checks are green.

The complete variable checklist, deployment sequence, smoke tests and rollback procedure are in `../docs/alpha-release-runbook.md`.
