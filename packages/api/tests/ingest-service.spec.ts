import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

import { IngestService, type IngestDataPayload } from '../src/services/ingest.service';
import { SessionEntity } from '../src/database/entities/session.entity';
import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';
import type { S3Service } from '../src/services/s3.service';
import type { LokiService } from '../src/services/loki.service';
import type { LiveSessionService } from '../src/services/live-session.service';
import type { SessionNotifyService } from '../src/services/session-notify.service';
import type { Logger } from '@deepkit/logger';

const gunzipAsync = promisify(gunzip);

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        UXRR_INGEST_EVENT_FLUSH_DELAY_MS: 1000,
        UXRR_INGEST_EVENT_FLUSH_MAX_EVENTS: 1,
        UXRR_INGEST_EVENT_FLUSH_MAX_BYTES: 262144,
        ...overrides
    } as UxrrConfig;
}

function makePayload(overrides: Partial<IngestDataPayload> = {}): IngestDataPayload {
    return {
        identity: { deviceId: 'dev-1', userId: 'user-1', userName: 'Alice', userEmail: 'alice@test.com' },
        meta: { version: '1.0', environment: 'test', userAgent: 'TestAgent' },
        launchTs: Date.now(),
        ...overrides
    };
}

function makeSessionEntity(overrides: Partial<SessionEntity> = {}): SessionEntity {
    const now = new Date();
    return {
        id: 'sess-1',
        appId: 'app-1',
        deviceId: 'dev-1',
        userId: 'user-1',
        startedAt: now,
        lastActivityAt: now,
        eventChunkCount: 1,
        eventBytesStored: 0,
        createdAt: now,
        updatedAt: now
    } as SessionEntity;
}

function createMocks(opts: { existingSession?: SessionEntity | null; rawFindResult?: unknown[] } = {}) {
    const persistFn = mock.fn(async () => {});
    const rawFindUnsafeFn = mock.fn(async () => opts.rawFindResult ?? [{ chunkIndex: 0 }]);
    const putEventsFn = mock.fn(async (_appId: string, _sessId: string, _chunk: number, _data: unknown) => {});
    const pushLogsFn = mock.fn(async (_entries: unknown[]) => {});
    const relayToAgentFn = mock.fn((_sessionId: string, _message: unknown) => {});
    const notifyCreatedFn = mock.fn();
    const notifyUpdatedFn = mock.fn();

    const db = {
        query: mock.fn((entity: unknown) => {
            const entityName = (entity as Record<string, unknown>)?.name ?? 'unknown';
            if (entityName === 'SessionEntity') {
                return {
                    filter: mock.fn(function (this: unknown) {
                        return this;
                    }),
                    findOneOrUndefined: mock.fn(async () => opts.existingSession ?? undefined),
                    findOne: mock.fn(async () => opts.existingSession ?? makeSessionEntity()),
                    find: mock.fn(async () => (opts.existingSession ? [opts.existingSession] : []))
                };
            }
            if (entityName === 'SessionUserIdEntity') {
                return {
                    filter: mock.fn(function (this: unknown) {
                        return this;
                    }),
                    has: mock.fn(async () => false),
                    find: mock.fn(async () => [{ userId: 'user-1' }])
                };
            }
            return {
                filter: mock.fn(function (this: unknown) {
                    return this;
                }),
                findOneOrUndefined: mock.fn(async () => undefined),
                findOne: mock.fn(async () => ({})),
                find: mock.fn(async () => []),
                has: mock.fn(async () => false)
            };
        }),
        persist: persistFn,
        rawFindUnsafe: rawFindUnsafeFn
    } as unknown as UxrrDatabase;

    const s3 = { putEvents: putEventsFn, putEventsCompressed: putEventsFn } as unknown as S3Service;
    const loki = { pushLogs: pushLogsFn } as unknown as LokiService;
    const live = { relayToAgent: relayToAgentFn } as unknown as LiveSessionService;
    const notify = {
        notifySessionCreated: notifyCreatedFn,
        notifySessionUpdated: notifyUpdatedFn
    } as unknown as SessionNotifyService;

    return {
        db,
        s3,
        loki,
        live,
        notify,
        persistFn,
        rawFindUnsafeFn,
        putEventsFn,
        pushLogsFn,
        relayToAgentFn,
        notifyCreatedFn,
        notifyUpdatedFn
    };
}

