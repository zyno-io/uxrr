# UXRR Testing Plan

## Current State

Zero test infrastructure exists — no test files, frameworks, configs, or CI pipelines. The codebase is well-structured with clear separation of concerns, making it straightforward to add testing incrementally.

---

## Framework Choices

| Package                | Framework                                                          | Rationale                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@zyno-io/uxrr-client` | **Vitest** + happy-dom                                             | Fast, native ESM/TS, great mocking. happy-dom for DOM APIs (localStorage, sessionStorage, navigator).                                                                                                              |
| `@zyno-io/uxrr-api`    | **dksf-test** (`node:test` + dk-server-foundation)                 | Built-in test runner from dk-server-foundation: `TestingFacade` for DB isolation, `makeMockRequest` for HTTP, `SqlTestingHelper` for mocking queries, entity fixtures, asymmetric matchers. Enforces UTC timezone. |
| `@zyno-io/uxrr-ui`     | **Vitest** + **Vue Test Utils** (component) + **Playwright** (E2E) | Vitest integrates natively with Vite. Playwright for full browser E2E.                                                                                                                                             |
| Visual regression      | **PixelCI**                                                        | In-house tool — captures screenshots of UI pages/states in CI and compares against approved baselines.                                                                                                             |

Vitest for client + UI; `dksf-test` (via `yarn test` / `dksf-dev test`) for server.

---

## Phase 1 — Client SDK Unit Tests (highest value)

The client SDK has the most pure-logic code and the fewest external dependencies — best ROI.

### `IngestBuffer` (`packages/client/src/transport/ingest-buffer.ts`)

The core data pipeline. Most complex logic in the client.

| Test                                                                  | What it verifies              |
| --------------------------------------------------------------------- | ----------------------------- |
| `pushEvent()` adds events to queue                                    | Basic enqueue behavior        |
| Auto-flush at `eventBufferSize` (50) threshold                        | Threshold-triggered flush     |
| Timer-based flush fires at `flushInterval` (5s)                       | Interval flush in normal mode |
| `pushLog()` adds logs to queue                                        | Log enqueue                   |
| Log queue drops oldest when exceeding `maxLogQueue` (1500)            | Overflow behavior             |
| Event queue overflow (>500) triggers flush + sets `needsFullSnapshot` | Overflow → snapshot recovery  |
| `flush()` sends correct payload shape to transport                    | Payload structure             |
| `flush()` is no-op when already flushing                              | Re-entrancy guard             |
| `flush()` is no-op when queues are empty                              | Empty flush                   |
| `handleFlushSuccess()` clears queues                                  | Post-flush cleanup            |
| Failed flush re-queues events (up to 3 consecutive failures)          | Event retry behavior          |
| After 3 consecutive failures, events dropped + `needsFullSnapshot`    | Failure recovery              |
| Failed flush re-queues logs                                           | Log retry behavior            |
| `consecutiveFailures` resets on success                               | Counter reset                 |
| `setLiveMode(true)` disables timer, flushes immediately on push       | Live mode behavior            |
| `setLiveMode(true)` sends via WebSocket instead of HTTP               | Live transport switch         |
| `stop()` clears timer and flushes remaining                           | Clean shutdown                |
| `flushBeacon()` uses sendBeacon API                                   | Page unload path              |

### `FlushCoordinator` (`packages/client/src/transport/flush.ts`)

| Test                                                     | What it verifies     |
| -------------------------------------------------------- | -------------------- |
| Registers `beforeunload` and `visibilitychange` handlers | Event listener setup |
| Calls `flushBeacon()` on `beforeunload`                  | Unload flush         |
| Calls `flushBeacon()` on `visibilitychange` to hidden    | Visibility flush     |
| Does not flush on `visibilitychange` to visible          | No spurious flush    |

### `HttpTransport` (`packages/client/src/transport/http.ts`)

| Test                                                        | What it verifies       |
| ----------------------------------------------------------- | ---------------------- |
| `postJSON()` sends correct URL, headers, body               | HTTP request formation |
| `postJSON()` aborts after 10s timeout (AbortSignal.timeout) | Fetch timeout          |
| `postJSON()` handles non-2xx responses                      | Error handling         |
| `sendBeacon()` calls navigator.sendBeacon with correct args | Beacon API usage       |
| `getIngestUrl()` constructs correct path                    | URL construction       |

### `IdentityManager` (`packages/client/src/identity.ts`)

| Test                                                         | What it verifies              |
| ------------------------------------------------------------ | ----------------------------- |
| Generates deviceId on first access, persists to localStorage | Auto-generation + persistence |
| Returns existing deviceId from localStorage                  | Restore on reload             |
| Respects custom `deviceIdPrefix`                             | Config prefix                 |
| Respects custom `deviceId` override                          | Config override               |
| `identify()` sets userId, userName, userEmail                | Identity update               |
| `toPayload()` returns correct shape                          | Serialization                 |
| `toSpanAttributes()` returns OTel attributes                 | Tracing integration           |

### `SessionManager` (`packages/client/src/session.ts`)

| Test                                                 | What it verifies                 |
| ---------------------------------------------------- | -------------------------------- |
| Generates new sessionId (UUID) on every construction | Always-new session per page load |
| Stores sessionId in sessionStorage                   | Persistence for current tab      |
| Sets `launchTs` to `Date.now()`                      | Timestamp tracking               |

### `UXRR` main class (`packages/client/src/uxrr.ts`)

| Test                                                         | What it verifies  |
| ------------------------------------------------------------ | ----------------- |
| `init()` creates and configures instance                     | Bootstrap         |
| Proxy singleton returns same instance                        | Singleton pattern |
| `identify()` before `init()` caches identity                 | Pre-init identity |
| `createLogger()` before `init()` returns console-only logger | Pre-init logger   |
| `configure()` initializes all subsystems                     | Full wiring       |
| `configure()` tears down previous subsystems on re-init      | Re-init cleanup   |
| `stop()` tears down all subsystems and nulls refs            | Clean shutdown    |
| `stop()` unregisters from FlushCoordinator                   | Listener cleanup  |

### `Recorder` (`packages/client/src/recording/recorder.ts`)

| Test                                                     | What it verifies      |
| -------------------------------------------------------- | --------------------- |
| Starts rrweb recording with correct config               | Init                  |
| Pushes events to IngestBuffer                            | Event forwarding      |
| `maskTextContent` defaults to `true` when not configured | Privacy-safe defaults |
| Stop destroys rrweb instance                             | Teardown              |

### `ScopedLogger` (`packages/client/src/logging/logger.ts`)

| Test                                                    | What it verifies   |
| ------------------------------------------------------- | ------------------ |
| Log methods (debug, info, warn, error) format correctly | Log formatting     |
| Logs pushed to IngestBuffer with correct shape          | Buffer integration |
| Console-only mode before init                           | Pre-init behavior  |
| Scope prefix applied                                    | Scoping            |

### Tracing (`packages/client/src/tracing/`)

| Test                                             | What it verifies     |
| ------------------------------------------------ | -------------------- |
| Provider configures OTel correctly               | OTel setup           |
| Network logger captures XHR/fetch as log entries | HTTP instrumentation |
| Span processor batches and exports               | Export pipeline      |

---

## Phase 2 — Server Unit Tests (dksf-test)

Uses `node:test` via dk-server-foundation's `dksf-test` runner. Unit tests use `SqlTestingHelper` to mock DB queries without a real database; `mock` from `node:test` for S3/Loki/Redis stubs.

### Test infrastructure pattern

```typescript
import { describe, it } from 'node:test';
import {
    TestingHelpers,
    makeMockRequest,
    SqlTestingHelper,
    defineEntityFixtures,
    loadEntityFixtures,
    matchesObject,
    anyOf,
    assertCalledWith,
    disconnectAllRedis
} from '@zyno-io/dk-server-foundation';

