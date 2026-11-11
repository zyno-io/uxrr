// A session-locked embed token (or ticket) with `sid` sees only that session: the list, the filter
// options and the list stream, not every session of its apps.
import type { HttpRequest, Logger } from '@zyno-io/ts-server-foundation';
import type WebSocket from 'ws';

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';

import type { UxrrDatabase } from '../src/database/database';
import type { SessionEntity } from '../src/database/entities/session.entity';
import type { PodPresenceService } from '../src/services/pod-presence.service';
import type { RedisService } from '../src/services/redis.service';

import { SessionController } from '../src/controllers/session.controller';
import { AUTH_CONTEXT_KEY, type AuthContext } from '../src/middleware/session-auth.middleware';
import { SessionNotifyService } from '../src/services/session-notify.service';
import { SessionService } from '../src/services/session.service';

const EMBED_CTX: AuthContext = { type: 'embed-token', scope: 'readonly', appKeys: ['app-1'], sessionId: 'sess-S' };

function sessionController() {
    const calls: Record<string, unknown[]> = {};
    const record = (name: string, result: unknown) =>
        mock.fn(async (...args: unknown[]) => {
            calls[name] = args;
            return result;
        });
    const sessionSvc = {
        list: record('list', []),
        loadAllUserIds: mock.fn(async () => new Map()),
        distinctAppKeys: record('distinctAppKeys', []),
        distinctDeviceIds: record('distinctDeviceIds', []),
        distinctUsers: record('distinctUsers', [])
    };
    const controller = new SessionController(
        sessionSvc as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { resolveAppKey: (id: string) => id } as never
    );
    return { controller, calls };
}

const req = (ctx: AuthContext) => ({ [AUTH_CONTEXT_KEY]: ctx }) as unknown as HttpRequest;

describe('session-locked embed token — HTTP', () => {
    it('the list and every filter-option endpoint are limited to the token’s session', async () => {
        const { controller, calls } = sessionController();
        await controller.listSessions(req(EMBED_CTX), {});
        await controller.autocompleteAppKeys(req(EMBED_CTX), {});
        await controller.autocompleteDeviceIds(req(EMBED_CTX), {});
        await controller.autocompleteUsers(req(EMBED_CTX), {});
        assert.equal((calls.list[0] as { sessionId?: string }).sessionId, 'sess-S');
        for (const name of ['distinctAppKeys', 'distinctDeviceIds', 'distinctUsers']) {
            assert.equal((calls[name][1] as { sessionId?: string }).sessionId, 'sess-S', name);
        }
    });

    it('a token without sid (and signed-in users) are not session-limited', async () => {
        const { controller, calls } = sessionController();
        await controller.listSessions(req({ ...EMBED_CTX, sessionId: undefined }), {});
        assert.equal((calls.list[0] as { sessionId?: string }).sessionId, undefined);
        await controller.autocompleteUsers(req({ type: 'oidc', scope: 'admin', userId: 'u' }), {});
        assert.equal((calls.distinctUsers[1] as { sessionId?: string }).sessionId, undefined);
    });

    function sessionService() {
        const filters: unknown[] = [];
        const queryObj: Record<string, unknown> = {};
        Object.assign(queryObj, {
            filter: mock.fn((f: unknown) => {
                filters.push(f);
                return queryObj;
            }),
            sort: () => queryObj,
            limit: () => queryObj,
            skip: () => queryObj,
            find: async () => [],
            findOneOrUndefined: async () => undefined
        });
        const raw: { sql: string; params: unknown[] }[] = [];
        const db = {
            query: () => queryObj,
            rawFindUnsafe: mock.fn(async (sql: string, params: unknown[] = []) => {
                raw.push({ sql, params });
                return sql.includes('session_user_ids') && !sql.includes('DISTINCT') ? [{ sessionId: 'sess-T' }, { sessionId: 'sess-S' }] : [];
            })
        } as unknown as UxrrDatabase;
        const svc = new SessionService(db, { resolveAppUuid: (s: string) => s, resolveAppKey: (s: string) => s } as never);
        return { svc, filters, raw };
    }

    it('SessionService.list filters by the session id, also when combined with a user filter', async () => {
        const { svc, filters } = sessionService();
        await svc.list({ sessionId: 'sess-S', userId: 'u-1' });
        assert.deepEqual(filters, [{ id: 'sess-S' }, { id: { $in: ['sess-S'] } }]);
    });

    it('SessionService autocomplete queries are restricted to the session id', async () => {
        const { svc, raw } = sessionService();
        await svc.distinctAppKeys(undefined, { sessionId: 'sess-S' });
        await svc.distinctDeviceIds(undefined, { sessionId: 'sess-S' });
        await svc.distinctUsers(undefined, { sessionId: 'sess-S' });
        assert.equal(raw.length, 3);
        for (const { sql, params } of raw) {
            assert.match(sql, /"id" = \?/);
            assert.ok(params.includes('sess-S'));
        }
    });
});

