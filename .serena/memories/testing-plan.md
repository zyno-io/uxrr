# Testing Plan Summary

See `/TESTING-PLAN.md` for the full plan.

## Framework Choices

- **Client**: Vitest + happy-dom
- **API**: dksf-test (node:test + dk-server-foundation) — TestingFacade, SqlTestingHelper, makeMockRequest, entity fixtures
- **UI**: Vitest + Vue Test Utils (component) + Playwright (E2E)
- **Visual regression**: PixelCI

## Phases

1. Client SDK unit tests (P0) — IngestBuffer, IdentityManager, SessionManager, UXRR, Logger, Recorder
2. API unit tests (P1) — IngestService, LiveSessionService, controllers via makeMockRequest, middleware
3. API integration tests (P2) — TestingFacade + real Postgres/Redis/MinIO via Docker Compose
4. UI component tests (P1) — FilterBar, SessionTable, ConsolePanel, NetworkPanel, ChatPanel, etc.
5. E2E tests (P2) — Playwright, 7 critical user journeys
6. Visual regression (P2) — PixelCI, 15 screenshot states
7. CI pipeline (P3) — GitHub Actions with parallel jobs