const sessionFixtures = defineEntityFixtures(SessionEntity, {
    basic: { id: 'sess-1', appId: 'app-1', deviceId: 'dev-1' /* ... */ }
});

describe('IngestService', () => {
    const tf = TestingHelpers.createTestingFacade(
        { providers: [IngestService /* mock providers */] },
        { enableDatabase: false }
    );
    TestingHelpers.installStandardHooks(tf);
    const sql = new SqlTestingHelper();

    it('creates new session on first ingest', async () => {
        sql.mockEntity(SessionEntity, []);
        // ... test logic using tf.get(IngestService)
    });
});
```

### `IngestService` (`packages/api/src/services/ingest.service.ts`)

Unit tests with `SqlTestingHelper` for DB mocking + stubbed S3/Loki services.

| Test                                                          | What it verifies                                      |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `ingestData()` creates new session on first ingest            | Session creation                                      |
| `ingestData()` updates existing session on subsequent ingests | Session update (lastActivityAt, eventChunkCount)      |
| Events stored to S3 in correct chunk structure                | S3 storage format                                     |
| Logs forwarded to Loki with correct labels                    | Loki labels (appId, deviceId, userId — NOT sessionId) |
| Loki log line JSON includes sessionId                         | sessionId in log line, not label                      |
| Identity/meta updates applied to session                      | Session metadata update                               |
| Empty events/logs arrays handled gracefully                   | Edge case                                             |
| `forwardOtlp()` proxies traces to configured endpoint         | OTLP trace forwarding                                 |

### `LiveSessionService` (`packages/api/src/services/live-session.service.ts`)

Unit tests with mock WebSocket objects and stubbed Redis pub/sub.

| Test                                                                | What it verifies         |
| ------------------------------------------------------------------- | ------------------------ |
| `connectClient()` registers WebSocket with appId, starts ping timer | Client lifecycle         |
| `connectAgent()` registers agent, broadcasts agent list             | Agent lifecycle          |
| Client message relayed to agent(s)                                  | Client → agent relay     |
| Agent message relayed to client                                     | Agent → client relay     |
| `setController()` updates controllerId, broadcasts                  | Controller management    |
| `flushBuffers()` persists buffered events/logs                      | Buffer persistence       |
| `persistEvents()` uses atomic UPDATE...RETURNING for chunk index    | Concurrent-safe chunking |
| `cleanupIfEmpty()` tears down when last connection leaves           | Cleanup                  |
| Ping/pong timeout disconnects stale connections                     | Health check             |
| Redis pub/sub for multi-pod relay                                   | Cross-pod messaging      |
| Chat messages persisted and broadcast                               | Chat flow                |
| WS rate limiter drops messages exceeding 100/sec per session        | WS abuse resistance      |

### `SessionController` — via `makeMockRequest()`

HTTP-level tests using dk-server-foundation's mock request helper.

| Test                                            | What it verifies |
| ----------------------------------------------- | ---------------- |
| `GET /v1/sessions` returns session list         | List endpoint    |
| `GET /v1/sessions?appId=X` filters by app       | Query filtering  |
| `GET /v1/sessions/:id` returns session detail   | Detail endpoint  |
| Query `limit` capped at 200 regardless of input | Limit cap        |
| Returns 404 for unknown session                 | Error handling   |

### `IngestController` — via `makeMockRequest()`

| Test                                                        | What it verifies |
| ----------------------------------------------------------- | ---------------- |
| `POST /v1/ng/:appId/:sessionId/data` with valid payload | Happy path       |
| Rejects invalid appId                                       | Validation       |
| Rejects oversized body (>MAX_BODY_SIZE)                     | Size guard       |
| Returns 429 when rate limit exceeded (60 req/min per IP)    | Rate limiting    |

### `WebSocketService`

| Test                                                       | What it verifies    |
| ---------------------------------------------------------- | ------------------- |
| Client upgrade validates appId + API key                   | Auth: client        |
| Client upgrade rejects appId mismatch for existing session | Session-app binding |
| Agent upgrade validates OIDC/session token                 | Auth: agent         |
| Shared viewer upgrade validates share link token           | Auth: shared        |
| Watch upgrade initiates WebSocket session-notify stream    | Watch stream setup  |
| Invalid auth rejected with appropriate status              | Auth failure        |

### Middleware

| Test                                                                        | What it verifies            |
| --------------------------------------------------------------------------- | --------------------------- |
| `OriginGuard` validates allowed origins via `AppResolverService`            | CORS origin check           |
| `SessionAuthMiddleware` validates Bearer token (OIDC)                       | OIDC bearer auth path       |
| `SessionAuthMiddleware` validates `X-API-Key` header                        | API key auth path           |
| `SessionAuthMiddleware` validates `X-Embed-Token` header                    | Embed token auth path       |
| `SessionAuthMiddleware` sets correct `AuthContext` (type, scope, appIds)    | Auth context propagation    |
| `SessionAuthMiddleware` OIDC scope is `readonly` when claim doesn't match   | OIDC RBAC (non-admin)       |
| `SessionAuthMiddleware` OIDC scope is `admin` when claim matches            | OIDC RBAC (admin)           |
| `SessionAuthMiddleware` OIDC scope defaults to `admin` without claim config | OIDC RBAC (backward compat) |
| `SessionAuthMiddleware` rejects requests with no auth headers               | Missing auth                |
| `OidcAuthMiddleware` validates OIDC tokens when enabled                     | OIDC auth                   |
| `OidcAuthMiddleware` throws 401 when OIDC is not configured                 | OIDC disabled rejection     |
| `OidcAuthMiddleware` throws 403 for non-admin OIDC users                    | Admin-only enforcement      |
| `OidcAuthMiddleware` allows admin OIDC users through                        | Admin access granted        |
| `SecurityHeadersListener` sets correct headers                              | Security headers            |

### `AppResolverService`

| Test                                            | What it verifies     |
| ----------------------------------------------- | -------------------- |
| `resolveByOrigin()` maps known origin to appId  | Origin-based lookup  |
| `resolveByApiKey()` maps known API key to appId | API-key-based lookup |
| Caches resolved apps, refreshes after TTL       | Cache + TTL          |
| Returns undefined for unknown origin/key        | Missing app          |

---

## Phase 2b — Security & Authorization Tests (P0/P1)

Critical security boundary tests that validate authorization invariants. Many of these originated from an external review; the underlying bugs have been fixed, but regression tests are essential.

### Authentication & RBAC

| Test                                                                             | Severity     | What it verifies                     |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------ |
| `OidcAuthMiddleware` throws 401 when OIDC disabled (regression for prior bypass) | **Critical** | API key CRUD blocked without OIDC    |
| `SessionAuthMiddleware` rejects unauthenticated requests to all protected routes | High         | No auth header → 401                 |
| OIDC audience validation is enforced when `OIDC_CLIENT_ID` is set                | High         | Wrong-audience tokens rejected       |
| OIDC claim-based RBAC assigns `readonly` scope when claim doesn't match          | High         | Non-admin users get restricted scope |
| OIDC claim-based RBAC assigns `admin` scope when claim matches                   | High         | Admin users get full scope           |

### WebSocket authorization scope enforcement

| Test                                                                    | Severity     | What it verifies                                           |
| ----------------------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| Client WS upgrade rejects appId mismatch for existing session           | **Critical** | Session-app binding enforced on client upgrade             |
| Embed-token agent upgrade enforces `sid` claim against `:sessionId`     | **Critical** | Embed token cannot connect to arbitrary sessions           |
| Embed-token agent upgrade enforces `apps` claim against session's appId | **Critical** | Embed token cannot cross app boundary                      |
| Watch WS with embed-token enforces `appIds` on `set_filters` messages   | **Critical** | Watcher cannot bypass app scoping after connect            |
| `SessionNotifyService` enforces `allowedAppIds` in all dispatch paths   | **Critical** | Regression: stale check, local watchers, Redis all enforce |
| Shared-viewer WS upgrade checks DB for share-link revocation            | **Critical** | Revoked share links rejected for live access               |
| Agent WS rejects expired/invalid OIDC tokens                            | High         | Token expiry enforced on WS upgrade                        |
| Client WS rejects invalid API key                                       | High         | Invalid key → connection refused                           |

### WebSocket abuse resistance

| Test                                                         | Severity | What it verifies                                    |
| ------------------------------------------------------------ | -------- | --------------------------------------------------- |
| WS rejects messages exceeding max payload size               | High     | No unbounded memory from large messages             |
| WS rejects malformed JSON messages                           | Medium   | Schema validation on incoming messages              |
| WS rate limiter drops messages exceeding 100/sec per session | Medium   | Rate limiting enforced on client and agent messages |

### Share link security

| Test                                             | Severity | What it verifies             |
| ------------------------------------------------ | -------- | ---------------------------- |
| Revoked share link returns 403 on HTTP endpoints | High     | Revocation enforced for REST |
| Expired share link returns 403                   | High     | Expiry enforced              |
| Share token HMAC rejects tampered payloads       | High     | Cryptographic integrity      |

### API key security

| Test                                                                 | Severity | What it verifies                               |
| -------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| API key scope (`readonly` vs `interactive`) is enforced              | High     | Scope boundaries                               |
| API key `appIds` restriction prevents cross-app access               | High     | App isolation                                  |
| Deactivated API key is rejected                                      | High     | Key revocation                                 |
| `ApiKeyService.update()` rejects invalid scope values                | High     | Scope enum validation (e.g. rejects `"admin"`) |
| `ApiKeyService.update()` accepts `readonly` and `interactive` scopes | Medium   | Valid scope values pass                        |

### Loki query injection

| Test                                                                       | Severity | What it verifies                |
| -------------------------------------------------------------------------- | -------- | ------------------------------- |
| `escapeLogQL` escapes backslashes, double quotes, and backticks            | High     | Injection prevention            |
| `queryLogs` with malicious `deviceId` (containing `"`) produces safe query | High     | Label matcher injection blocked |
| `deleteSessionLogs` with malicious `deviceId` produces safe query          | High     | Delete query injection blocked  |