describe('session-locked embed token — list stream', () => {
    function makeWs() {
        const sent: string[] = [];
        const ws = Object.assign(new EventEmitter(), { readyState: 1, send: (d: string) => sent.push(d) });
        return { ws: ws as unknown as WebSocket, sent };
    }

    function notifySvc(redis?: RedisService) {
        return new SessionNotifyService(
            { debug: mock.fn(), error: mock.fn() } as unknown as Logger,
            redis ?? ({ enabled: false } as unknown as RedisService),
            { podId: 'pod-1' } as PodPresenceService,
            { resolveAppKey: (id: string) => id } as never
        );
    }

    function session(id: string, lastActivityAt = new Date()): SessionEntity {
        const now = new Date();
        return {
            id,
            appId: 'app-1',
            deviceId: 'd',
            startedAt: now,
            lastActivityAt,
            eventChunkCount: 1,
            eventBytesStored: 0,
            createdAt: now,
            updatedAt: now
        } as SessionEntity;
    }

    it('created/updated events for other sessions of the same app are not sent', () => {
        const svc = notifySvc();
        const locked = makeWs();
        const open = makeWs();
        svc.addWatcher(locked.ws, {}, ['app-1'], 'sess-S');
        svc.addWatcher(open.ws, {}, ['app-1']);

        svc.notifySessionCreated(session('sess-T'), []);
        svc.notifySessionUpdated(session('sess-T'), []);
        assert.equal(locked.sent.length, 0);
        assert.equal(open.sent.length, 2);

        svc.notifySessionUpdated(session('sess-S'), []);
        assert.equal(locked.sent.length, 1);
        assert.equal(JSON.parse(locked.sent[0]).session.id, 'sess-S');
    });

    it('remote (Redis) events and live-status changes for other sessions are not sent', async () => {
        let onMessage: (channel: string, raw: string) => void = () => {};
        const redis = {
            enabled: true,
            subscribe: mock.fn(async (_c: string, cb: typeof onMessage) => {
                onMessage = cb;
            }),
            unsubscribe: mock.fn(async () => {}),
            publish: mock.fn()
        } as unknown as RedisService;
        const svc = notifySvc(redis);
        await svc.onServerBootstrap();
        const locked = makeWs();
        svc.addWatcher(locked.ws, {}, ['app-1'], 'sess-S');

        const payload = (id: string) => ({
            id,
            appId: 'app-1',
            deviceId: 'd',
            startedAt: '',
            lastActivityAt: new Date().toISOString(),
            isLive: true
        });
        onMessage('c', JSON.stringify({ sourcePod: 'pod-2', type: 'session_created', session: payload('sess-T'), allUserIds: [] }));
        assert.equal(locked.sent.length, 0);
        onMessage('c', JSON.stringify({ sourcePod: 'pod-2', type: 'session_created', session: payload('sess-S'), allUserIds: [] }));
        assert.equal(locked.sent.length, 1);

        // stale (live -> not live) notices
        locked.sent.length = 0;
        (svc as unknown as { liveSessionTimestamps: Map<string, unknown> }).liveSessionTimestamps.set('sess-T', {
            lastActivityAt: Date.now() - 120_000,
            appKey: 'app-1',
            allUserIds: []
        });
        (svc as unknown as { checkStale(): void }).checkStale();
        assert.equal(locked.sent.length, 0);
        await svc.onServerShutdownRequested();
    });
});
