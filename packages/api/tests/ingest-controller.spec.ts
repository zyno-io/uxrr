import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { IngestController } from '../src/controllers/ingest.controller';
import { APP_ID_KEY } from '../src/middleware/origin.guard';
import type { UxrrConfig } from '../src/config';
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

function makeRequest(appId: string, body?: Buffer): HttpRequest {
    const req = {
        [APP_ID_KEY]: appId,
        body: body ?? null,
        socket: { remoteAddress: '127.0.0.1' }
    };
    return req as unknown as HttpRequest;
}

const mockLogger = { warn: mock.fn() } as unknown as ScopedLogger;

function createMocks() {
    const ingestDataFn = mock.fn(async (_appId: string, _sessId: string, _body: IngestDataPayload, _ip?: string) => {});
    const isAgentConnectedFn = mock.fn((_sessId: string) => false);

    const ingestSvc = { ingestData: ingestDataFn } as unknown as IngestService;
    const liveSvc = { isAgentConnected: isAgentConnectedFn } as unknown as LiveSessionService;

    return { ingestSvc, liveSvc, ingestDataFn, isAgentConnectedFn };
}

describe('IngestController', () => {
    describe('ingestData', () => {
        it('calls ingestService with correct args', async () => {
            const { ingestSvc, liveSvc, ingestDataFn } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');
            const body = { events: [{ type: 2, data: {}, timestamp: 1000 }] };

            await controller.ingestData(
                'app-1',
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                request,
                body as unknown as IngestDataPayload
            );
            assert.equal(ingestDataFn.mock.callCount(), 1);
            assert.equal(ingestDataFn.mock.calls[0].arguments[0], 'app-1');
        });

        it('returns { ok: true } without ws flag when no agent connected', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            const result = await controller.ingestData(
                'app-1',
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                request,
                {} as unknown as IngestDataPayload
            );
            assert.deepEqual(result, { ok: true });
        });

        it('returns { ok: true, ws: true } when agent is connected', async () => {
            const { ingestSvc, liveSvc, isAgentConnectedFn } = createMocks();
            isAgentConnectedFn.mock.mockImplementation(() => true);
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            const result = await controller.ingestData(
                'app-1',
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                request,
                {} as unknown as IngestDataPayload
            );
            assert.deepEqual(result, { ok: true, ws: true });
        });

        it('decodes URL-encoded appId with slash', async () => {
            const { ingestSvc, liveSvc, ingestDataFn } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('@zyno-io/zynosuite-spa');

            await controller.ingestData('%40zyno-io%2Fzynosuite-spa', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', request, {
                events: [{ type: 2, data: {}, timestamp: 1000 }]
            } as unknown as IngestDataPayload);
            assert.equal(ingestDataFn.mock.callCount(), 1);
            assert.equal(ingestDataFn.mock.calls[0].arguments[0], '@zyno-io/zynosuite-spa');
        });

        it('throws on appId mismatch', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            await assert.rejects(
                () =>
                    controller.ingestData(
                        'app-OTHER',
                        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                        request,
                        {} as unknown as IngestDataPayload
                    ),
                (err: unknown) => {
                    assert.match((err as Error).message, /App ID mismatch/);
                    return true;
                }
            );
        });

        it('throws on invalid session ID format', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
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
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const bigBody = Buffer.alloc(6 * 1024 * 1024); // 6MB > 5MB limit
            const request = makeRequest('app-1', bigBody);

            await assert.rejects(
                () =>
                    controller.ingestData(
                        'app-1',
                        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                        request,
                        {} as unknown as IngestDataPayload
                    ),
                (err: unknown) => {
                    assert.match((err as Error).message, /Payload too large/);
                    return true;
                }
            );
        });

        it('throws when events exceed max batch size', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(
                makeConfig({ UXRR_MAX_EVENT_BATCH_SIZE: 10 }),
                ingestSvc,
                liveSvc,
                mockLogger
            );
            const request = makeRequest('app-1');
            const events = Array.from({ length: 11 }, (_, i) => ({ type: 3, data: {}, timestamp: i }));

            await assert.rejects(
                () =>
                    controller.ingestData('app-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', request, {
                        events
                    } as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Too many events/);
                    return true;
                }
            );
        });

        it('throws when logs exceed max batch size', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(
                makeConfig({ UXRR_MAX_LOG_BATCH_SIZE: 5 }),
                ingestSvc,
                liveSvc,
                mockLogger
            );
            const request = makeRequest('app-1');
            const logs = Array.from({ length: 6 }, (_, i) => ({ t: i, v: 1, c: 'test', m: `msg-${i}` }));

            await assert.rejects(
                () =>
                    controller.ingestData('app-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', request, {
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
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            // Should not throw
            const result = await controller.ingestData(
                'app-1',
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                request,
                {} as unknown as IngestDataPayload
            );
            assert.ok(result.ok);
        });

        it('rejects non-UUID session ID', async () => {
            const { ingestSvc, liveSvc } = createMocks();
            const controller = new IngestController(makeConfig(), ingestSvc, liveSvc, mockLogger);
            const request = makeRequest('app-1');

            await assert.rejects(
                () =>
                    controller.ingestData('app-1', '../../../etc/passwd', request, {} as unknown as IngestDataPayload),
                (err: unknown) => {
                    assert.match((err as Error).message, /Invalid session ID/);
                    return true;
                }
            );
        });
    });
});
