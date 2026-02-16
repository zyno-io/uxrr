import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { WebSocketService } from '../src/services/websocket.service';
import type { UxrrConfig } from '../src/config';
import { signWsToken } from '../src/util/ws-token';
import type { AppResolverService } from '../src/services/app-resolver.service';
import type { OidcService } from '../src/services/oidc.service';
import type { ApiKeyService } from '../src/services/api-key.service';
import type { SessionService } from '../src/services/session.service';
import type { ShareService } from '../src/services/share.service';
import type { LiveSessionService } from '../src/services/live-session.service';
import type { SessionNotifyService } from '../src/services/session-notify.service';
import type { UserService } from '../src/services/user.service';
import type { Logger } from '@deepkit/logger';

/**
 * WebSocketService constructor calls resolve(ApplicationServer) which requires
 * the full Deepkit DI container. We bypass this by using Object.create to
 * instantiate without running the constructor, then manually assign dependencies.
 */

type TestableWsSvc = Record<string, (...args: unknown[]) => Promise<void>>;

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeSocket() {
    const writeFn = mock.fn((_data: string) => {});
    const destroyFn = mock.fn(() => {});
    return { write: writeFn, destroy: destroyFn };
}

function makeWss() {
    const handleUpgradeFn = mock.fn((_req: unknown, _socket: unknown, _head: unknown, _cb: (ws: unknown) => void) => {
        _cb({ on: mock.fn(), send: mock.fn(), close: mock.fn() });
    });
    return { handleUpgrade: handleUpgradeFn };
}

function makeRequest(url: string, headers: Record<string, string> = {}): Record<string, unknown> {
    return { url, headers: { host: 'localhost:3100', ...headers } };
}

function makeUserSvc(overrides: { isAdmin?: boolean; id?: string; email?: string; name?: string } = {}): UserService {
    const user = {
        id: overrides.id ?? 'user-uuid-1',
        email: overrides.email ?? 'user@test.com',
        name: overrides.name ?? 'Test User',
        isAdmin: overrides.isAdmin ?? true,
        oidcSub: 'oidc-sub-1',
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
    };

    return {
        upsertFromOidc: mock.fn(async () => user),
        getById: mock.fn(async (id: string) => (id === user.id ? user : undefined))
    } as unknown as UserService;
}

function createService(
    overrides: {
        config?: Partial<UxrrConfig>;
        oidcEnabled?: boolean;
        devModeAllowed?: boolean;
        resolveByOrigin?: (origin: string) => Promise<string | undefined>;
        resolveByApiKey?: (key: string) => Promise<string | undefined>;
        validateOidcToken?: (token: string) => Promise<unknown>;
        verifyEmbedToken?: (token: string) => Promise<unknown>;
        getOrThrow?: (id: string) => Promise<unknown>;
        validateShareAccess?: (token: string) => Promise<string>;
        userSvcOverrides?: { isAdmin?: boolean; id?: string; email?: string; name?: string };
    } = {}
) {
    const connectClientFn = mock.fn((_sessId: string, _appId: string, _ws: unknown) => {});
    const connectAgentFn = mock.fn(
        (_sessId: string, _ws: unknown, _email?: string, _name?: string, _userId?: string) => {}
    );
    const connectSharedViewerFn = mock.fn((_sessId: string, _ws: unknown) => {});
    const addWatcherFn = mock.fn((_ws: unknown, _filters: unknown, _allowedAppIds?: string[]) => {});

    const svc = Object.create(WebSocketService.prototype) as Record<string, unknown>;
    svc.config = (overrides.config ?? {}) as UxrrConfig;
    svc.logger = makeLogger();
    svc.devModeAllowed = overrides.devModeAllowed ?? false;
    svc.appResolver = {
        resolveByOrigin: mock.fn(overrides.resolveByOrigin ?? (async () => undefined)),
        resolveByApiKey: mock.fn(overrides.resolveByApiKey ?? (async () => undefined))
    } as unknown as AppResolverService;
    svc.oidcSvc = {
        isEnabled: overrides.oidcEnabled ?? false,
        validateToken: mock.fn(
            overrides.validateOidcToken ??
                (async () => {
                    throw new Error('invalid');
                })
        )
    } as unknown as OidcService;
    svc.apiKeySvc = {
        verifyEmbedToken: mock.fn(
            overrides.verifyEmbedToken ??
                (async () => {
                    throw new Error('invalid');
                })
        )
    } as unknown as ApiKeyService;
    svc.sessionSvc = {
        getOrThrow: mock.fn(overrides.getOrThrow ?? (async () => ({ id: 'sess-1', appId: 'app-1' })))
    } as unknown as SessionService;
    svc.shareSvc = {
        validateShareAccess: mock.fn(overrides.validateShareAccess ?? (async () => 'sess-1'))
    } as unknown as ShareService;
    svc.userSvc = makeUserSvc(overrides.userSvcOverrides ?? {});
    svc.liveSvc = {
        connectClient: connectClientFn,
        connectAgent: connectAgentFn,
        connectSharedViewer: connectSharedViewerFn
    } as unknown as LiveSessionService;
    svc.notifySvc = {
        addWatcher: addWatcherFn,
        startStaleChecker: mock.fn()
    } as unknown as SessionNotifyService;

    return { svc, connectClientFn, connectAgentFn, connectSharedViewerFn, addWatcherFn };
}