---

## Phase 2c — Concurrency & Resilience Tests

Edge cases around concurrent operations and failure modes. The chunk indexing race condition has been fixed via atomic `UPDATE...RETURNING` in `persistEvents()`, but regression tests are still essential.

| Test                                                                | What it verifies                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Concurrent ingests for same session don't overwrite event chunks    | Regression: atomic UPDATE...RETURNING prevents chunk index races |
| Concurrent ingests for same session produce correct chunk indices   | S3 key uniqueness under concurrency                              |
| Redis disconnect during live session degrades gracefully            | Redis failover behavior                                          |
| S3 write failure during ingest returns appropriate error            | Storage failure handling                                         |
| Loki push failure during ingest does not block event storage        | Partial failure isolation                                        |
| Multiple agents connect/disconnect rapidly without state corruption | LiveSessionService stability                                     |

---

## Phase 3 — Server Integration Tests (dksf-test + TestingFacade)

Uses dk-server-foundation's `TestingFacade` with `enableDatabase: true` for real Postgres isolation. Each test suite gets its own auto-created/destroyed database. Requires Docker Compose for Postgres, S3 (LocalStack), and Redis.

### Integration test pattern

```typescript
import { describe, it, after } from 'node:test';
import {
    TestingHelpers,
    makeMockRequest,
    defineEntityFixtures,
    loadEntityFixtures,
    disconnectAllRedis
} from '@zyno-io/dk-server-foundation';

describe('Ingest Integration', () => {
    const tf = TestingHelpers.createTestingFacade(
        {
            db: UxrrDatabase,
            controllers: [IngestController],
            providers: [IngestService, S3Service, LokiService, /* ... */]
        },
        {
            enableDatabase: true,
            enableMigrations: true,
            dbAdapter: 'postgres',
            seedData: async (facade) => {
                await loadEntityFixtures([appFixtures.testApp]);
            }
        }
    );
    TestingHelpers.installStandardHooks(tf);

    after(() => disconnectAllRedis());

    it('full ingest roundtrip', async () => {
        const res = await makeMockRequest(tf, 'POST',
            '/v1/ng/app-1/sess-1/data',
            { 'x-api-key': 'test-key' },
            { events: [...], logs: [...], identity: {...} }
        );
        assert.strictEqual(res.statusCode, 200);
        // verify session created in DB, events in S3, logs in Loki
    });
});
```

