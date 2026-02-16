# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
yarn build                  # Build all packages
yarn build:client           # Build @zyno-io/uxrr-client (tsup → dist/)
yarn build:api              # Build @zyno-io/uxrr-api (dksf-dev build)
yarn build:ui               # Build @zyno-io/uxrr-ui (vite build)
yarn dev:api                # Run server in dev mode (dksf-dev run, port 8977)
yarn dev:ui                 # Run UI in dev mode (vite on :8978, proxies /v1 → localhost:8977)
yarn format                 # Prettier (4-space indent, single quotes, no trailing commas)
```

**Server-specific:**

```bash
cd packages/api
yarn migrate                # Run database migrations (dksf-dev migrate)
```

**After modifying `@zyno-io/uxrr-client`**, always rebuild it — downstream consumers (like zynosuite-spa) use the built output, not source.

**UI API client regeneration:** After changing `packages/api/openapi.yaml`, run `yarn gen` in `packages/ui/` to regenerate `src/openapi-client-generated/`.

## Architecture

uxrr (User eXperience Realtime & Rewind) is a session recording and replay platform — a Yarn 4 monorepo with three packages:

### `@zyno-io/uxrr-client` — Browser SDK

Embeds in web apps. Records sessions (rrweb), captures logs, instruments HTTP via OpenTelemetry, and supports live agent sessions.

**Singleton pattern:** `uxrr` is a Proxy that lazily creates the `UXRR` instance. `init(config)` calls `configure()`. Before init, `identify()` and `createLogger()` work (console-only, identity cached).

**Data flow — two paths:**

- **Events + Logs → `IngestBuffer`** (`transport/ingest-buffer.ts`) — unified buffer that sends both as a single `POST /v1/ng/{appId}/{sessionId}/data`. In live mode (agent connected), pushes immediately over WebSocket with no timer.
- **Traces → OpenTelemetry** `BatchSpanProcessor` → `POST .../t` (JSON). Completely separate pipeline.

**`IngestBuffer` details:**

- Normal mode: 5s interval timer. Events also trigger immediate flush at 50-event threshold.
- Event queue cap 500 (overflow → flush + full rrweb snapshot after next successful flush). Log queue cap 1500 (oldest dropped; re-queued on flush failure).
- `FlushCoordinator` fires `sendBeacon()` on `beforeunload`/`visibilitychange`.

### `@zyno-io/uxrr-api` — Backend

Deepkit HTTP framework + `@zyno-io/dk-server-foundation`. Config via environment variables mapped to `UxrrConfig`.

**Ingest pipeline:** Single `POST :appId/:sessionId/data` endpoint → `IngestService.ingestData()`:

- Events → S3 (chunked by `eventChunkCount`)
- Logs → Loki (decorated with appId/deviceId/userId/sessionId)
- Traces → forwarded to Tempo via OTLP
- Sessions → PostgreSQL

**Live sessions:** `WebSocketService` handles WS upgrades for three connection types: client (browser SDK), agent (UI viewer), and watch (session list WebSocket). `LiveSessionService` relays events/logs between client↔agent in real-time.

**CORS note:** dk-server-foundation handles CORS for normal responses, but when using `writeHead`/`end` directly (e.g., OTLP forwarding), you must manually include `HttpCors.getResponseHeaders(response)`.

### `@zyno-io/uxrr-ui` — Admin Dashboard

Vue 3 + Vite. Session list with real-time updates (WebSocket), session detail with replay player, console, network panel, and live chat. API client auto-generated from `openapi.yaml`.

## Key Patterns

- **Deepkit DI:** Server uses Deepkit's dependency injection. Controllers, services, and middleware are registered in `app.ts` via `createApp()`. Constructor injection — just declare dependencies as constructor params.
- **Database migrations:** Located in `packages/api/src/migrations/`. Numbered sequentially (`0001-initial.ts`, etc.). Run with `dksf-dev migrate`.
- **OpenAPI → codegen:** `packages/api/openapi.yaml` is the source of truth for the UI's API client. Changes to server endpoints should be reflected there, then regenerated.