describe('WebSocket auth — handleClientUpgrade', () => {
    it('rejects when no origin or API key provided', async () => {
        const { svc } = createService();
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/app-1/ws'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
        assert.equal(socket.destroy.mock.callCount(), 1);
    });

    it('rejects when origin is unknown', async () => {
        const { svc } = createService({
            resolveByOrigin: async () => undefined
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/app-1/ws', { origin: 'https://unknown.com' }),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });

    it('accepts valid origin and connects client', async () => {
        const { svc, connectClientFn } = createService({
            resolveByOrigin: async () => 'app-1'
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/app-1/ws', { origin: 'https://example.com' }),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(wss.handleUpgrade.mock.callCount(), 1);
        assert.equal(connectClientFn.mock.callCount(), 1);
        assert.equal(connectClientFn.mock.calls[0].arguments[0], 'sess-1');
        assert.equal(connectClientFn.mock.calls[0].arguments[1], 'app-1');
    });

    it('accepts valid API key', async () => {
        const { svc, connectClientFn } = createService({
            resolveByApiKey: async () => 'app-2',
            getOrThrow: async () => ({ id: 'sess-1', appId: 'app-2' })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/app-2/ws', { 'x-api-key': 'valid-key' }),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectClientFn.mock.callCount(), 1);
        assert.equal(connectClientFn.mock.calls[0].arguments[1], 'app-2');
    });

    it('rejects when session appId mismatches resolved appId', async () => {
        const { svc } = createService({
            resolveByOrigin: async () => 'app-DIFFERENT',
            getOrThrow: async () => ({ id: 'sess-1', appId: 'app-1' })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/app-1/ws', { origin: 'https://evil.com' }),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });
});

describe('WebSocket auth — handleAgentUpgrade', () => {
    it('rejects when no OIDC token and no embed token in non-dev mode', async () => {
        const { svc } = createService({ oidcEnabled: true });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('401'));
    });

    it('accepts valid ws_token with admin scope', async () => {
        const secret = 'test-secret-that-is-long-enough-32ch';
        const wsToken = signWsToken(secret, {
            exp: Math.floor(Date.now() / 1000) + 10,
            scope: 'admin',
            userId: 'user-uuid-42'
        });
        const { svc, connectAgentFn } = createService({
            config: { UXRR_SHARE_SECRET: secret } as Partial<UxrrConfig>,
            userSvcOverrides: { id: 'user-uuid-42', email: 'admin@test.com', name: 'Admin User' }
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest(`/v1/sessions/sess-1/live?ws_token=${encodeURIComponent(wsToken)}`),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectAgentFn.mock.callCount(), 1);
        assert.equal(connectAgentFn.mock.calls[0].arguments[2], 'admin@test.com');
        assert.equal(connectAgentFn.mock.calls[0].arguments[3], 'Admin User');
        assert.equal(connectAgentFn.mock.calls[0].arguments[4], 'user-uuid-42');
    });

    it('connects readonly ws_token user as shared viewer', async () => {
        const secret = 'test-secret-that-is-long-enough-32ch';
        const wsToken = signWsToken(secret, {
            exp: Math.floor(Date.now() / 1000) + 10,
            scope: 'readonly',
            userId: 'user-uuid-2'
        });
        const { svc, connectSharedViewerFn, connectAgentFn } = createService({
            config: { UXRR_SHARE_SECRET: secret } as Partial<UxrrConfig>
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest(`/v1/sessions/sess-1/live?ws_token=${encodeURIComponent(wsToken)}`),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectSharedViewerFn.mock.callCount(), 1);
        assert.equal(connectAgentFn.mock.callCount(), 0);
    });

    it('embed-token enforces sid claim against sessionId', async () => {
        const { svc } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ scope: 'interactive', sid: 'sess-OTHER', apps: [] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live?embed_token=tok'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });

    it('embed-token enforces apps claim against session appId', async () => {
        const { svc } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ scope: 'interactive', apps: ['app-ALLOWED'] }),
            getOrThrow: async () => ({ id: 'sess-1', appId: 'app-1' })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live?embed_token=tok'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });

    it('embed-token with matching sid and apps connects agent', async () => {
        const { svc, connectAgentFn } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ scope: 'interactive', sid: 'sess-1', apps: ['app-1'] }),
            getOrThrow: async () => ({ id: 'sess-1', appId: 'app-1' })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live?embed_token=tok'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectAgentFn.mock.callCount(), 1);
    });

    it('embed-token with readonly scope connects as shared viewer', async () => {
        const { svc, connectSharedViewerFn, connectAgentFn } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ scope: 'readonly', apps: [] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live?embed_token=tok'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectSharedViewerFn.mock.callCount(), 1);
        assert.equal(connectAgentFn.mock.callCount(), 0);
    });

    it('allows agent in dev mode without OIDC', async () => {
        const { svc, connectAgentFn } = createService({
            oidcEnabled: false,
            devModeAllowed: true
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleAgentUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/sessions/sess-1/live'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectAgentFn.mock.callCount(), 1);
    });
});

describe('WebSocket auth — handleSharedViewerUpgrade', () => {
    it('accepts valid share token and connects as shared viewer', async () => {
        const { svc, connectSharedViewerFn } = createService({
            validateShareAccess: async () => 'sess-1'
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleSharedViewerUpgrade(
            wss,
            'valid-share-token',
            makeRequest('/v1/shared/valid-share-token/live'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(connectSharedViewerFn.mock.callCount(), 1);
        assert.equal(connectSharedViewerFn.mock.calls[0].arguments[0], 'sess-1');
    });

    it('rejects revoked share token', async () => {
        const { svc } = createService({
            validateShareAccess: async () => {
                throw new Error('Share link has been revoked');
            }
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleSharedViewerUpgrade(
            wss,
            'revoked-token',
            makeRequest('/v1/shared/revoked-token/live'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
        assert.equal(socket.destroy.mock.callCount(), 1);
    });
});

describe('WebSocket auth — handleWatchUpgrade', () => {
    it('rejects unauthenticated watcher when OIDC enabled', async () => {
        const { svc } = createService({ oidcEnabled: true });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest('/v1/sessions/watch'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('401'));
    });

    it('accepts watcher with valid ws_token', async () => {
        const secret = 'test-secret-that-is-long-enough-32ch';
        const wsToken = signWsToken(secret, {
            exp: Math.floor(Date.now() / 1000) + 10,
            scope: 'admin'
        });
        const { svc, addWatcherFn } = createService({
            config: { UXRR_SHARE_SECRET: secret } as Partial<UxrrConfig>
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest(`/v1/sessions/watch?ws_token=${encodeURIComponent(wsToken)}`),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(addWatcherFn.mock.callCount(), 1);
    });

    it('embed-token watcher enforces appIds filter', async () => {
        const { svc } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ apps: ['app-ALLOWED'] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest('/v1/sessions/watch?embed_token=tok&appId=app-FORBIDDEN'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });

    it('embed-token watcher passes allowedAppIds to addWatcher', async () => {
        const { svc, addWatcherFn } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ apps: ['app-1', 'app-2'] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest('/v1/sessions/watch?embed_token=tok'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(addWatcherFn.mock.callCount(), 1);
        const allowedAppIds = addWatcherFn.mock.calls[0].arguments[2];
        assert.deepEqual(allowedAppIds, ['app-1', 'app-2']);
    });

    it('allows watcher in dev mode without OIDC', async () => {
        const { svc, addWatcherFn } = createService({
            oidcEnabled: false,
            devModeAllowed: true
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest('/v1/sessions/watch'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(addWatcherFn.mock.callCount(), 1);
    });
});