### Test cases

| Test                                                            | What it verifies                                          |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Full ingest roundtrip: POST data → session in DB + events in S3 | End-to-end ingest                                         |
| Multiple ingests accumulate event chunks correctly              | Chunking                                                  |
| OTLP trace forwarding (mock Tempo endpoint)                     | Trace pipeline                                            |
| Session list API returns ingested sessions                      | Read-after-write                                          |
| API key auth flow (create key → use key → ingest)               | API key lifecycle                                         |
| Share link creation and validation                              | Share flow                                                |
| Database migrations run cleanly on fresh DB                     | Migration integrity (covered by `enableMigrations: true`) |

### Docker Compose for tests

```yaml
# docker-compose.test.yml
services:
    postgres:
        image: postgres:17
        environment:
            POSTGRES_DB: uxrr_test
            POSTGRES_USER: uxrr
            POSTGRES_PASSWORD: test
        ports: ['5432:5432']

    redis:
        image: redis:7
        ports: ['6379:6379']

    localstack:
        image: localstack/localstack:latest
        ports:
            - '4566:4566'
```

---

## Phase 4 — UI Component Tests

Vitest + Vue Test Utils for component logic. Not rendering pixels — that's PixelCI's job.

### Components

| Component         | Tests                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| `FilterBar`       | Emits filter events, renders active filters, clears filters               |
| `SessionTable`    | Renders session rows, click emits select, sorts columns, shows live badge |
| `ConsolePanel`    | Renders log entries by level, filters by level, auto-scrolls              |
| `NetworkPanel`    | Renders HTTP spans, expands detail, filters by status/method              |
| `ChatPanel`       | Renders messages, emits send, shows typing indicator                      |
| `DateRangePicker` | Emits date range, validates start < end, presets work                     |
| `ReplayPlayer`    | Mounts rrweb-player, emits time updates, handles live mode                |
| `UserInfoPopover` | Renders user details, triggers on hover/click                             |

