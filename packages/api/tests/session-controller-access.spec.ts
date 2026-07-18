import type { HttpRequest } from '@zyno-io/ts-server-foundation';

import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

import type { LokiService } from '../src/services/loki.service';
import type { RetentionService } from '../src/services/retention.service';
import type { S3Service } from '../src/services/s3.service';
import type { SessionService } from '../src/services/session.service';
import type { ShareService } from '../src/services/share.service';

// Test the access control logic by importing the controller and calling methods with mock auth context.
// SessionController uses Deepkit decorators, so we construct it directly with mock services.
import { SessionController } from '../src/controllers/session.controller';
import { AUTH_CONTEXT_KEY, type AuthContext } from '../src/middleware/session-auth.middleware';

function makeRequest(auth: AuthContext): HttpRequest {
    return { [AUTH_CONTEXT_KEY]: auth } as unknown as HttpRequest;
}

function makeSession(appId = 'app-1') {
    const now = new Date();
    return {
        id: 'sess-1',
        appId,
        deviceId: 'dev-1',
        userId: 'u-1',
        startedAt: now,
        lastActivityAt: now,
        eventChunkCount: 3,
        createdAt: now,
        updatedAt: now,
        hasChatMessages: false
    };
}

function createMocks() {
    const getOrThrowFn = mock.fn(async (_id: string) => makeSession());
    const loadAllUserIdsFn = mock.fn(async (_ids: string[]) => new Map([['sess-1', ['u-1']]]));
    const listFn = mock.fn(async (_filters: unknown) => [makeSession()]);

    const distinctAppKeysFn = mock.fn(async () => ['app-1']);
    const distinctDeviceIdsFn = mock.fn(async () => ['dev-1']);
    const distinctUsersFn = mock.fn(async () => []);
    const sessionSvc = {
        getOrThrow: getOrThrowFn,
        loadAllUserIds: loadAllUserIdsFn,
        list: listFn,
        distinctAppKeys: distinctAppKeysFn,
        distinctDeviceIds: distinctDeviceIdsFn,
        distinctUsers: distinctUsersFn
    } as unknown as SessionService;

    const s3Svc = {
        getEvents: mock.fn(async () => []),
        getChat: mock.fn(async () => [])
    } as unknown as S3Service;

    const lokiSvc = {
        queryLogs: mock.fn(async () => [])
    } as unknown as LokiService;

    const shareSvc = {
        createShareLink: mock.fn(async () => ({ token: 't', expiresAt: new Date(), id: 'link-1' })),
        revokeActiveLink: mock.fn(async () => true),
        getActiveLink: mock.fn(async () => null)
    } as unknown as ShareService;

    const retentionSvc = {
        deleteSessionData: mock.fn(async () => {})
    } as unknown as RetentionService;

    const appResolver = {
        resolveAppKey: mock.fn((uuid: string) => uuid)
    } as any;

    const controller = new SessionController(sessionSvc, s3Svc, lokiSvc, shareSvc, retentionSvc, appResolver);
    return { controller, getOrThrowFn, distinctAppKeysFn, distinctDeviceIdsFn, distinctUsersFn };
}

describe('SessionController — access control', () => {
    describe('getSession enforceAccess', () => {
        it('allows access when auth has no appKeys restriction', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'oidc', scope: 'admin' });

            const result = await controller.getSession(request, 'sess-1');
            assert.equal(result.id, 'sess-1');
        });

        it('allows access when session appId is in auth appKeys', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'interactive', appKeys: ['app-1', 'app-2'] });

            const result = await controller.getSession(request, 'sess-1');
            assert.equal(result.id, 'sess-1');
        });

        it('denies access when session appId is not in auth appKeys', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'interactive', appKeys: ['app-other'] });

            await assert.rejects(
                () => controller.getSession(request, 'sess-1'),
                (err: unknown) => (err as Error).message.includes('Access denied')
            );
        });

        it('denies access when sessionId does not match auth sessionId', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'embed-token', scope: 'readonly', sessionId: 'other-sess' });

            await assert.rejects(
                () => controller.getSession(request, 'sess-1'),
                (err: unknown) => (err as Error).message.includes('Access denied')
            );
        });

        it('allows access when sessionId matches', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'embed-token', scope: 'readonly', sessionId: 'sess-1' });

            const result = await controller.getSession(request, 'sess-1');
            assert.equal(result.id, 'sess-1');
        });
    });

    describe('admin-only endpoints', () => {
        it('createShareLink requires admin scope', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'readonly' });

            await assert.rejects(
                () => controller.createShareLink(request, 'sess-1'),
                (err: unknown) => (err as Error).message.includes('Admin access required')
            );
        });

        it('createShareLink allows admin', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'oidc', scope: 'admin' });

            const result = await controller.createShareLink(request, 'sess-1');
            assert.ok(result.token);
        });

        it('deleteSession requires admin scope', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'interactive' });

            await assert.rejects(
                () => controller.deleteSession(request, 'sess-1'),
                (err: unknown) => (err as Error).message.includes('Admin access required')
            );
        });

        it('revokeShareLink requires admin scope', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'embed-token', scope: 'readonly' });

            await assert.rejects(
                () => controller.revokeShareLink(request, 'sess-1'),
                (err: unknown) => (err as Error).message.includes('Admin access required')
            );
        });
    });

    describe('listSessions appKey enforcement', () => {
        it('denies access when queried appKey not in allowed appKeys', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'readonly', appKeys: ['app-1'] });

            await assert.rejects(
                () => controller.listSessions(request, { appKey: 'app-other' }),
                (err: unknown) => (err as Error).message.includes('Access denied')
            );
        });

        it('allows when queried appKey is in allowed appKeys', async () => {
            const { controller } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'readonly', appKeys: ['app-1'] });

            const result = await controller.listSessions(request, { appKey: 'app-1' });
            assert.ok(Array.isArray(result));
        });
    });

    describe('autocomplete filters', () => {
        it('passes other active filters and auth app restrictions to each facet', async () => {
            const { controller, distinctAppKeysFn, distinctDeviceIdsFn, distinctUsersFn } = createMocks();
            const request = makeRequest({ type: 'api-key', scope: 'readonly', appKeys: ['allowed-app'] });

            await controller.autocompleteAppKeys(request, {
                q: 'app',
                appKey: 'ignored-self',
                userId: 'user-1',
                deviceId: 'device-1',
                hasChat: true
            });
            await controller.autocompleteDeviceIds(request, {
                q: 'dev',
                appKey: 'app-1',
                userId: 'user-1',
                deviceId: 'ignored-self'
            });
            await controller.autocompleteUsers(request, {
                q: 'ali',
                appKey: 'app-1',
                userId: 'ignored-self',
                deviceId: 'device-1'
            });

            assert.deepEqual(distinctAppKeysFn.mock.calls[0].arguments, [
                'app',
                { userId: 'user-1', deviceId: 'device-1', hasChat: true, appKeys: ['allowed-app'] }
            ]);
            assert.deepEqual(distinctDeviceIdsFn.mock.calls[0].arguments, ['dev', { appKey: 'app-1', userId: 'user-1', appKeys: ['allowed-app'] }]);
            assert.deepEqual(distinctUsersFn.mock.calls[0].arguments, ['ali', { appKey: 'app-1', deviceId: 'device-1', appKeys: ['allowed-app'] }]);
        });
    });
});
