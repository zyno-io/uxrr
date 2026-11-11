import type { HttpRequest, HttpResponse, Logger } from '@zyno-io/ts-server-foundation';

import { Crypto, HttpUnauthorizedError } from '@zyno-io/ts-server-foundation';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';

import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';
import type { ApiKeyEntity } from '../src/database/entities/api-key.entity';
import type { OidcService } from '../src/services/oidc.service';
import type { UserService } from '../src/services/user.service';

import { AuthController } from '../src/controllers/auth.controller';
import { AUTH_CONTEXT_KEY, SessionAuthMiddleware, type AuthContext } from '../src/middleware/session-auth.middleware';
import { ApiKeyService } from '../src/services/api-key.service';
import { signEmbedWsTicket, signWsToken, verifyEmbedWsTicket, verifyWsToken } from '../src/util/ws-token';

const SECRET = 'test-secret-that-is-long-enough-32ch';
const now = () => Math.floor(Date.now() / 1000);

function requestWith(ctx: AuthContext): HttpRequest {
    return { headers: {}, [AUTH_CONTEXT_KEY]: ctx } as unknown as HttpRequest;
}

function controller(secret: string | null = SECRET): AuthController {
    return new AuthController({ UXRR_SHARE_SECRET: secret ?? undefined } as UxrrConfig);
}

describe('embed WebSocket tickets — signing and verification', () => {
    it('round-trips the embed claims', () => {
        const ticket = signEmbedWsTicket(SECRET, { exp: now() + 10, scope: 'interactive', apps: ['app-1'], sid: 'sess-1' });
        const payload = verifyEmbedWsTicket(SECRET, ticket);
        assert.deepEqual({ ...payload, exp: undefined }, { typ: 'embed', exp: undefined, scope: 'interactive', apps: ['app-1'], sid: 'sess-1' });
    });

    it('rejects an expired ticket and one signed with another secret', () => {
        assert.equal(verifyEmbedWsTicket(SECRET, signEmbedWsTicket(SECRET, { exp: now() - 1, scope: 'readonly', apps: [] })), null);
        assert.equal(
            verifyEmbedWsTicket(SECRET, signEmbedWsTicket('another-secret-that-is-long-enough', { exp: now() + 10, scope: 'readonly', apps: [] })),
            null
        );
    });

    it('an embed ticket never verifies as a user ws token, and a user ws token never as an embed ticket', () => {
        const ticket = signEmbedWsTicket(SECRET, { exp: now() + 10, scope: 'readonly', apps: ['app-1'] });
        assert.equal(verifyWsToken(SECRET, ticket), null);
        const userToken = signWsToken(SECRET, { exp: now() + 10, scope: 'admin', userId: 'u-1' });
        assert.equal(verifyEmbedWsTicket(SECRET, userToken), null);
        assert.equal(verifyWsToken(SECRET, userToken)?.scope, 'admin');
    });

    it('a share token (same secret, no ws scope) is not accepted as a ws token', () => {
        // ShareService signs { sid, exp, jti } with UXRR_SHARE_SECRET in the same format
        const payloadB64 = Buffer.from(JSON.stringify({ sid: 'sess-1', exp: now() + 3600, jti: 'link-1' })).toString('base64url');
        const sig = createHmac('sha256', Buffer.from(SECRET, 'utf-8')).update(payloadB64).digest('base64url');
        assert.equal(verifyWsToken(SECRET, `${payloadB64}.${sig}`), null);
        assert.equal(verifyEmbedWsTicket(SECRET, `${payloadB64}.${sig}`), null);
    });
});

