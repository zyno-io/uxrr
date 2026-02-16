import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { OidcAuthMiddleware } from '../src/middleware/oidc-auth.middleware';
import { AUTH_CONTEXT_KEY } from '../src/middleware/session-auth.middleware';
import type { UxrrConfig } from '../src/config';
import type { OidcService } from '../src/services/oidc.service';
import type { UserService } from '../src/services/user.service';
import type { HttpRequest, HttpResponse } from '@deepkit/http';
import type { Logger } from '@deepkit/logger';
import type { JWTPayload } from 'jose';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
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

describe('OidcAuthMiddleware', () => {
    it('throws 401 when OIDC is not configured', async () => {
        const mw = new OidcAuthMiddleware(makeConfig(), makeOidc(false), makeUserSvc(), makeLogger());

        await assert.rejects(
            () => mw.handle(makeRequest({ authorization: 'Bearer token' }), makeResponse()),
            (err: Error) => {
                assert.match(err.message, /OIDC authentication is required/);
                return true;
            }
        );
    });

    it('allows admin access in dev mode without OIDC', async () => {
        const originalEnv = process.env.NODE_ENV;
        delete process.env.NODE_ENV;
        try {
            const config = makeConfig({ UXRR_DEV_MODE: true });
            const mw = new OidcAuthMiddleware(config, makeOidc(false), makeUserSvc(), makeLogger());

            const req = makeRequest();
            await mw.handle(req, makeResponse());

            const ctx = (req as unknown as Record<string | symbol, unknown>)[AUTH_CONTEXT_KEY] as Record<
                string,
                unknown
            >;
            assert.equal(ctx.type, 'oidc');
            assert.equal(ctx.scope, 'admin');
        } finally {
            if (originalEnv !== undefined) process.env.NODE_ENV = originalEnv;
        }
    });

    it('throws 401 when Authorization header is missing', async () => {
        const mw = new OidcAuthMiddleware(makeConfig(), makeOidc(true), makeUserSvc(), makeLogger());

        await assert.rejects(
            () => mw.handle(makeRequest(), makeResponse()),
            (err: Error) => {
                assert.match(err.message, /Missing Authorization header/);
                return true;
            }
        );
    });

    it('throws 401 when Authorization header has wrong format', async () => {
        const mw = new OidcAuthMiddleware(makeConfig(), makeOidc(true), makeUserSvc(), makeLogger());

        await assert.rejects(
            () => mw.handle(makeRequest({ authorization: 'Basic abc123' }), makeResponse()),
            (err: Error) => {
                assert.match(err.message, /Invalid Authorization header format/);
                return true;
            }
        );
    });

    it('throws 401 when token validation fails', async () => {
        const oidc = {
            isEnabled: true,
            validateToken: mock.fn(async () => {
                throw new Error('token expired');
            })
        } as unknown as OidcService;
        const mw = new OidcAuthMiddleware(makeConfig(), oidc, makeUserSvc(), makeLogger());

        await assert.rejects(
            () => mw.handle(makeRequest({ authorization: 'Bearer bad-token' }), makeResponse()),
            (err: Error) => {
                assert.match(err.message, /Invalid or expired token/);
                return true;
            }
        );
    });

    it('throws 403 for non-admin users (DB-based)', async () => {
        const oidc = makeOidc(true, { sub: 'user-1' });
        const userSvc = makeUserSvc({ isAdmin: false });
        const mw = new OidcAuthMiddleware(makeConfig(), oidc, userSvc, makeLogger());

        await assert.rejects(
            () => mw.handle(makeRequest({ authorization: 'Bearer valid-token' }), makeResponse()),
            (err: Error) => {
                assert.match(err.message, /Admin access required/);
                return true;
            }
        );
    });

    it('allows admin users through (DB-based)', async () => {
        const oidc = makeOidc(true, { sub: 'user-1' });
        const userSvc = makeUserSvc({ isAdmin: true });
        const mw = new OidcAuthMiddleware(makeConfig(), oidc, userSvc, makeLogger());

        // Should not throw
        await mw.handle(makeRequest({ authorization: 'Bearer valid-token' }), makeResponse());
    });

    it('sets AuthContext with userId', async () => {
        const oidc = makeOidc(true, { sub: 'user-1' });
        const userSvc = makeUserSvc({ isAdmin: true, id: 'user-uuid-42', email: 'admin@test.com', name: 'Admin' });
        const mw = new OidcAuthMiddleware(makeConfig(), oidc, userSvc, makeLogger());

        const req = makeRequest({ authorization: 'Bearer valid-token' });
        await mw.handle(req, makeResponse());

        const ctx = (req as unknown as Record<string | symbol, unknown>)[AUTH_CONTEXT_KEY] as Record<string, unknown>;
        assert.equal(ctx.type, 'oidc');
        assert.equal(ctx.scope, 'admin');
        assert.equal(ctx.userId, 'user-uuid-42');
        assert.equal(ctx.userEmail, 'admin@test.com');
        assert.equal(ctx.userName, 'Admin');
    });
});
