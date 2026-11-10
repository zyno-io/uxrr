# Contributing

Thanks for your interest in improving uxrr.

## Where to Contribute

- **Bugs and feature requests:** open an issue on [GitHub](https://github.com/zyno-io/uxrr/issues).
- **Code and documentation:** open a pull request against `main` on [github.com/zyno-io/uxrr](https://github.com/zyno-io/uxrr). For anything larger than a small fix, please open an issue first so we can agree on the approach.

The GitHub repository is a mirror of our primary repository, and `main` on GitHub is overwritten on every sync. Pull requests are therefore not merged on GitHub: a maintainer applies an accepted pull request in the primary repository, and your pull request is closed once the change appears on `main`.

## Contributor License Agreement

Before we can accept a contribution, you need to sign the [uxrr Contributor License Agreement](CLA.md). You keep the copyright in your contribution; the CLA gives Signal24 LLC dba Zyno Consulting the right to ship it in uxrr (including the MIT-licensed client SDK), in its hosted services, and under commercial licenses.

- **Individuals:** when you open your first pull request, the CLA bot will ask you to post this comment on it:

    > I have read the CLA Document and I hereby sign the CLA

    You only need to do this once. If the check does not update, comment `recheck`.

- **Companies:** if you contribute as part of your job, have an authorized representative complete Part B of the [CLA](CLA.md) and email it to support@sgnl24.com. Each contributor still signs individually with the comment above.

Every commit in the pull request must be authored by a GitHub account that has signed, so make sure the email on your commits is linked to your GitHub account.

## License

uxrr is source-available, under the [uxrr Source Available License, Version 1.1](LICENSE.md). In short:

- Self-hosting uxrr for your organization's internal use is free, including recording and supporting the end users of your own websites and applications.
- Offering uxrr as a hosted or managed service, embedding it in a product, distributing it, or white-labelling it requires a commercial license.
- The client SDK in `packages/client` is licensed separately under the [MIT License](packages/client/LICENSE).
- You may fork the repository and modify uxrr to prepare and submit a contribution (Section 8 of the License).

The License itself is the authoritative text. Contributions you submit are covered by Section 8 of the License and by the CLA.

## For Maintainers

- Pull requests are never merged on GitHub. Apply an accepted pull request in the primary repository, then close it once the change reaches `main` on GitHub.
- Before applying a pull request, check that the CLA check passed and that every commit is attributed to a GitHub account. If any commit's author shows as not being a GitHub user (its email is not linked to an account), do not apply it: ask the contributor to fix the commit author and re-push, because the CLA signature cannot be tied to that commit.
- If the contributor works for a company, confirm that a signed Part B of the CLA is on file for it.

## Prerequisites

- Node.js 22+
- Yarn 4 (corepack)
- PostgreSQL, Redis, S3-compatible store (MiniStack for local dev)

If you don't have Postgres/Redis/MiniStack running locally, use the provided Docker Compose file:

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

| Category | What it tests                                                      | Server needed? |
| -------- | ------------------------------------------------------------------ | -------------- |
| **VRT**  | UI rendering with mocked API (session list, admin, session detail) | No             |
| **Live** | Real WebSocket flows — live session, reconnection, shared viewers  | Yes            |

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

1. **Infrastructure** running (Postgres, Redis, MiniStack)
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