describe('IngestService', () => {
    describe('ingestData — new session', () => {
        it('creates new session on first ingest', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData(
                'app-1',
                'sess-1',
                makePayload({
                    events: [{ type: 2, data: {}, timestamp: Date.now() }]
                })
            );

            assert.equal(m.persistFn.mock.callCount(), 2); // session + user-id
            assert.equal(m.notifyCreatedFn.mock.callCount(), 1);
        });
    });

    describe('ingestData — existing session', () => {
        it('updates existing session via atomic UPDATE...RETURNING', async () => {
            const existing = makeSessionEntity({ eventChunkCount: 3 });
            const m = createMocks({ existingSession: existing, rawFindResult: [{ chunkIndex: 3 }] });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData(
                'app-1',
                'sess-1',
                makePayload({
                    events: [{ type: 3, data: {}, timestamp: Date.now() }]
                })
            );

            assert.equal(m.rawFindUnsafeFn.mock.callCount(), 2);
            const sqlCalls = (m.rawFindUnsafeFn.mock.calls as unknown as Array<{ arguments: unknown[] }>).map(c =>
                String(c.arguments[0] ?? '')
            );
            assert.ok(
                sqlCalls.some(
                    sql =>
                        sql.includes('RETURNING') &&
                        sql.includes('"eventChunkCount" = "eventChunkCount" + 1') &&
                        sql.includes('"eventBytesStored" = "eventBytesStored" +')
                ),
                'Should reserve chunk index atomically with UPDATE...RETURNING'
            );
            assert.equal(m.notifyUpdatedFn.mock.callCount(), 2);
        });
    });

    describe('events → S3', () => {
        it('stores events to S3 with correct chunk index', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const events = [
                { type: 2, data: {}, timestamp: 1000 },
                { type: 3, data: {}, timestamp: 2000 }
            ];
            await svc.ingestData('app-1', 'sess-1', makePayload({ events }));

            assert.equal(m.putEventsFn.mock.callCount(), 1);
            const args = m.putEventsFn.mock.calls[0].arguments;
            assert.equal(args[0], 'app-1');
            assert.equal(args[1], 'sess-1');
            assert.equal(args[2], 0); // first chunk
            assert.equal(Buffer.isBuffer(args[3]), true);
            const decoded = JSON.parse((await gunzipAsync(args[3] as Buffer)).toString('utf-8'));
            assert.deepEqual(decoded, events);
        });

        it('buffers events and flushes them on shutdown', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(
                makeConfig({
                    UXRR_INGEST_EVENT_FLUSH_DELAY_MS: 60000,
                    UXRR_INGEST_EVENT_FLUSH_MAX_EVENTS: 1000,
                    UXRR_INGEST_EVENT_FLUSH_MAX_BYTES: 1048576
                }),
                m.db,
                m.s3,
                m.loki,
                m.live,
                m.notify,
                makeLogger()
            );

            const events = [{ type: 2, data: {}, timestamp: 1000 }];
            await svc.ingestData('app-1', 'sess-1', makePayload({ events }));
            assert.equal(m.putEventsFn.mock.callCount(), 0, 'should not flush immediately under buffering thresholds');

            await svc.onServerShutdownRequested();

            assert.equal(m.putEventsFn.mock.callCount(), 1);
            const args = m.putEventsFn.mock.calls[0].arguments;
            assert.equal(Buffer.isBuffer(args[3]), true);
            const decoded = JSON.parse((await gunzipAsync(args[3] as Buffer)).toString('utf-8'));
            assert.deepEqual(decoded, events);
        });
    });

    describe('logs → Loki', () => {
        it('forwards logs to Loki with correct labels', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const logs = [{ t: 1000, v: 1, c: 'test', m: 'hello' }];
            await svc.ingestData('app-1', 'sess-1', makePayload({ logs }));

            assert.equal(m.pushLogsFn.mock.callCount(), 1);
            const decorated = m.pushLogsFn.mock.calls[0].arguments[0] as Record<string, unknown>[];
            assert.equal(decorated[0].appId, 'app-1');
            assert.equal(decorated[0].deviceId, 'dev-1');
            assert.equal(decorated[0].userId, 'user-1');
            assert.equal(decorated[0].sessionId, 'sess-1');
        });

        it('Loki log line includes sessionId (not as label)', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData(
                'app-1',
                'sess-1',
                makePayload({
                    logs: [{ t: 1000, v: 1, c: 'scope', m: 'msg' }]
                })
            );

            const decorated = m.pushLogsFn.mock.calls[0].arguments[0] as Record<string, unknown>[];
            assert.equal(decorated[0].sessionId, 'sess-1');
        });
    });

    describe('empty events/logs', () => {
        it('handles empty events array gracefully', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData('app-1', 'sess-1', makePayload({ events: [] }));

            assert.equal(m.putEventsFn.mock.callCount(), 0);
        });

        it('handles empty logs array gracefully', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData('app-1', 'sess-1', makePayload({ logs: [] }));

            assert.equal(m.pushLogsFn.mock.callCount(), 0);
        });

        it('handles payload with no events or logs', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            await svc.ingestData('app-1', 'sess-1', makePayload());

            assert.equal(m.putEventsFn.mock.callCount(), 0);
            assert.equal(m.pushLogsFn.mock.callCount(), 0);
        });
    });

    describe('live relay', () => {
        it('relays events to live agent', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const events = [{ type: 3, data: {}, timestamp: 1000 }];
            await svc.ingestData('app-1', 'sess-1', makePayload({ events }));

            assert.equal(m.relayToAgentFn.mock.callCount(), 1);
            const args = m.relayToAgentFn.mock.calls[0].arguments;
            assert.equal(args[0], 'sess-1');
            assert.equal((args[1] as Record<string, unknown>).type, 'events');
        });

        it('relays logs to live agent', async () => {
            const m = createMocks({ existingSession: null });
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const logs = [{ t: 1000, v: 1, c: 'test', m: 'hello' }];
            await svc.ingestData('app-1', 'sess-1', makePayload({ logs }));

            const calls = m.relayToAgentFn.mock.calls;
            const logRelay = calls.find(c => (c.arguments[1] as Record<string, unknown>).type === 'logs');
            assert.ok(logRelay, 'Should relay logs to agent');
        });
    });

    describe('forwardOtlp', () => {
        it('rejects unsupported OTLP path', async () => {
            const m = createMocks();
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const result = await svc.forwardOtlp('logs', Buffer.from(''), 'application/json');
            assert.equal(result.status, 400);
            assert.match(result.body, /unsupported OTLP path/);
        });

        it('rejects unsupported content type', async () => {
            const m = createMocks();
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const result = await svc.forwardOtlp('traces', Buffer.from(''), 'text/plain');
            assert.equal(result.status, 400);
            assert.match(result.body, /unsupported content type/);
        });

        it('rejects payload missing uxrr session marker', async () => {
            const m = createMocks();
            const svc = new IngestService(makeConfig(), m.db, m.s3, m.loki, m.live, m.notify, makeLogger());

            const result = await svc.forwardOtlp('traces', Buffer.from('{"traces": []}'), 'application/json');
            assert.equal(result.status, 400);
            assert.match(result.body, /missing uxrr session/);
        });
    });
});
