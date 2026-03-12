import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { IngestController } from '../src/controllers/ingest.controller';
import { APP_KEY_KEY, APP_UUID_KEY, APP_MAX_IDLE_TIMEOUT_KEY } from '../src/middleware/origin.guard';
import { SessionEntity } from '../src/database/entities/session.entity';
import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';
import type { IngestService } from '../src/services/ingest.service';
import type { IngestDataPayload } from '../src/services/ingest.service';
import type { LiveSessionService } from '../src/services/live-session.service';
import type { HttpRequest } from '@deepkit/http';
import type { ScopedLogger } from '@deepkit/logger';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        UXRR_MAX_EVENT_BATCH_SIZE: 500,
        UXRR_MAX_LOG_BATCH_SIZE: 1000,
        ...overrides
    } as UxrrConfig;
}

function makeRequest(appKey: string, opts: { body?: Buffer; maxIdleTimeout?: number } = {}): HttpRequest {
    const req: Record<string | symbol, unknown> = {
        [APP_KEY_KEY]: appKey,
        [APP_UUID_KEY]: `uuid-${appKey}`,
        body: opts.body ?? null,
        socket: { remoteAddress: '127.0.0.1' }
    };
    if (opts.maxIdleTimeout !== undefined) {
        req[APP_MAX_IDLE_TIMEOUT_KEY] = opts.maxIdleTimeout;
    }
    return req as unknown as HttpRequest;
}

const mockLogger = { warn: mock.fn() } as unknown as ScopedLogger;

function createMocks(opts: { existingSession?: SessionEntity | null } = {}) {
    const ingestDataFn = mock.fn(async (_appUuid: string, _appKey: string, _sessId: string, _body: IngestDataPayload, _ip?: string) => {});
    const isAgentConnectedFn = mock.fn((_sessId: string) => false);

    const ingestSvc = { ingestData: ingestDataFn } as unknown as IngestService;
    const liveSvc = { isAgentConnected: isAgentConnectedFn } as unknown as LiveSessionService;

    const findOneOrUndefinedFn = mock.fn(async () => opts.existingSession ?? undefined);
    const db = {
        query: mock.fn((_entity: unknown) => ({
            filter: mock.fn(function (this: unknown) {
                return this;
            }),
            findOneOrUndefined: findOneOrUndefinedFn
        }))
    } as unknown as UxrrDatabase;

    return { db, ingestSvc, liveSvc, ingestDataFn, isAgentConnectedFn, findOneOrUndefinedFn };
}

