import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

import { LiveSessionService } from '../src/services/live-session.service';
import type { RedisService } from '../src/services/redis.service';
import type { PodPresenceService } from '../src/services/pod-presence.service';
import type { SessionNotifyService } from '../src/services/session-notify.service';
import type { S3Service } from '../src/services/s3.service';
import type { LokiService } from '../src/services/loki.service';
import type { UxrrDatabase } from '../src/database/database';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return {
        warn: mock.fn(),
        error: mock.fn(),
        info: mock.fn(),
        debug: mock.fn()
    } as unknown as Logger;
}

function makeWs(): {
    ws: WebSocket;
    sent: string[];
    terminateFn: ReturnType<typeof mock.fn>;
} {
    const sent: string[] = [];
    const ws = new EventEmitter();
    const sendFn = mock.fn((data: string) => sent.push(data));
    const terminateFn = mock.fn(() => {});
    (ws as unknown as Record<string, unknown>).readyState = 1;
    (ws as unknown as Record<string, unknown>).send = sendFn;
    (ws as unknown as Record<string, unknown>).ping = mock.fn();
    (ws as unknown as Record<string, unknown>).terminate = terminateFn;
    return { ws: ws as unknown as WebSocket, sent, terminateFn };
}

function createService(): LiveSessionService {
    const redis = {
        subscribe: mock.fn(async () => {}),
        unsubscribe: mock.fn(async () => {}),
        publish: mock.fn(() => {})
    } as unknown as RedisService;

    const presence = {
        podId: 'pod-1',
        hasRemoteInterest: mock.fn((_sessionId: string) => false),
        hasAnyInterest: mock.fn((_sessionId: string) => false),
        register: mock.fn(),
        deregister: mock.fn()
    } as unknown as PodPresenceService;

    const notify = {
        notifySessionUpdated: mock.fn()
    } as unknown as SessionNotifyService;

    const db = {
        query: mock.fn(() => ({
            filter: () => ({
                findOneOrUndefined: async () => undefined,
                findOne: async () => undefined,
                find: async () => []
            })
        })),
        rawFindUnsafe: mock.fn(async () => []),
        persist: mock.fn(async () => {})
    } as unknown as UxrrDatabase;

    const s3 = {
        putEventsCompressed: mock.fn(async () => {}),
        putChat: mock.fn(async () => {})
    } as unknown as S3Service;

    const loki = {
        pushLogs: mock.fn(async () => {})
    } as unknown as LokiService;

    return new LiveSessionService(makeLogger() as any, s3, db, notify, loki, redis, presence);
}

describe('LiveSessionService reconnect handling', () => {
    it('keeps the newest client socket when an older socket closes late', async () => {
        const svc = createService();
        const { ws: clientWs1, terminateFn: terminateClient1 } = makeWs();
        const { ws: clientWs2, sent: client2Sent } = makeWs();
        const { ws: agentWs } = makeWs();

        await svc.connectClient('sess-1', 'app-1', clientWs1);
        await svc.connectAgent('sess-1', agentWs, 'agent@test.com');
        await svc.connectClient('sess-1', 'app-1', clientWs2);

        // Replacing client connection should terminate the previous socket.
        assert.equal(terminateClient1.mock.callCount(), 1);

        // Simulate old socket close arriving after the new socket already connected.
        (clientWs1 as unknown as EventEmitter).emit('close');

        // Controller asks for a fresh snapshot; it should go to the new socket.
        (agentWs as unknown as EventEmitter).emit('message', Buffer.from(JSON.stringify({ type: 'request_snapshot' })));

        const sawRequestSnapshotOnNewClient = client2Sent.some(raw => JSON.parse(raw).type === 'request_snapshot');
        assert.equal(sawRequestSnapshotOnNewClient, true);

        const conn = ((svc as unknown as { sessions: Map<string, { clientWs?: WebSocket }> }).sessions.get('sess-1'));
        assert.equal(conn?.clientWs, clientWs2);

        // Cleanup timers/listeners.
        (agentWs as unknown as EventEmitter).emit('close');
        (clientWs2 as unknown as EventEmitter).emit('close');
    });
});