describe('POST /v1/auth/ws-token — embed tickets', () => {
    it('mints a ticket carrying exactly the verified embed claims', () => {
        const res = controller().getWsToken(
            requestWith({ type: 'embed-token', scope: 'interactive', appKeys: ['app-1', 'app-2'], sessionId: 'sess-1', expiresAt: now() + 3600 })
        );
        assert.equal(res.kind, 'embed');
        const payload = verifyEmbedWsTicket(SECRET, res.token)!;
        assert.equal(payload.scope, 'interactive');
        assert.deepEqual(payload.apps, ['app-1', 'app-2']);
        assert.equal(payload.sid, 'sess-1');
        assert.ok(payload.exp <= now() + 10, 'no longer than the ws-token TTL');
        // not usable as an unrestricted user ws token
        assert.equal(verifyWsToken(SECRET, res.token), null);
    });

    it('never outlives the embed token', () => {
        const expiresAt = now() + 3;
        const res = controller().getWsToken(requestWith({ type: 'embed-token', scope: 'readonly', expiresAt }));
        const payload = verifyEmbedWsTicket(SECRET, res.token)!;
        assert.equal(payload.exp, expiresAt);
        assert.deepEqual(payload.apps, []);
        assert.equal(payload.sid, undefined);
        assert.equal(payload.scope, 'readonly');
    });

    it('a self-signed sid: null (no session restriction) yields a ticket that verifies', () => {
        const res = controller().getWsToken(
            requestWith({ type: 'embed-token', scope: 'readonly', appKeys: ['app-1'], sessionId: null as unknown as string, expiresAt: now() + 60 })
        );
        const payload = verifyEmbedWsTicket(SECRET, res.token);
        assert.ok(payload);
        assert.equal(payload.sid, undefined);
    });

    it('refuses (501, so the client falls back) to mint a ticket from claims it cannot carry faithfully', () => {
        const base: AuthContext = { type: 'embed-token', scope: 'readonly', appKeys: ['app-1'], expiresAt: now() + 60 };
        for (const bad of [
            { sessionId: 42 as unknown as string },
            { sessionId: '' },
            { appKeys: 'app-1' as unknown as string[] },
            { appKeys: [1] as unknown as string[] },
            { expiresAt: Number.NaN }
        ]) {
            assert.throws(
                () => controller().getWsToken(requestWith({ ...base, ...bad })),
                (err: { httpCode?: number }) => err.httpCode === 501,
                JSON.stringify(bad)
            );
        }
    });

    it('answers 501 to an embed client when UXRR_SHARE_SECRET is not configured (client falls back)', () => {
        assert.throws(
            () => controller(null).getWsToken(requestWith({ type: 'embed-token', scope: 'readonly' })),
            (err: { httpCode?: number }) => err.httpCode === 501
        );
        // signed-in users keep the existing 500
        assert.throws(
            () => controller(null).getWsToken(requestWith({ type: 'oidc', scope: 'admin', userId: 'u-1' })),
            (err: { httpCode?: number }) => err.httpCode === 500
        );
    });

    it('signed-in users still get a plain ws token', () => {
        const res = controller().getWsToken(requestWith({ type: 'oidc', scope: 'admin', userId: 'u-1' }));
        assert.equal(res.kind, undefined);
        assert.deepEqual({ ...verifyWsToken(SECRET, res.token), exp: 0 }, { exp: 0, scope: 'admin', userId: 'u-1' });
    });

    it('an app-scoped API key gets a ticket limited to its apps (readonly), not an unrestricted ws token', () => {
        const res = controller().getWsToken(requestWith({ type: 'api-key', scope: 'interactive', appKeys: ['app-1'] }));
        assert.equal(verifyWsToken(SECRET, res.token), null);
        const payload = verifyEmbedWsTicket(SECRET, res.token)!;
        assert.equal(payload.scope, 'readonly');
        assert.deepEqual(payload.apps, ['app-1']);
    });

    it('an expired or invalid embed token gets no ticket (the auth middleware rejects it)', async () => {
        const apiKeySvc = {
            resolveApiKey: mock.fn(async () => undefined),
            verifyEmbedToken: mock.fn(async () => {
                throw new Error('Embed token has expired');
            })
        } as unknown as ApiKeyService;
        const mw = new SessionAuthMiddleware(
            { UXRR_DEV_MODE: false } as UxrrConfig,
            { isEnabled: true } as unknown as OidcService,
            apiKeySvc,
            {} as UserService,
            { warn: mock.fn() } as unknown as Logger
        );
        const req = { headers: { 'x-embed-token': 'dead.token' } } as unknown as HttpRequest;
        await assert.rejects(() => mw.handle(req, {} as HttpResponse), HttpUnauthorizedError);
    });

    it('the middleware records the embed token expiry for the ticket', async () => {
        const exp = now() + 120;
        const apiKeySvc = {
            resolveApiKey: mock.fn(async () => undefined),
            verifyEmbedToken: mock.fn(async () => ({ kid: 'k', exp, scope: 'readonly', apps: ['app-1'], sid: 'sess-1' }))
        } as unknown as ApiKeyService;
        const mw = new SessionAuthMiddleware(
            { UXRR_DEV_MODE: false } as UxrrConfig,
            { isEnabled: false } as unknown as OidcService,
            apiKeySvc,
            {} as UserService,
            { warn: mock.fn() } as unknown as Logger
        );
        const req = { headers: { 'x-embed-token': 'tok' } } as unknown as HttpRequest;
        await mw.handle(req, {} as HttpResponse);
        const ctx = (req as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY];
        assert.equal(ctx.expiresAt, exp);
        assert.equal(ctx.sessionId, 'sess-1');
    });
});

const MAX_TTL = 2592000;

