# uxrr Project Architecture

## Overview

uxrr (User eXperience Realtime & Rewind) is a session recording/observability platform. Yarn 4 monorepo with 3 packages.

## Packages

### `@zyno-io/uxrr-client` (packages/client/)

Browser SDK. Built with tsup. Exports: `init`, `uxrr` (Proxy singleton), `tracer`, types.

Key files:

- `src/uxrr.ts` — Main UXRR class, orchestrates all subsystems
- `src/transport/ingest-buffer.ts` — Unified event+log buffer (replaces old separate LogTransport + EventBuffer)
- `src/transport/http.ts` — HttpTransport (postJSON, sendBeacon, getIngestUrl)
- `src/transport/flush.ts` — FlushCoordinator (beforeunload/visibilitychange)
- `src/recording/recorder.ts` — rrweb recording, uses IngestBuffer.pushEvent()
- `src/logging/logger.ts` — ScopedLogger, uses IngestBuffer.pushLog()
- `src/tracing/provider.ts` — OpenTelemetry WebTracerProvider, also pushes network logs to IngestBuffer
- `src/support/connection.ts` — WebSocket for live agent sessions
- `src/identity.ts` — IdentityManager (deviceId in localStorage, userId)
- `src/session.ts` — SessionManager (sessionId UUID in sessionStorage, launchTs)
- `src/types.ts` — UxrrConfig, UxrrIdentity, UxrrLogger, UxrrInstance interfaces

### `@zyno-io/uxrr-api` (packages/api/)

Deepkit framework + @zyno-io/dk-server-foundation.

Key files:

- `src/controllers/ingest.controller.ts` — POST :appId/:sessionId/data (combined events+logs), OTLP forwarding
- `src/services/ingest.service.ts` — ingestData(): session CRUD, events→S3, logs→Loki, WS relay
- `src/services/live-session.service.ts` — WebSocket agent↔client management
- `src/services/session-notify.service.ts` — SSE session updates
- `src/config.ts` — UxrrConfig (S3, Loki, OTLP, OIDC settings)
- `src/database/entities/session.entity.ts` — PostgreSQL session entity

### `@zyno-io/uxrr-ui` (packages/ui/)

Vue 3 + Vite admin dashboard. API client generated from openapi.yaml.

## Data Flow

- Events + Logs → IngestBuffer → POST /v1/ng/{appId}/{sessionId}/data (or WebSocket in live mode)
- Traces → OpenTelemetry → POST .../t (JSON)
- Server stores: events→S3, logs→Loki, traces→Tempo, sessions→PostgreSQL

## Build

- `yarn build` — all packages
- `npm run build` in packages/client/ — rebuild client (required when zynosuite-spa consumes it)
- `yarn dev:api` / `yarn dev:ui` — dev mode