const VALID_SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('IngestController', () => {
    describe('ingestData', () => {
        it('calls ingestService with correct args', async () => {
            const { db, ingestSvc, liveSvc, ingestDataFn } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');
            const body = { events: [{ type: 2, data: {}, timestamp: 1000 }] };

            await controller.ingestData('app-1', VALID_SESSION_ID, request, body as unknown as IngestDataPayload);
            assert.equal(ingestDataFn.mock.callCount(), 1);
            assert.equal(ingestDataFn.mock.calls[0].arguments[0], 'uuid-app-1');
            assert.equal(ingestDataFn.mock.calls[0].arguments[1], 'app-1');
        });

        it('returns { ok: true } without ws flag when no agent connected', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.deepEqual(result, { ok: true });
        });

        it('returns { ok: true, ws: true } when agent is connected', async () => {
            const { db, ingestSvc, liveSvc, isAgentConnectedFn } = createMocks();
            isAgentConnectedFn.mock.mockImplementation(() => true);
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.deepEqual(result, { ok: true, ws: true });
        });

        it('decodes URL-encoded appKey with slash', async () => {
            const { db, ingestSvc, liveSvc, ingestDataFn } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('@zyno-io/zynosuite-spa');

            await controller.ingestData('%40zyno-io%2Fzynosuite-spa', VALID_SESSION_ID, request, {
                events: [{ type: 2, data: {}, timestamp: 1000 }]
            } as unknown as IngestDataPayload);
            assert.equal(ingestDataFn.mock.callCount(), 1);
            assert.equal(ingestDataFn.mock.calls[0].arguments[1], '@zyno-io/zynosuite-spa');
        });

        it('throws on appKey mismatch', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            await assert.rejects(
                () => controller.ingestData('app-OTHER', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /App key mismatch/);
                    return true;
                }
            );
        });

        it('throws on invalid session ID format', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            await assert.rejects(
                () => controller.ingestData('app-1', 'not-a-uuid', request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Invalid session ID/);
                    return true;
                }
            );
        });

        it('throws on oversized body', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const bigBody = Buffer.alloc(6 * 1024 * 1024); // 6MB > 5MB limit
            const request = makeRequest('app-1', { body: bigBody });

            await assert.rejects(
                () => controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Payload too large/);
                    return true;
                }
            );
        });

        it('throws when events exceed max batch size', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig({ UXRR_MAX_EVENT_BATCH_SIZE: 10 }), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');
            const events = Array.from({ length: 11 }, (_, i) => ({ type: 3, data: {}, timestamp: i }));

            await assert.rejects(
                () =>
                    controller.ingestData('app-1', VALID_SESSION_ID, request, {
                        events
                    } as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Too many events/);
                    return true;
                }
            );
        });

        it('throws when logs exceed max batch size', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig({ UXRR_MAX_LOG_BATCH_SIZE: 5 }), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');
            const logs = Array.from({ length: 6 }, (_, i) => ({ t: i, v: 1, c: 'test', m: `msg-${i}` }));

            await assert.rejects(
                () =>
                    controller.ingestData('app-1', VALID_SESSION_ID, request, {
                        logs
                    } as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Too many logs/);
                    return true;
                }
            );
        });
    });

    describe('validateSessionId format', () => {
        it('accepts valid UUID format', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            // Should not throw
            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.ok(result.ok);
        });

        it('rejects non-UUID session ID', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            await assert.rejects(
                () => controller.ingestData('app-1', '../../../etc/passwd', request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Invalid session ID/);
                    return true;
                }
            );
        });
    });

    describe('idle timeout enforcement', () => {
        it('allows ingest when session is within idle timeout', async () => {
            const now = new Date();
            const session = {
                id: VALID_SESSION_ID,
                lastActivityAt: new Date(now.getTime() - 1000) // 1s ago
            } as SessionEntity;
            const { db, ingestSvc, liveSvc } = createMocks({ existingSession: session });
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1', { maxIdleTimeout: 60000 }); // 60s timeout

            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.ok(result.ok);
        });

        it('throws HttpGoneError (410) when session exceeds idle timeout', async () => {
            const now = new Date();
            const session = {
                id: VALID_SESSION_ID,
                lastActivityAt: new Date(now.getTime() - 120000) // 2 minutes ago
            } as SessionEntity;
            const { db, ingestSvc, liveSvc } = createMocks({ existingSession: session });
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1', { maxIdleTimeout: 60000 }); // 60s timeout

            await assert.rejects(
                () => controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Session exceeded max idle timeout/);
                    // Verify it's a 410 (HttpGoneError)
                    assert.equal((err as { httpCode?: number }).httpCode, 410);
                    return true;
                }
            );
        });

        it('allows ingest for new sessions (no existing session in DB)', async () => {
            const { db, ingestSvc, liveSvc } = createMocks({ existingSession: null });
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1', { maxIdleTimeout: 60000 });

            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.ok(result.ok);
        });

        it('skips idle check when maxIdleTimeout is not set on app', async () => {
            const { db, ingestSvc, liveSvc, findOneOrUndefinedFn } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1'); // no maxIdleTimeout

            await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            // DB should not be queried for idle check
            assert.equal(findOneOrUndefinedFn.mock.callCount(), 0);
        });

        it('returns config with maxIdleTimeout when set', async () => {
            const { db, ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), db, ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1', { maxIdleTimeout: 300000 });

            const result = await controller.ingestData('app-1', VALID_SESSION_ID, request, {} as unknown as IngestDataPayload);
            assert.deepEqual(result, { ok: true, config: { maxIdleTimeout: 300000 } });
        });
    });
});
