import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

import type { UxrrDatabase } from '../src/database/database';

import { SessionEntity } from '../src/database/entities/session.entity';
import { SessionService } from '../src/services/session.service';

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
        hasChatMessages: false,
        ...overrides
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

    const appResolver = {
        resolveAppUuid: mock.fn((s: string) => s),
        resolveAppKey: mock.fn((s: string) => s)
    } as any;

    return {
        db,
        appResolver,
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
            const { db, appResolver } = createMocks({ sessions: [session] });
            const svc = new SessionService(db, appResolver);

            const result = await svc.getOrThrow('sess-1');
            assert.equal(result.id, 'sess-1');
        });

        it('throws HttpNotFoundError when session not found', async () => {
            const { db, appResolver } = createMocks({ notFound: true });
            const svc = new SessionService(db, appResolver);

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
            const { db, appResolver, limitFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({});
            assert.equal(limitFn.mock.callCount(), 1);
            assert.equal(limitFn.mock.calls[0].arguments[0], 50);
        });

        it('caps limit at 200', async () => {
            const { db, appResolver, limitFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({ limit: 999 });
            assert.equal(limitFn.mock.calls[0].arguments[0], 200);
        });

        it('applies appKey filter', async () => {
            const { db, appResolver, filterFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({ appKey: 'app-1' });
            const calls = filterFn.mock.calls;
            const appIdCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.appId === 'app-1';
            });
            assert.ok(appIdCall, 'Should filter by appKey');
        });

        it('applies deviceId filter', async () => {
            const { db, appResolver, filterFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({ deviceId: 'dev-1' });
            const calls = filterFn.mock.calls;
            const devIdCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.deviceId === 'dev-1';
            });
            assert.ok(devIdCall, 'Should filter by deviceId');
        });

        it('applies hasChat filter', async () => {
            const { db, appResolver, filterFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({ hasChat: true });
            const calls = filterFn.mock.calls;
            const chatCall = calls.find((c: { arguments: unknown[] }) => {
                const arg = c.arguments[0] as Record<string, unknown> | undefined;
                return arg && arg.hasChatMessages === true;
            });
            assert.ok(chatCall, 'Should filter by hasChatMessages');
        });

        it('applies offset when provided', async () => {
            const { db, appResolver, skipFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({ offset: 10 });
            assert.equal(skipFn.mock.callCount(), 1);
            assert.equal(skipFn.mock.calls[0].arguments[0], 10);
        });

        it('sorts by startedAt desc', async () => {
            const { db, appResolver, sortFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.list({});
            assert.equal(sortFn.mock.callCount(), 1);
            assert.deepEqual(sortFn.mock.calls[0].arguments[0], { startedAt: 'desc' });
        });
    });

    describe('deleteSession', () => {
        it('deletes session and associated user IDs', async () => {
            const { db, appResolver, deleteOneFn, deleteManyFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.deleteSession('sess-1');
            assert.equal(deleteManyFn.mock.callCount(), 1);
            assert.equal(deleteOneFn.mock.callCount(), 1);
        });

        it('throws when session not found', async () => {
            const { db, appResolver } = createMocks({ notFound: true });
            const svc = new SessionService(db, appResolver);

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
            const { db, appResolver } = createMocks();
            const svc = new SessionService(db, appResolver);

            const result = await svc.loadAllUserIds([]);
            assert.equal(result.size, 0);
        });

        it('maps session IDs to user IDs', async () => {
            const { db, appResolver } = createMocks({
                rawFindResult: [
                    { sessionId: 'sess-1', userId: 'u1' },
                    { sessionId: 'sess-1', userId: 'u2' },
                    { sessionId: 'sess-2', userId: 'u3' }
                ]
            });
            const svc = new SessionService(db, appResolver);

            const result = await svc.loadAllUserIds(['sess-1', 'sess-2']);
            assert.deepEqual(result.get('sess-1'), ['u1', 'u2']);
            assert.deepEqual(result.get('sess-2'), ['u3']);
        });
    });

    describe('distinctAppKeys', () => {
        it('returns distinct app keys', async () => {
            const { db, appResolver } = createMocks({
                rawFindResult: [{ appId: 'app-1' }, { appId: 'app-2' }]
            });
            const svc = new SessionService(db, appResolver);

            const result = await svc.distinctAppKeys();
            assert.deepEqual(result, ['app-1', 'app-2']);
        });

        it('filters by prefix in JavaScript after resolving keys', async () => {
            const { db, appResolver } = createMocks({
                rawFindResult: [{ appId: 'uuid-my-app' }, { appId: 'uuid-other-app' }, { appId: 'uuid-my-thing' }]
            });
            (appResolver.resolveAppKey as any).mock.mockImplementation((uuid: string) => {
                if (uuid === 'uuid-my-app') return 'my-app';
                if (uuid === 'uuid-other-app') return 'other-app';
                if (uuid === 'uuid-my-thing') return 'my-thing';
                return uuid;
            });
            const svc = new SessionService(db, appResolver);

            const result = await svc.distinctAppKeys('my');
            assert.deepEqual(result, ['my-app', 'my-thing']);
        });

        it('applies the active user, device, and chat filters', async () => {
            const { db, appResolver, rawFindUnsafeFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.distinctAppKeys(undefined, { userId: 'user-1', deviceId: 'dev-1', hasChat: true });

            const [sql, params] = rawFindUnsafeFn.mock.calls[0].arguments;
            assert.match(sql as string, /EXISTS .*session_user_ids/);
            assert.match(sql as string, /"deviceId" = \?/);
            assert.match(sql as string, /"hasChatMessages" = \?/);
            assert.deepEqual(params, ['user-1', 'dev-1', true]);
        });
    });

    describe('distinctDeviceIds', () => {
        it('applies the active app and user filters', async () => {
            const { db, appResolver, rawFindUnsafeFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.distinctDeviceIds('dev', { appKey: 'app-1', userId: 'user-1' });

            const [sql, params] = rawFindUnsafeFn.mock.calls[0].arguments;
            assert.match(sql as string, /"appId" = \?/);
            assert.match(sql as string, /EXISTS .*session_user_ids/);
            assert.match(sql as string, /"deviceId" ILIKE \?/);
            assert.deepEqual(params, ['app-1', 'user-1', 'dev%']);
        });
    });

    describe('distinctUsers', () => {
        it('applies the active app, device, and date filters', async () => {
            const { db, appResolver, rawFindUnsafeFn } = createMocks();
            const svc = new SessionService(db, appResolver);

            await svc.distinctUsers(undefined, {
                appKey: 'app-1',
                deviceId: 'dev-1',
                from: '2026-07-01T00:00:00.000Z',
                to: '2026-07-18T00:00:00.000Z'
            });

            const [sql, params] = rawFindUnsafeFn.mock.calls[0].arguments;
            assert.match(sql as string, /"appId" = \?/);
            assert.match(sql as string, /"deviceId" = \?/);
            assert.match(sql as string, /"lastActivityAt" >= \?/);
            assert.match(sql as string, /"startedAt" <= \?/);
            assert.equal(params?.[0], 'app-1');
            assert.equal(params?.[1], 'dev-1');
            assert.deepEqual(params?.slice(2), [new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-18T00:00:00.000Z')]);
        });
    });
});