### Pages (shallow/integration)

| Page                                      | Tests                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `SessionList`                             | Loads sessions on mount, applies filters, WebSocket stream updates add rows |
| `SessionDetail`                           | Loads session data, switches tabs, live mode connects WS                    |
| `SharedSessionDetail`                     | Validates share token, renders read-only view                               |
| `EmbedSessionList` / `EmbedSessionDetail` | Renders in embed mode (no chrome)                                           |

---

## Phase 5 — E2E Tests (Playwright)

Full browser tests against a running dev stack. Focus on critical user journeys.

| Test                    | Steps                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| **Session list loads**  | Navigate → verify table renders, sessions appear                            |
| **Filter sessions**     | Apply app/date/user filters → verify filtered results                       |
| **View session detail** | Click session → verify replay player loads, console/network panels populate |
| **Tab switching**       | Switch between Console, Network, Chat tabs → verify content changes         |
| **Live session**        | Connect agent WS → verify live badge, real-time events appear               |
| **Share session**       | Create share link → open in incognito → verify shared view loads            |
| **Date range picker**   | Select custom range → verify sessions update                                |

### Playwright config highlights

- Base URL: `http://localhost:8978` (Vite dev server)
- API proxy already configured in Vite → `localhost:8977`
- Seed test data via API before tests
- Screenshot assertions for layout sanity (supplement to PixelCI)

