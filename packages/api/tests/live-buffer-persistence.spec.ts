import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { LiveBufferPersistence } from '../src/services/live/live-buffer-persistence';
import type { SessionEntity } from '../src/database/entities/session.entity';
import type { UxrrDatabase } from '../src/database/database';
import type { S3Service } from '../src/services/s3.service';
import type { LokiService } from '../src/services/loki.service';
import type { SessionNotifyService } from '../src/services/session-notify.service';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeSession(overrides: Partial<SessionEntity> = {}): SessionEntity {
    const now = new Date();
    return {
        id: 'sess-1',
        appId: 'app-1',
        deviceId: 'dev-1',
        userId: 'user-1',
        startedAt: now,
        lastActivityAt: now,
        eventChunkCount: 5,
        eventBytesStored: 0,
        createdAt: now,
        updatedAt: now,
        hasChatMessages: false,
        ...overrides
    } as SessionEntity;
}

function createMocks(session?: SessionEntity) {
    const sess = session ?? makeSession();

    const rawFindUnsafeFn = mock.fn(async (_sql: string) => [{ chunkIndex: sess.eventChunkCount }]);
    const persistFn = mock.fn(async () => {});
    const putEventsFn = mock.fn(async (_appId: string, _sessId: string, _chunk: number, _data: unknown) => {});
    const putChatFn = mock.fn(async () => {});
    const pushLogsFn = mock.fn(async (_entries: unknown[]) => {});
    const notifyUpdatedFn = mock.fn();

    const db = {
        query: mock.fn(() => ({
            filter: mock.fn(function (this: unknown) {
                return this;
            }),
            findOneOrUndefined: mock.fn(async () => sess),
            findOne: mock.fn(async () => sess),
            find: mock.fn(async () => [{ userId: 'user-1' }])
        })),
        persist: persistFn,
        rawFindUnsafe: rawFindUnsafeFn
    } as unknown as UxrrDatabase;

    const s3 = {
        putEvents: putEventsFn,
        putEventsCompressed: putEventsFn,
        putChat: putChatFn
    } as unknown as S3Service;

    const loki = { pushLogs: pushLogsFn } as unknown as LokiService;

    const notify = {
        notifySessionUpdated: notifyUpdatedFn,
        notifySessionCreated: mock.fn()
    } as unknown as SessionNotifyService;

    return { db, s3, loki, notify, rawFindUnsafeFn, persistFn, putEventsFn, putChatFn, pushLogsFn, notifyUpdatedFn };
}

describe('LiveBufferPersistence', () => {
    describe('persistEvents — atomic chunk indexing', () => {
        it('uses atomic UPDATE...RETURNING for chunk index', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistEvents('sess-1', [{ type: 3, data: {} }]);

            assert.equal(m.rawFindUnsafeFn.mock.callCount(), 1);
            const sql = m.rawFindUnsafeFn.mock.calls[0].arguments[0] as string;
            assert.ok(sql.includes('UPDATE'), 'Should use UPDATE');
            assert.ok(sql.includes('RETURNING'), 'Should use RETURNING');
            assert.ok(sql.includes('"eventChunkCount" = "eventChunkCount" + 1'), 'Should increment atomically');
            assert.ok(sql.includes('"eventBytesStored" = "eventBytesStored" +'), 'Should track stored event bytes');
        });

        it('stores events to S3 with returned chunk index', async () => {
            const m = createMocks(makeSession({ eventChunkCount: 5 }));
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistEvents('sess-1', [{ type: 3 }]);

            assert.equal(m.putEventsFn.mock.callCount(), 1);
            const args = m.putEventsFn.mock.calls[0].arguments;
            assert.equal(args[0], 'app-1');
            assert.equal(args[1], 'sess-1');
            assert.equal(args[2], 5); // chunk index from RETURNING
        });

        it('notifies session updated after persisting events', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistEvents('sess-1', [{ type: 3 }]);

            assert.equal(m.notifyUpdatedFn.mock.callCount(), 1);
        });

        it('no-ops when session not found (rawFindUnsafe returns empty)', async () => {
            const m = createMocks();
            m.rawFindUnsafeFn.mock.mockImplementation(async () => []);
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistEvents('sess-1', [{ type: 3 }]);

            assert.equal(m.putEventsFn.mock.callCount(), 0);
        });
    });

    describe('persistLogs', () => {
        it('decorates logs with session metadata', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistLogs('sess-1', [{ t: 1000, v: 1, c: 'test', m: 'hello' }]);

            assert.equal(m.pushLogsFn.mock.callCount(), 1);
            const decorated = m.pushLogsFn.mock.calls[0].arguments[0] as Record<string, unknown>[];
            assert.equal(decorated[0].appId, 'app-1');
            assert.equal(decorated[0].deviceId, 'dev-1');
            assert.equal(decorated[0].sessionId, 'sess-1');
        });

        it('no-ops for empty logs', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistLogs('sess-1', []);

            assert.equal(m.pushLogsFn.mock.callCount(), 0);
        });
    });

    describe('persistChat', () => {
        it('persists chat messages to S3', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistChat('sess-1', [
                { message: 'hello', from: 'user', timestamp: Date.now() }
            ], false);

            assert.equal(m.putChatFn.mock.callCount(), 1);
        });

        it('sets hasChatMessages flag when markHasChat is true', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistChat('sess-1', [
                { message: 'hello', from: 'user', timestamp: Date.now() }
            ], true);

            assert.equal(m.persistFn.mock.callCount(), 1);
            assert.equal(m.notifyUpdatedFn.mock.callCount(), 1);
        });

        it('does not set flag when markHasChat is false', async () => {
            const m = createMocks();
            const persistence = new LiveBufferPersistence(makeLogger(), m.s3, m.db, m.loki, m.notify);

            await persistence.persistChat('sess-1', [
                { message: 'hello', from: 'user', timestamp: Date.now() }
            ], false);

            assert.equal(m.persistFn.mock.callCount(), 0);
        });
    });
});
