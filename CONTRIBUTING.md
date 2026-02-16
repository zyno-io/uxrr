# Contributing

## Prerequisites

- Node.js 22+
- Yarn 4 (corepack)
- PostgreSQL, Redis, S3-compatible store (LocalStack for local dev)

If you don't have Postgres/Redis/LocalStack running locally, use the provided Docker Compose file:

```bash
docker compose -f docker-compose.test.yml up -d
```

## Setup

```bash
yarn install
yarn migrate          # apply database migrations
yarn build            # build all packages (client, api, ui)
```

## Development

```bash
yarn dev:api          # API server on :8977
yarn dev:ui           # UI dev server on :8978 (proxies /v1 to :8977)
```

The API server reads config from `packages/api/.env`. For local development, `UXRR_DEV_MODE=true` disables OIDC authentication.

## Testing

### Unit tests (server)

```bash
yarn test             # run server unit tests
```

Tests use `node:test` with manual mocks. Test files live in `packages/api/tests/*.spec.ts`.

### E2E tests

E2E tests use [Playwright](https://playwright.dev/) and live in `packages/ui/tests/e2e/`. There are two categories:

| Category | What it tests | Server needed? |
|----------|--------------|----------------|
| **VRT** | UI rendering with mocked API (session list, admin, session detail) | No |
| **Live** | Real WebSocket flows — live session, reconnection, shared viewers | Yes |

#### Running E2E tests

```bash
# All tests (requires API server running)
yarn test:e2e

# VRT tests only (no server needed)
yarn test:e2e:vrt

# Live session tests only (requires API server running)
yarn test:e2e:live
```

Extra arguments are forwarded to Playwright:

```bash
yarn test:e2e:live --headed          # watch tests in a browser
yarn test:e2e:vrt --ui               # use Playwright's interactive UI
yarn test:e2e -- --grep "reconnect"  # filter by test name
```

#### Prerequisites for live E2E tests

1. **Infrastructure** running (Postgres, Redis, LocalStack)
2. **API server** running: `yarn dev:api`
3. **Client SDK** built: `yarn build:client` (the script auto-builds if missing)

The UI dev server is started automatically by Playwright if not already running.

#### Installing Playwright browsers

On first run, install the required browser:

```bash
npx playwright install chromium
```

### Integration tests (server)

```bash
cd packages/api
yarn test:int         # requires running infrastructure + UXRR_DEV_MODE=true
```

## Code Style

```bash
yarn format           # run oxlint + prettier across the repo
```

- 4-space indent, single quotes, no trailing commas (Prettier config in `.prettierrc.json`)
- Pre-commit hooks via [Lefthook](https://github.com/evilmartians/lefthook)

## Project Structure

```
packages/
  client/     Browser SDK (@zyno-io/uxrr-client)
  api/        Backend server (@zyno-io/uxrr-api)
  ui/         Admin dashboard (@zyno-io/uxrr-ui)
docs/         VitePress documentation site
scripts/      Helper scripts (release, test runners)
```