---

## Phase 6 — Visual Regression with PixelCI

PixelCI captures screenshots in CI and compares against approved baselines. This covers visual correctness that unit/component tests cannot.

### Screenshot Inventory

| Screen Name                   | URL/State                           | What it catches                  |
| ----------------------------- | ----------------------------------- | -------------------------------- |
| `session-list-empty`          | `/sessions` (no data)               | Empty state layout               |
| `session-list-populated`      | `/sessions` (seeded data)           | Table layout, row rendering      |
| `session-list-filtered`       | `/sessions` with active filters     | Filter bar + filtered table      |
| `session-list-live`           | `/sessions` with live session badge | Live indicator styling           |
| `session-detail-replay`       | `/sessions/:id` replay tab          | Replay player chrome, controls   |
| `session-detail-console`      | `/sessions/:id` console tab         | Log entries, level colors        |
| `session-detail-network`      | `/sessions/:id` network tab         | Request table, status colors     |
| `session-detail-chat`         | `/sessions/:id` chat tab            | Chat bubbles, input              |
| `session-detail-live`         | `/sessions/:id` in live mode        | Live badge, agent indicators     |
| `session-detail-share-dialog` | Share dialog open                   | Dialog overlay, share URL        |
| `shared-session-view`         | `/shared/:token`                    | Read-only view, no edit controls |
| `embed-session-list`          | Embed variant                       | Chromeless list                  |
| `embed-session-detail`        | Embed variant                       | Chromeless detail                |
| `date-range-picker-open`      | Picker expanded                     | Calendar, presets                |
| `user-info-popover`           | Popover visible                     | User details tooltip             |

### Implementation approach

1. Add `@pixelci/cli` as a dev dependency
2. Create a Playwright screenshot script that navigates to each state and saves PNGs
3. In CI: seed test data → start dev server → run screenshot script → `pixelci upload`
4. PixelCI compares against approved baseline, blocks merge on unapproved changes

---

## Phase 7 — CI Pipeline

### GitHub Actions (recommended structure)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Unit Tests  │     │ Integration │     │  Visual Regress  │
│  (all pkgs)  │     │   Tests     │     │   (PixelCI)      │
│  ~30s        │     │  ~2min      │     │  ~3min           │
└──────┬───────┘     └──────┬──────┘     └────────┬─────────┘
       │                    │                     │
       └────────────┬───────┘                     │
                    │                             │
              ┌─────▼──────┐              ┌───────▼────────┐
              │  E2E Tests │              │ PixelCI Review  │
              │  ~5min     │              │ (manual gate)   │
              └────────────┘              └────────────────┘
