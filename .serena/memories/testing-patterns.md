# Testing Patterns

## Client Tests (Vitest + happy-dom)

- Config: `packages/client/vitest.config.ts` with `environment: 'happy-dom'`
- Test location: `packages/client/src/__tests__/*.spec.ts`
- Run: `cd packages/client && npx vitest run`
- Use `vi.useFakeTimers()` / `vi.useRealTimers()` for timer-dependent tests
- Use `vi.advanceTimersByTimeAsync(0)` to flush pending microtasks (promise resolution)
- Mock HttpTransport, IdentityManager, SupportConnection with `vi.fn()`
- For testing re-entrancy (isFlushing guard), use `vi.fn(() => new Promise(() => {}))` to hang

## Server Tests (node:test via dksf-dev test)

- Test location: `packages/api/tests/*.spec.ts`
- Run: `cd packages/api && npx dksf-dev test`
- Uses `mock.fn()` from `node:test` — NOT vitest
- For changing mock implementations, create a new mock object rather than re-assigning
  (node:test mock.fn doesn't have `.mockImplementation()` on the function — it's on `.mock`)
- Pattern: cast mocks as `unknown as Type` for DI dependencies
- Access call args: `mockFn.mock.calls[0].arguments`
- Access call count: `mockFn.mock.callCount()`
