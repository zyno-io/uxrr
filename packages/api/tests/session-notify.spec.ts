import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

import { SessionNotifyService } from '../src/services/session-notify.service';
import type { SessionEntity } from '../src/database/entities/session.entity';
import type { RedisService } from '../src/services/redis.service';
import type { PodPresenceService } from '../src/services/pod-presence.service';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeRedis(enabled = false): RedisService {
    return {
        enabled,
        subscribe: mock.fn(),
        publish: mock.fn()
    } as unknown as RedisService;
}

function makePresence(podId = 'pod-1'): PodPresenceService {
    return { podId } as unknown as PodPresenceService;
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
        eventChunkCount: 1,
        eventBytesStored: 0,
        createdAt: now,
        updatedAt: now,
        hasChatMessages: false,
        ...overrides
    } as SessionEntity;
}

function makeWs(): { ws: WebSocket; sent: string[] } {
    const sent: string[] = [];
    const ws = new EventEmitter();
    (ws as unknown as Record<string, unknown>).readyState = 1; // OPEN
    (ws as unknown as Record<string, unknown>).send = mock.fn((data: string) => sent.push(data));
    return { ws: ws as unknown as WebSocket, sent };
}

describe('SessionNotifyService — allowedAppIds enforcement', () => {
    it('sendToLocalWatchers skips watchers with non-matching allowedAppIds', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}, ['app-2']); // only allowed app-2

        const session = makeSession({ appId: 'app-1' }); // notification for app-1
        svc.notifySessionCreated(session, ['user-1']);

        assert.equal(sent.length, 0, 'Watcher should not receive notification for non-allowed app');
    });

    it('sendToLocalWatchers sends to watchers with matching allowedAppIds', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}, ['app-1']); // allowed app-1

        const session = makeSession({ appId: 'app-1' });
        svc.notifySessionCreated(session, ['user-1']);

        assert.equal(sent.length, 1);
        const msg = JSON.parse(sent[0]);
        assert.equal(msg.type, 'session_created');
        assert.equal(msg.session.appId, 'app-1');
    });

    it('sendToLocalWatchers sends to watchers with no allowedAppIds restriction', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}); // no app restriction

        const session = makeSession({ appId: 'app-1' });
        svc.notifySessionCreated(session, ['user-1']);

        assert.equal(sent.length, 1);
    });

    it('notifySessionUpdated also enforces allowedAppIds', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws: ws1, sent: sent1 } = makeWs();
        const { ws: ws2, sent: sent2 } = makeWs();
        svc.addWatcher(ws1, {}, ['app-1']);
        svc.addWatcher(ws2, {}, ['app-2']);

        const session = makeSession({ appId: 'app-1' });
        svc.notifySessionUpdated(session, ['user-1']);

        assert.equal(sent1.length, 1, 'app-1 watcher should receive update');
        assert.equal(sent2.length, 0, 'app-2 watcher should not receive update');
    });

    it('Redis notification enforces allowedAppIds on remote watchers', () => {
        let subscribeCallback: (channel: string, raw: string) => void;
        const subscribeFn = mock.fn((channel: string, cb: (channel: string, raw: string) => void) => {
            subscribeCallback = cb;
        });
        const redis = {
            enabled: true,
            subscribe: subscribeFn,
            publish: mock.fn()
        } as unknown as RedisService;

        const svc = new SessionNotifyService(makeLogger(), redis, makePresence('pod-1'));

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}, ['app-2']); // only allowed app-2

        // Simulate Redis notification from another pod about app-1
        subscribeCallback!(
            'uxrr:session:notify',
            JSON.stringify({
                sourcePod: 'pod-2', // different pod
                type: 'session_created',
                session: {
                    id: 'sess-1',
                    appId: 'app-1',
                    deviceId: 'dev-1',
                    startedAt: new Date().toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    eventChunkCount: 1,
                    eventBytesStored: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    isLive: true
                },
                allUserIds: ['user-1']
            })
        );

        assert.equal(sent.length, 0, 'Watcher should not receive Redis notification for non-allowed app');
    });

    it('stale checker enforces allowedAppIds', () => {
        mock.timers.enable({ apis: ['Date', 'setInterval'] });

        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());
        svc.startStaleChecker();

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}, ['app-2']); // only allowed app-2

        // Create a session for app-1 that will become stale
        const oldDate = new Date(Date.now() - 120_000); // 2 min ago
        const session = makeSession({ appId: 'app-1', lastActivityAt: oldDate });
        svc.notifySessionCreated(session, ['user-1']); // registers in liveSessionTimestamps
        sent.length = 0; // clear the created notification (it's for app-1, won't be sent anyway)

        // Advance past the stale threshold (60s)
        mock.timers.tick(16_000); // trigger stale check

        assert.equal(sent.length, 0, 'Watcher should not receive stale notification for non-allowed app');

        svc.stopStaleChecker();
        mock.timers.reset();
    });
});

describe('SessionNotifyService — watcher filter enforcement', () => {
    it('set_filters with disallowed appId is silently dropped', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, { appId: 'app-1' }, ['app-1']); // allowed app-1 only

        // Try to change filter to app-2 via set_filters message
        ws.emit(
            'message',
            Buffer.from(
                JSON.stringify({
                    type: 'set_filters',
                    filters: { appId: 'app-2' }
                })
            )
        );

        // Notify with app-2 session — watcher should NOT receive it
        const session = makeSession({ appId: 'app-2' });
        svc.notifySessionCreated(session, ['user-1']);

        assert.equal(sent.length, 0, 'Watcher should not receive notification after disallowed filter change');
    });

    it('set_filters auto-sets appId when only one allowed app', () => {
        const svc = new SessionNotifyService(makeLogger(), makeRedis(), makePresence());

        const { ws, sent } = makeWs();
        svc.addWatcher(ws, {}, ['app-1']); // allowed app-1 only

        // Set filters without specifying appId
        ws.emit(
            'message',
            Buffer.from(
                JSON.stringify({
                    type: 'set_filters',
                    filters: { userId: 'user-1' }
                })
            )
        );

        // Notify with app-1 + user-1 session — watcher should receive it
        const session = makeSession({ appId: 'app-1', userId: 'user-1' });
        svc.notifySessionCreated(session, ['user-1']);

        assert.equal(sent.length, 1);
    });
});