```

**Jobs:**

1. **`test-client-unit`** — `yarn vitest run` in `packages/client`. Fast, no Docker.
2. **`test-api-unit`** — `yarn test` in `packages/api` (dksf-test, no DB). Fast, no Docker.
3. **`test-ui-unit`** — `yarn vitest run` in `packages/ui`. Fast, no Docker.
4. **`test-api-integration`** — Docker Compose up → `yarn test:int` in `packages/api` → down.
5. **`test-e2e`** — Docker Compose up → start server → start UI → Playwright.
6. **`visual-regression`** — Same as E2E setup → capture screenshots → `pixelci upload`.

---

## Implementation Priority

| Priority | What                                                                  | Why                                                      |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **P0**   | Vitest setup + client `IngestBuffer` tests                            | Highest complexity, most likely to regress, pure logic   |
| **P0**   | Client `IdentityManager` + `SessionManager` tests                     | Core correctness, localStorage/sessionStorage edge cases |
| **P0**   | Security: auth bypass tests (OIDC disabled, embed-token scope)        | Critical vulnerabilities identified in review            |
| **P0**   | Security: WebSocket authz scope enforcement tests                     | Embed-token sid/apps and watcher filter bypass           |
| **P1**   | Security: share link revocation + API key scope tests                 | Authorization boundary enforcement                       |
| **P1**   | Server `IngestService` unit tests (dksf-test + SqlTestingHelper)      | Core data pipeline, validates storage logic              |
| **P1**   | Server `LiveSessionService` unit tests (dksf-test)                    | Complex state machine, multi-connection relay            |
| **P1**   | UI component tests (FilterBar, SessionTable, ConsolePanel)            | Most-used components                                     |
| **P2**   | Concurrency tests (chunk index races, rapid connect/disconnect)       | Data integrity under load                                |
| **P2**   | Server integration tests (dksf-test + TestingFacade + Docker Compose) | Full pipeline validation                                 |
| **P2**   | Playwright E2E (critical paths)                                       | User journey confidence                                  |
| **P2**   | PixelCI visual regression setup                                       | Catches CSS/layout regressions                           |
| **P3**   | Remaining server unit tests (middleware, other services)              | Coverage completeness                                    |
| **P3**   | Remaining UI component/page tests                                     | Coverage completeness                                    |
| **P3**   | CI pipeline                                                           | Automate everything                                      |

---

## Monorepo Test Config Sketch

```
uxrr/
├── packages/
│   ├── client/
│   │   ├── vitest.config.ts     # environment: 'happy-dom'
│   │   └── src/__tests__/       # co-located tests
│   ├── server/
│   │   ├── tests/
│   │   │   ├── unit/            # dksf-test unit tests (SqlTestingHelper, no DB)
│   │   │   └── integration/     # dksf-test integration tests (TestingFacade, real DB)
│   │   └── fixtures/            # defineEntityFixtures for test data
│   └── ui/
│       ├── vitest.config.ts     # environment: 'happy-dom', vue plugin
│       ├── src/__tests__/       # component tests
│       ├── playwright.config.ts
│       └── tests/e2e/           # Playwright E2E tests
├── docker-compose.test.yml      # Postgres, Redis, LocalStack for integration
└── .github/workflows/test.yml   # CI pipeline
```

---

## Metrics Targets (long-term)

| Metric                        | Target                           |
| ----------------------------- | -------------------------------- |
| Client unit test coverage     | >85% line coverage               |
| Server unit test coverage     | >75% line coverage               |
| UI component test coverage    | >70% line coverage               |
| E2E critical path coverage    | All 7 journeys passing           |
| Visual regression screens     | All 15 screens baselined         |
| Security authz boundary tests | All P0/P1 security tests passing |
| CI green-to-merge time        | <10 minutes                      |

---

## Appendix: External Security Review Findings

The following findings were identified by external reviews (Gemini Feb 2026, Codex Feb 2026) and informed Phase 2b/2c above. Items marked **FIXED** have been addressed; remaining items are tracked for future work.

### Critical

1. **~~API key management unauthenticated when OIDC disabled.~~** **FIXED.** `OidcAuthMiddleware` now throws 401 when OIDC is not configured, blocking all API key CRUD endpoints. Additionally, **FIXED (Codex review):** middleware now enforces admin scope via `extractOidcScope` — non-admin OIDC users get 403.

2. **Embed-token scope not enforced on WebSocket upgrade.** Agent live-session upgrade verifies the embed token signature but does not check `sid` or `apps` claims against the requested `:sessionId` ([websocket.service.ts:145](packages/api/src/services/websocket.service.ts#L145)). **Fix:** Validate `sid` and `apps` claims during upgrade.

3. **~~Watcher filter bypass after connect.~~** **FIXED.** `SessionNotifyService` now enforces `allowedAppIds` in all three dispatch paths (local watchers, Redis notifications, stale checks).

4. **Revoked share links still work for WebSocket.** Live WebSocket upgrade validates the share token cryptographically but does not check DB revocation status ([websocket.service.ts:183](packages/api/src/services/websocket.service.ts#L183)), unlike the HTTP path which does ([share.service.ts:73](packages/api/src/services/share.service.ts#L73)). **Fix:** Add DB revocation check to WS upgrade path.

### High

5. **API secrets stored plaintext.** API key secrets are persisted raw in the database ([api-key.entity.ts:9](packages/api/src/database/entities/api-key.entity.ts#L9), [api-key.service.ts:47](packages/api/src/services/api-key.service.ts#L47)). App ingest keys are also plaintext ([app.entity.ts:9](packages/api/src/database/entities/app.entity.ts#L9)). **Fix:** Hash secrets at rest; compare via constant-time hash comparison.

6. **OIDC audience validation optional.** Audience is only enforced when `OIDC_CLIENT_ID` is set ([oidc.service.ts:17](packages/api/src/services/oidc.service.ts#L17)). Without it, tokens from the same issuer but different clients are accepted. **Fix:** Require `OIDC_CLIENT_ID` when OIDC is enabled.

7. **~~Race condition in event chunk indexing.~~** **FIXED.** `persistEvents()` now uses atomic `UPDATE...RETURNING` to increment `eventChunkCount` and return the chunk index in a single query.

8. **Tokens in WebSocket query strings.** **Documented as accepted tradeoff.** Browser WS API limitation — mitigate via short-lived tokens and log scrubbing. Comment added to `websocket.service.ts`.

9. **~~No WebSocket message size limits.~~** **PARTIALLY FIXED.** Rate limiting added (100 msg/sec per session) for both client and agent messages. Explicit `maxPayload` still not set — tracked for future work.

### Medium

10. **CORS wildcarded for token-signing endpoint.** `/v1/api-keys/sign` is accessible from any origin ([app.ts:52](packages/api/src/app.ts#L52)). **Fix:** Restrict CORS for admin endpoints.

11. **Security headers incomplete.** Missing `Content-Security-Policy`, `Permissions-Policy`, and `COOP/COEP` ([security-headers.listener.ts:8](packages/api/src/middleware/security-headers.listener.ts#L8)).

12. **OTLP app validation uses brittle `Buffer.includes`** ([ingest.service.ts:159](packages/api/src/services/ingest.service.ts#L159)). Could be bypassed or fail on legitimate payload variations.

13. **`SessionService.getOrThrow` returns 500 instead of 404** ([session.service.ts:64](packages/api/src/services/session.service.ts#L64)). Should throw `HttpNotFoundError`.

14. **`target="_blank"` links missing `rel="noopener noreferrer"`** in ConsolePanel and NetworkPanel.

### Codex Review Findings (Feb 2026)

The following were identified by the Codex review and fixed:

1. **~~API key scope not service-validated.~~** **FIXED.** `ApiKeyService.update()` now rejects any scope value other than `readonly` or `interactive` with a 400 error, preventing privilege escalation via scope tampering.

2. **~~Loki LogQL injection via unescaped values.~~** **FIXED.** Added `escapeLogQL()` helper that escapes `\`, `"`, and `` ` `` characters. Applied to `deviceId` and `sessionId` in `queryLogs()` and `deleteSessionLogs()`.