function verifier(appKeys: string[]) {
    mock.method(Crypto, 'decrypt', (value: string) => value);
    const key = { id: 'key-1', keySecret: 'raw-secret', scope: 'interactive', appKeys, isActive: true } as unknown as ApiKeyEntity;
    const db = {
        query: () => ({ filter: () => ({ find: async () => [key] }) })
    } as unknown as UxrrDatabase;
    const warn = mock.fn();
    const svc = new ApiKeyService(db, { error: mock.fn(), warn } as unknown as Logger, { UXRR_MAX_EMBED_TOKEN_TTL: MAX_TTL } as UxrrConfig);
    return { svc, warn };
}

function selfSign(claims: Record<string, unknown>): string {
    const payloadB64 = Buffer.from(JSON.stringify({ kid: 'key-1', exp: now() + 60, scope: 'readonly', apps: [], ...claims })).toString('base64url');
    const sig = createHmac('sha256', 'raw-secret').update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

async function rejection(svc: ApiKeyService, token: string): Promise<string> {
    try {
        await svc.verifyEmbedToken(token);
    } catch (err) {
        return (err as Error).message;
    }
    return 'accepted';
}

describe('ApiKeyService.verifyEmbedToken — apps of an app-scoped key', () => {
    afterEach(() => mock.restoreAll());

    it('a self-signed token with no apps is limited to the key’s apps, with one warning per key (no token contents)', async () => {
        const { svc, warn } = verifier(['app-1', 'app-2']);
        const token = selfSign({ apps: [] });
        assert.deepEqual((await svc.verifyEmbedToken(token)).apps, ['app-1', 'app-2']);
        await svc.verifyEmbedToken(token);
        assert.equal(warn.mock.callCount(), 1);
        assert.ok(!JSON.stringify(warn.mock.calls[0].arguments).includes(token.split('.')[1]));
        assert.deepEqual(warn.mock.calls[0].arguments[1], { keyId: 'key-1' });
    });

    it('a token listing apps inside the key’s apps is unchanged', async () => {
        const { svc, warn } = verifier(['app-1', 'app-2']);
        assert.deepEqual((await svc.verifyEmbedToken(selfSign({ apps: ['app-2'] }))).apps, ['app-2']);
        assert.equal(warn.mock.callCount(), 0);
    });

    it('a key with no app restriction keeps an empty apps list', async () => {
        const { svc } = verifier([]);
        assert.deepEqual((await svc.verifyEmbedToken(selfSign({ apps: [] }))).apps, []);
    });
});

describe('ApiKeyService.verifyEmbedToken — claim shapes and lifetime', () => {
    afterEach(() => mock.restoreAll());

    it('rejects a token without a finite numeric exp', async () => {
        const { svc } = verifier([]);
        assert.equal(await rejection(svc, selfSign({ exp: undefined })), 'Embed token has no expiry');
        assert.equal(await rejection(svc, selfSign({ exp: '9999999999' })), 'Embed token has no expiry');
        assert.equal(await rejection(svc, selfSign({ exp: null })), 'Embed token has no expiry');
    });

    it('rejects an expired token', async () => {
        const { svc } = verifier([]);
        assert.equal(await rejection(svc, selfSign({ exp: now() - 5 })), 'Embed token has expired');
    });

    it('rejects a token living longer than UXRR_MAX_EMBED_TOKEN_TTL (60 s clock-skew margin)', async () => {
        const { svc } = verifier([]);
        assert.equal(await rejection(svc, selfSign({ exp: now() + MAX_TTL + 120 })), 'Embed token lifetime exceeds the allowed maximum');
        assert.equal(await rejection(svc, selfSign({ exp: now() + MAX_TTL + 30 })), 'accepted');
        // the longest token the /sign endpoint issues (exp = now + max TTL) passes
        assert.equal(await rejection(svc, selfSign({ exp: now() + MAX_TTL })), 'accepted');
    });

    it('rejects non-array apps or non-string entries, and a non-string sid (fail closed)', async () => {
        const { svc } = verifier([]);
        assert.equal(await rejection(svc, selfSign({ apps: 'app-1' })), 'Invalid embed token');
        assert.equal(await rejection(svc, selfSign({ apps: undefined })), 'Invalid embed token');
        assert.equal(await rejection(svc, selfSign({ apps: [1] })), 'Invalid embed token');
        assert.equal(await rejection(svc, selfSign({ sid: 42 })), 'Invalid embed token');
        assert.equal(await rejection(svc, selfSign({ sid: { id: 'x' } })), 'Invalid embed token');
    });

    it('a null or empty sid keeps meaning "no session restriction"', async () => {
        const { svc } = verifier([]);
        assert.equal((await svc.verifyEmbedToken(selfSign({ sid: null }))).sid, undefined);
        assert.equal((await svc.verifyEmbedToken(selfSign({ sid: '' }))).sid, undefined);
        assert.equal((await svc.verifyEmbedToken(selfSign({ sid: 'sess-1' }))).sid, 'sess-1');
    });
});
