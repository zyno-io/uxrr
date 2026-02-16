import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { SessionAuthMiddleware, getAuthContext } from '../src/middleware/session-auth.middleware';
import type { UxrrConfig } from '../src/config';
import type { OidcService } from '../src/services/oidc.service';
import type { ApiKeyService, EmbedTokenPayload } from '../src/services/api-key.service';
import type { UserService } from '../src/services/user.service';
import type { HttpRequest, HttpResponse } from '@deepkit/http';
import type { Logger } from '@deepkit/logger';
import type { JWTPayload } from 'jose';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        OIDC_ADMIN_CLAIM: undefined,
        OIDC_ADMIN_VALUE: undefined,
        UXRR_DEV_MODE: false,
        ...overrides
    } as UxrrConfig;
}

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn() } as unknown as Logger;
}

function makeRequest(headers: Record<string, string> = {}): HttpRequest {
    return { headers } as unknown as HttpRequest;
}

function makeResponse(): HttpResponse {
    return {} as unknown as HttpResponse;
}

function makeOidc(enabled: boolean, payload?: JWTPayload): OidcService {
    return {
        isEnabled: enabled,
        validateToken: enabled
            ? mock.fn(async () => payload ?? { sub: 'user-1' })
            : mock.fn(async () => {
                  throw new Error('not enabled');
              })
    } as unknown as OidcService;
}

function makeApiKeySvc(overrides: Partial<ApiKeyService> = {}): ApiKeyService {
    return {
        resolveApiKey: mock.fn(async () => undefined),
        verifyEmbedToken: mock.fn(async () => {
            throw new Error('invalid');
        }),
        ...overrides
    } as unknown as ApiKeyService;
}

function makeUserSvc(overrides: { isAdmin?: boolean; id?: string; email?: string; name?: string } = {}): UserService {
    return {
        upsertFromOidc: mock.fn(async () => ({
            id: overrides.id ?? 'user-uuid-1',
            email: overrides.email ?? 'user@test.com',
            name: overrides.name ?? 'Test User',
            isAdmin: overrides.isAdmin ?? true,
            oidcSub: 'oidc-sub-1',
            lastLoginAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    } as unknown as UserService;
}

describe('SessionAuthMiddleware', () => {
    describe('OIDC Bearer token auth', () => {
        it('authenticates with valid OIDC bearer token', async () => {
            const oidc = makeOidc(true, { sub: 'user-1' });
            const userSvc = makeUserSvc({ isAdmin: true });
            const mw = new SessionAuthMiddleware(makeConfig(), oidc, makeApiKeySvc(), userSvc, makeLogger());

            const req = makeRequest({ authorization: 'Bearer valid-token' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.type, 'oidc');
            assert.equal(ctx.scope, 'admin');
        });

        it('OIDC scope is readonly when user is not admin in DB', async () => {
            const oidc = makeOidc(true, { sub: 'user-1' });
            const userSvc = makeUserSvc({ isAdmin: false });
            const mw = new SessionAuthMiddleware(makeConfig(), oidc, makeApiKeySvc(), userSvc, makeLogger());

            const req = makeRequest({ authorization: 'Bearer valid-token' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.scope, 'readonly');
        });

        it('OIDC scope is admin when user is admin in DB', async () => {
            const oidc = makeOidc(true, { sub: 'user-1' });
            const userSvc = makeUserSvc({ isAdmin: true });
            const mw = new SessionAuthMiddleware(makeConfig(), oidc, makeApiKeySvc(), userSvc, makeLogger());

            const req = makeRequest({ authorization: 'Bearer valid-token' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.scope, 'admin');
        });

        it('sets userId, userName, userEmail from user record', async () => {
            const oidc = makeOidc(true, { sub: 'user-1' });
            const userSvc = makeUserSvc({ id: 'user-uuid-42', email: 'test@x.com', name: 'Test' });
            const mw = new SessionAuthMiddleware(makeConfig(), oidc, makeApiKeySvc(), userSvc, makeLogger());

            const req = makeRequest({ authorization: 'Bearer valid-token' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.userId, 'user-uuid-42');
            assert.equal(ctx.userEmail, 'test@x.com');
            assert.equal(ctx.userName, 'Test');
        });
    });

    describe('API key auth', () => {
        it('authenticates with valid X-API-Key header', async () => {
            const apiKeySvc = makeApiKeySvc({
                resolveApiKey: mock.fn(async () => ({
                    keyId: 'key-1',
                    scope: 'interactive' as const,
                    appIds: ['app-1']
                }))
            });
            const mw = new SessionAuthMiddleware(makeConfig(), makeOidc(false), apiKeySvc, makeUserSvc(), makeLogger());

            const req = makeRequest({ 'x-api-key': 'raw-key' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.type, 'api-key');
            assert.equal(ctx.scope, 'interactive');
            assert.deepEqual(ctx.appIds, ['app-1']);
        });

        it('sets correct scope for readonly API key', async () => {
            const apiKeySvc = makeApiKeySvc({
                resolveApiKey: mock.fn(async () => ({
                    keyId: 'key-1',
                    scope: 'readonly' as const,
                    appIds: []
                }))
            });
            const mw = new SessionAuthMiddleware(makeConfig(), makeOidc(false), apiKeySvc, makeUserSvc(), makeLogger());

            const req = makeRequest({ 'x-api-key': 'raw-key' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.scope, 'readonly');
            assert.equal(ctx.appIds, undefined); // empty array becomes undefined
        });
    });

    describe('Embed token auth', () => {
        it('authenticates with valid X-Embed-Token header', async () => {
            const apiKeySvc = makeApiKeySvc({
                verifyEmbedToken: mock.fn(
                    async () =>
                        ({
                            kid: 'key-1',
                            exp: Math.floor(Date.now() / 1000) + 3600,
                            scope: 'readonly' as const,
                            apps: ['app-1'],
                            sid: 'sess-1'
                        }) satisfies EmbedTokenPayload
                )
            });
            const mw = new SessionAuthMiddleware(makeConfig(), makeOidc(false), apiKeySvc, makeUserSvc(), makeLogger());

            const req = makeRequest({ 'x-embed-token': 'valid-token' });
            await mw.handle(req, makeResponse());

            const ctx = getAuthContext(req);
            assert.equal(ctx.type, 'embed-token');
            assert.equal(ctx.scope, 'readonly');
            assert.deepEqual(ctx.appIds, ['app-1']);
            assert.equal(ctx.sessionId, 'sess-1');
        });
    });

    describe('rejection', () => {
        it('rejects requests with no auth headers', async () => {
            const mw = new SessionAuthMiddleware(
                makeConfig(),
                makeOidc(false),
                makeApiKeySvc(),
                makeUserSvc(),
                makeLogger()
            );

            await assert.rejects(
                () => mw.handle(makeRequest(), makeResponse()),
                (err: Error) => {
                    assert.match(err.message, /Authentication required/);
                    return true;
                }
            );
        });

        it('rejects when all auth methods fail', async () => {
            const oidc = {
                isEnabled: true,
                validateToken: mock.fn(async () => {
                    throw new Error('bad token');
                })
            } as unknown as OidcService;

            const mw = new SessionAuthMiddleware(makeConfig(), oidc, makeApiKeySvc(), makeUserSvc(), makeLogger());

            await assert.rejects(
                () => mw.handle(makeRequest({ authorization: 'Bearer bad', 'x-api-key': 'bad' }), makeResponse()),
                (err: Error) => {
                    assert.match(err.message, /Authentication required/);
                    return true;
                }
            );
        });
    });
});
