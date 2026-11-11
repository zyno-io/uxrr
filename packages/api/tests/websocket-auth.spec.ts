import type { Logger } from '@zyno-io/ts-server-foundation';

import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';

import type { UxrrConfig } from '../src/config';
import type { ApiKeyService } from '../src/services/api-key.service';
import type { AppResolverService } from '../src/services/app-resolver.service';
import type { LiveSessionService } from '../src/services/live-session.service';
import type { OidcService } from '../src/services/oidc.service';
import type { SessionNotifyService } from '../src/services/session-notify.service';
import type { SessionService } from '../src/services/session.service';
import type { ShareService } from '../src/services/share.service';
import type { UserService } from '../src/services/user.service';

import { WebSocketService } from '../src/services/websocket.service';
import { signEmbedWsTicket, signWsToken } from '../src/util/ws-token';

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
    const ws = Object.assign(new EventEmitter(), {
        send: mock.fn(),
        close: mock.fn()
    });
    const handleUpgradeFn = mock.fn((_req: unknown, _socket: unknown, _head: unknown, _cb: (ws: unknown) => void) => {
        _cb(ws);
    });
    return { handleUpgrade: handleUpgradeFn, ws };
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
        resolveByOrigin?: (origin: string) => Promise<{ uuid: string; appKey: string } | undefined>;
        resolveByApiKey?: (key: string) => Promise<{ uuid: string; appKey: string } | undefined>;
        validateOidcToken?: (token: string) => Promise<unknown>;
        verifyEmbedToken?: (token: string) => Promise<unknown>;
        getOrThrow?: (id: string) => Promise<unknown>;
        validateShareAccess?: (token: string) => Promise<string>;
        userSvcOverrides?: { isAdmin?: boolean; id?: string; email?: string; name?: string };
    } = {}
) {
    const logger = makeLogger();
    const connectClientFn = mock.fn((_sessId: string, _appKey: string, _ws: unknown) => {});
    const connectAgentFn = mock.fn((_sessId: string, _ws: unknown, _email?: string, _name?: string, _userId?: string) => {});
    const connectSharedViewerFn = mock.fn((_sessId: string, _ws: unknown) => {});
    const addWatcherFn = mock.fn((_ws: unknown, _filters: unknown, _allowedAppKeys?: string[], _allowedSessionId?: string) => {});

    const svc = Object.create(WebSocketService.prototype) as Record<string, unknown>;
    svc.config = (overrides.config ?? {}) as UxrrConfig;
    svc.logger = logger;
    svc.devModeAllowed = overrides.devModeAllowed ?? false;
    svc.appResolver = {
        resolveByOrigin: mock.fn(overrides.resolveByOrigin ?? (async () => undefined)),
        resolveByApiKey: mock.fn(overrides.resolveByApiKey ?? (async () => undefined)),
        resolveAppKey: mock.fn((uuid: string) => uuid)
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

    return { svc, logger, connectClientFn, connectAgentFn, connectSharedViewerFn, addWatcherFn };
}

describe('WebSocket auth — handleClientUpgrade', () => {
    it('rejects when no origin or API key provided', async () => {
        const { svc } = createService();
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(wss, 'sess-1', makeRequest('/v1/ng/app-1/ws'), socket, Buffer.alloc(0));
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
            resolveByOrigin: async () => ({ uuid: 'app-1', appKey: 'app-1' })
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

    it('contains client WebSocket errors instead of crashing the process', async () => {
        const { svc, logger } = createService({
            resolveByOrigin: async () => ({ uuid: 'app-1', appKey: 'app-1' })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleClientUpgrade(
            wss,
            'sess-1',
            makeRequest('/v1/ng/sess-1/ws', { origin: 'https://example.com' }),
            socket,
            Buffer.alloc(0)
        );

        const error = Object.assign(new RangeError('Max payload size exceeded'), {
            code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
        });
        assert.doesNotThrow(() => wss.ws.emit('error', error));

        const warnFn = logger.warn as unknown as ReturnType<typeof mock.fn>;
        assert.equal(warnFn.mock.callCount(), 1);
        assert.equal(warnFn.mock.calls[0].arguments[0], 'client WebSocket error');
        assert.deepEqual(warnFn.mock.calls[0].arguments[1], {
            sessionId: 'sess-1',
            code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
            error: 'Max payload size exceeded'
        });
    });

    it('accepts valid API key', async () => {
        const { svc, connectClientFn } = createService({
            resolveByApiKey: async () => ({ uuid: 'app-2', appKey: 'app-2' }),
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
            resolveByOrigin: async () => ({ uuid: 'app-DIFFERENT', appKey: 'app-DIFFERENT' }),
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

        await (svc as TestableWsSvc).handleAgentUpgrade(wss, 'sess-1', makeRequest('/v1/sessions/sess-1/live'), socket, Buffer.alloc(0));
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

        await (svc as TestableWsSvc).handleAgentUpgrade(wss, 'sess-1', makeRequest('/v1/sessions/sess-1/live'), socket, Buffer.alloc(0));
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

        await (svc as TestableWsSvc).handleWatchUpgrade(wss, makeRequest('/v1/sessions/watch'), socket, Buffer.alloc(0));
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

    it('embed-token watcher enforces appKeys filter', async () => {
        const { svc } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ apps: ['app-ALLOWED'] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(
            wss,
            makeRequest('/v1/sessions/watch?embed_token=tok&appKey=app-FORBIDDEN'),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(socket.write.mock.callCount(), 1);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
    });

    it('embed-token watcher passes allowedAppKeys to addWatcher', async () => {
        const { svc, addWatcherFn } = createService({
            oidcEnabled: false,
            verifyEmbedToken: async () => ({ apps: ['app-1', 'app-2'] })
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(wss, makeRequest('/v1/sessions/watch?embed_token=tok'), socket, Buffer.alloc(0));
        assert.equal(addWatcherFn.mock.callCount(), 1);
        const allowedAppKeys = addWatcherFn.mock.calls[0].arguments[2];
        assert.deepEqual(allowedAppKeys, ['app-1', 'app-2']);
    });

    it('allows watcher in dev mode without OIDC', async () => {
        const { svc, addWatcherFn } = createService({
            oidcEnabled: false,
            devModeAllowed: true
        });
        const socket = makeSocket();
        const wss = makeWss();

        await (svc as TestableWsSvc).handleWatchUpgrade(wss, makeRequest('/v1/sessions/watch'), socket, Buffer.alloc(0));
        assert.equal(addWatcherFn.mock.callCount(), 1);
    });
});

describe('WebSocket auth — embed tickets (ws_token minted from an embed token)', () => {
    const secret = 'test-secret-that-is-long-enough-32ch';
    const config = { UXRR_SHARE_SECRET: secret } as Partial<UxrrConfig>;
    const ticket = (claims: { scope: 'readonly' | 'interactive'; apps: string[]; sid?: string }, ttl = 10) =>
        encodeURIComponent(signEmbedWsTicket(secret, { exp: Math.floor(Date.now() / 1000) + ttl, ...claims }));

    async function agent(svcParts: ReturnType<typeof createService>, sessionId: string, query: string) {
        const socket = makeSocket();
        await (svcParts.svc as TestableWsSvc).handleAgentUpgrade(
            makeWss(),
            sessionId,
            makeRequest(`/v1/sessions/${sessionId}/live?${query}`),
            socket,
            Buffer.alloc(0)
        );
        return socket;
    }

    it('a readonly ticket connects as a shared viewer and cannot act as an agent', async () => {
        const parts = createService({ config, oidcEnabled: true });
        const socket = await agent(parts, 'sess-1', `ws_token=${ticket({ scope: 'readonly', apps: ['app-1'] })}`);
        assert.equal(socket.write.mock.callCount(), 0);
        assert.equal(parts.connectSharedViewerFn.mock.callCount(), 1);
        assert.equal(parts.connectAgentFn.mock.callCount(), 0);
    });

    it('an interactive ticket connects as the embed user agent, like the embed token', async () => {
        const parts = createService({ config, oidcEnabled: true });
        await agent(parts, 'sess-1', `ws_token=${ticket({ scope: 'interactive', apps: ['app-1'], sid: 'sess-1' })}`);
        assert.equal(parts.connectAgentFn.mock.callCount(), 1);
        assert.equal(parts.connectAgentFn.mock.calls[0].arguments[2], 'embed-user');
        assert.equal(parts.connectAgentFn.mock.calls[0].arguments[4], undefined);
    });

    it('a ticket scoped to session S cannot open session T', async () => {
        const parts = createService({ config, oidcEnabled: true, getOrThrow: async () => ({ id: 'sess-T', appId: 'app-1' }) });
        const socket = await agent(parts, 'sess-T', `ws_token=${ticket({ scope: 'interactive', apps: ['app-1'], sid: 'sess-S' })}`);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
        assert.equal(parts.connectAgentFn.mock.callCount(), 0);
        assert.equal(parts.connectSharedViewerFn.mock.callCount(), 0);
    });

    it('a ticket cannot open a session of another app', async () => {
        const parts = createService({ config, oidcEnabled: true, getOrThrow: async () => ({ id: 'sess-1', appId: 'app-OTHER' }) });
        const socket = await agent(parts, 'sess-1', `ws_token=${ticket({ scope: 'readonly', apps: ['app-1'] })}`);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('403'));
        assert.equal(parts.connectSharedViewerFn.mock.callCount(), 0);
    });

    it('an expired ticket is rejected', async () => {
        const parts = createService({ config, oidcEnabled: true });
        const socket = await agent(parts, 'sess-1', `ws_token=${ticket({ scope: 'interactive', apps: [] }, -1)}`);
        assert.ok((socket.write.mock.calls[0].arguments[0] as string).includes('401'));
        assert.equal(parts.connectAgentFn.mock.callCount(), 0);
    });

    it('?embed_token= is still accepted for older clients', async () => {
        const parts = createService({
            config,
            oidcEnabled: true,
            verifyEmbedToken: async () => ({ scope: 'interactive', apps: ['app-1'], sid: 'sess-1' })
        });
        await agent(parts, 'sess-1', 'embed_token=tok');
        assert.equal(parts.connectAgentFn.mock.callCount(), 1);
    });

    it('the list stream with a ticket is limited to the ticket’s apps', async () => {
        const parts = createService({ config, oidcEnabled: true });
        const socket = makeSocket();
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest(`/v1/sessions/watch?ws_token=${ticket({ scope: 'readonly', apps: ['app-1', 'app-2'], sid: 'sess-1' })}`),
            socket,
            Buffer.alloc(0)
        );
        assert.equal(parts.addWatcherFn.mock.callCount(), 1);
        assert.deepEqual(parts.addWatcherFn.mock.calls[0].arguments[2], ['app-1', 'app-2']);

        const forbidden = makeSocket();
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest(`/v1/sessions/watch?ws_token=${ticket({ scope: 'readonly', apps: ['app-1'] })}&appKey=app-FORBIDDEN`),
            forbidden,
            Buffer.alloc(0)
        );
        assert.ok((forbidden.write.mock.calls[0].arguments[0] as string).includes('403'));
        assert.equal(parts.addWatcherFn.mock.callCount(), 1);
    });

    it('a session-locked ticket or embed token only watches its own session', async () => {
        const parts = createService({
            config,
            oidcEnabled: true,
            verifyEmbedToken: async () => ({ scope: 'readonly', apps: ['app-1'], sid: 'sess-S' })
        });
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest(`/v1/sessions/watch?ws_token=${ticket({ scope: 'readonly', apps: ['app-1'], sid: 'sess-S' })}`),
            makeSocket(),
            Buffer.alloc(0)
        );
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest('/v1/sessions/watch?embed_token=tok'),
            makeSocket(),
            Buffer.alloc(0)
        );
        assert.equal(parts.addWatcherFn.mock.callCount(), 2);
        assert.equal(parts.addWatcherFn.mock.calls[0].arguments[3], 'sess-S');
        assert.equal(parts.addWatcherFn.mock.calls[1].arguments[3], 'sess-S');
    });

    it('a share-link token presented as ws_token is refused on the watch and live paths', async () => {
        // ShareService signs { sid, exp, jti } with UXRR_SHARE_SECRET in the same format as ws tokens
        const payloadB64 = Buffer.from(JSON.stringify({ sid: 'sess-1', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'link-1' })).toString(
            'base64url'
        );
        const shareToken = `${payloadB64}.${createHmac('sha256', Buffer.from(secret, 'utf-8')).update(payloadB64).digest('base64url')}`;
        const parts = createService({ config, oidcEnabled: true });

        const watchSocket = makeSocket();
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest(`/v1/sessions/watch?ws_token=${encodeURIComponent(shareToken)}`),
            watchSocket,
            Buffer.alloc(0)
        );
        assert.ok((watchSocket.write.mock.calls[0].arguments[0] as string).includes('401'));
        assert.equal(parts.addWatcherFn.mock.callCount(), 0);

        const liveSocket = await agent(parts, 'sess-OTHER', `ws_token=${encodeURIComponent(shareToken)}`);
        assert.ok((liveSocket.write.mock.calls[0].arguments[0] as string).includes('401'));
        assert.equal(parts.connectSharedViewerFn.mock.callCount(), 0);
        assert.equal(parts.connectAgentFn.mock.callCount(), 0);
    });

    it('a single-app ticket pins the list stream to its app', async () => {
        const parts = createService({ config, oidcEnabled: true });
        await (parts.svc as TestableWsSvc).handleWatchUpgrade(
            makeWss(),
            makeRequest(`/v1/sessions/watch?ws_token=${ticket({ scope: 'readonly', apps: ['app-1'] })}`),
            makeSocket(),
            Buffer.alloc(0)
        );
        assert.equal((parts.addWatcherFn.mock.calls[0].arguments[1] as { appKey?: string }).appKey, 'app-1');
    });
});