3. **~~Retention defaults to forever.~~** **FIXED.** `DATA_RETENTION_DAYS` default changed from `0` (disabled) to `30`.

### Additional Fixes (not from original review)

The following improvements were implemented alongside the review fixes:

- **Session-app binding on client WS upgrade** — rejects appId mismatch for existing sessions
- **OIDC claim-based RBAC** — optional `OIDC_ADMIN_CLAIM`/`OIDC_ADMIN_VALUE` config for `admin`/`readonly` scope
- **HTTP ingest rate limiting** — 60 req/min per IP on ingest endpoints (429 on exceed)
- **Fetch timeout in browser SDK** — `AbortSignal.timeout(10_000)` on all `postJSON()` calls
- **Event retry with failure counter** — re-queues events up to 3 consecutive failures, then drops + requests full snapshot
- **Removed dead `/otlp/logs` endpoint** — only traces are forwarded via OTLP
- **Session query limit cap** — `Math.min(limit, 200)` prevents unbounded queries
- **`maskTextContent` defaults to `true`** — privacy-safe default for rrweb recording
- **Loki label cardinality reduction** — `sessionId` moved from label to JSON log line; queries use `deviceId` label + time bounds + `sessionId` line filter
- **SDK lifecycle cleanup on re-init** — `configure()` tears down previous subsystems; `stop()` unregisters from `FlushCoordinator`
- **WS reconnect with exponential backoff** — all UI WebSocket connections (live-stream, session-list-stream) use `Math.min(1000 * 2^attempt, 30000)` + 30% jitter

### Architecture Notes

- **Good:** Clean package boundaries and DI-style service/controller separation.
- **Good:** Centralized `AuthContext` model in `SessionAuthMiddleware`.
- **Risk:** `LiveSessionService` is very large (~800 lines), mixing transport/auth/state/persistence concerns — high regression risk.
- **Risk:** Near-duplicate page logic across SessionDetail/SharedSessionDetail/EmbedSessionDetail increases drift probability.
- **Risk:** S3 replay retrieval is sequential object-by-object; could bottleneck on long sessions.
