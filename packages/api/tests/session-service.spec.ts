import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { SessionService } from '../src/services/session.service';
import { SessionEntity } from '../src/database/entities/session.entity';
import type { UxrrDatabase } from '../src/database/database';

function makeSessionEntity(overrides: Partial<SessionEntity> = {}): SessionEntity {
    const now = new Date();
    return {
        id: 'sess-1',
        appId: 'app-1',
        deviceId: 'dev-1',
        userId: 'user-1',
        startedAt: now,
        lastActivityAt: now,
        eventChunkCount: 3,
        createdAt: now,
        updatedAt: now,
        hasChatMessages: false
    } as SessionEntity;
}

function createMocks(
    opts: {
        sessions?: SessionEntity[];
        rawFindResult?: unknown[];
        notFound?: boolean;
    } = {}
) {
    const sessions = opts.sessions ?? [makeSessionEntity()];

    const findFn = mock.fn(async () => sessions);
    const findOneOrUndefinedFn = mock.fn(async () => (opts.notFound ? undefined : sessions[0]));
    const deleteOneFn = mock.fn(async () => {});
    const deleteManyFn = mock.fn(async () => {});
    const limitFn = mock.fn((_n: number) => queryObj);
    const skipFn = mock.fn((_n: number) => queryObj);
    const sortFn = mock.fn((_s: unknown) => queryObj);
    const filterFn = mock.fn((_f: unknown) => queryObj);

    const queryObj: Record<string, unknown> = {
        filter: filterFn,
        findOneOrUndefined: findOneOrUndefinedFn,
        find: findFn,
        sort: sortFn,
        skip: skipFn,
        limit: limitFn,
        deleteOne: deleteOneFn,
        deleteMany: deleteManyFn
    };

    const rawFindUnsafeFn = mock.fn(async (_sql: string, _params?: unknown[]) => opts.rawFindResult ?? []);

    const db = {
        query: mock.fn((_entity: unknown) => queryObj),
        rawFindUnsafe: rawFindUnsafeFn
    } as unknown as UxrrDatabase;

    return {
        db,
        findFn,
        findOneOrUndefinedFn,
        filterFn,
        limitFn,
        skipFn,
        sortFn,
        deleteOneFn,
        deleteManyFn,
        rawFindUnsafeFn
    };
}

describe('SessionService', () => {
    describe('getOrThrow', () => {
        it('returns session when found', async () => {
            const session = makeSessionEntity();
            const { db } = createMocks({ sessions: [session] });
            const svc = new SessionService(db);

            const result = await svc.getOrThrow('sess-1');
            assert.equal(result.id, 'sess-1');
        });

        it('throws HttpNotFoundError when session not found', async () => {
            const { db } = createMocks({ notFound: true });
            const svc = new SessionService(db);

            await assert.rejects(
                () => svc.getOrThrow('nonexistent'),
                (err: unknown) => {
                    assert.match((err as Error).message, /not found/);
                    return true;
                }
            );
        });
    });

    describe('list', () => {
        it('returns sessions with default limit of 50', async () => {
            const { db, limitFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({});
            assert.equal(limitFn.mock.callCount(), 1);
            assert.equal(limitFn.mock.calls[0].arguments[0], 50);
        });

        it('caps limit at 200', async () => {
            const { db, limitFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({ limit: 999 });
            assert.equal(limitFn.mock.calls[0].arguments[0], 200);
        });

        it('applies appId filter', async () => {
            const { db, filterFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({ appId: 'app-1' });
            const calls = filterFn.mock.calls;
            const appIdCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.appId === 'app-1';
            });
            assert.ok(appIdCall, 'Should filter by appId');
        });

        it('applies deviceId filter', async () => {
            const { db, filterFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({ deviceId: 'dev-1' });
            const calls = filterFn.mock.calls;
            const devIdCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.deviceId === 'dev-1';
            });
            assert.ok(devIdCall, 'Should filter by deviceId');
        });

        it('applies hasChat filter', async () => {
            const { db, filterFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({ hasChat: true });
            const calls = filterFn.mock.calls;
            const chatCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.hasChatMessages === true;
            });
            assert.ok(chatCall, 'Should filter by hasChatMessages');
        });

        it('applies offset when provided', async () => {
            const { db, skipFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({ offset: 10 });
            assert.equal(skipFn.mock.callCount(), 1);
            assert.equal(skipFn.mock.calls[0].arguments[0], 10);
        });

        it('sorts by startedAt desc', async () => {
            const { db, sortFn } = createMocks();
            const svc = new SessionService(db);

            await svc.list({});
            assert.equal(sortFn.mock.callCount(), 1);
            assert.deepEqual(sortFn.mock.calls[0].arguments[0], { startedAt: 'desc' });
        });
    });

    describe('deleteSession', () => {
        it('deletes session and associated user IDs', async () => {
            const { db, deleteOneFn, deleteManyFn } = createMocks();
            const svc = new SessionService(db);

            await svc.deleteSession('sess-1');
            assert.equal(deleteManyFn.mock.callCount(), 1);
            assert.equal(deleteOneFn.mock.callCount(), 1);
        });

        it('throws when session not found', async () => {
            const { db } = createMocks({ notFound: true });
            const svc = new SessionService(db);

            await assert.rejects(
                () => svc.deleteSession('nonexistent'),
                (err: unknown) => {
                    assert.match((err as Error).message, /not found/);
                    return true;
                }
            );
        });
    });

    describe('loadAllUserIds', () => {
        it('returns empty map for empty session IDs', async () => {
            const { db } = createMocks();
            const svc = new SessionService(db);

            const result = await svc.loadAllUserIds([]);
            assert.equal(result.size, 0);
        });

        it('maps session IDs to user IDs', async () => {
            const { db } = createMocks({
                rawFindResult: [
                    { sessionId: 'sess-1', userId: 'u1' },
                    { sessionId: 'sess-1', userId: 'u2' },
                    { sessionId: 'sess-2', userId: 'u3' }
                ]
            });
            const svc = new SessionService(db);

            const result = await svc.loadAllUserIds(['sess-1', 'sess-2']);
            assert.deepEqual(result.get('sess-1'), ['u1', 'u2']);
            assert.deepEqual(result.get('sess-2'), ['u3']);
        });
    });

    describe('distinctAppIds', () => {
        it('returns distinct app IDs', async () => {
            const { db } = createMocks({
                rawFindResult: [{ appId: 'app-1' }, { appId: 'app-2' }]
            });
            const svc = new SessionService(db);

            const result = await svc.distinctAppIds();
            assert.deepEqual(result, ['app-1', 'app-2']);
        });

        it('passes prefix filter to SQL', async () => {
            const { db, rawFindUnsafeFn } = createMocks({ rawFindResult: [] });
            const svc = new SessionService(db);

            await svc.distinctAppIds('my-app');
            const sql = rawFindUnsafeFn.mock.calls[0].arguments[0] as string;
            assert.ok(sql.includes('ILIKE'), 'Should use ILIKE for prefix');
            const params = rawFindUnsafeFn.mock.calls[0].arguments[1] as unknown[];
            assert.equal(params[0], 'my-app%');
        });
    });
});
