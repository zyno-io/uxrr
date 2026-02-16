import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { UserService } from '../src/services/user.service';
import type { UxrrDatabase } from '../src/database/database';
import type { UxrrConfig } from '../src/config';
import type { Logger } from '@deepkit/logger';
import type { JWTPayload } from 'jose';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        OIDC_ADMIN_CLAIM: undefined,
        OIDC_ADMIN_VALUE: undefined,
        ...overrides
    } as UxrrConfig;
}

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeDb(overrides: { findOne?: unknown; count?: number; find?: unknown[] } = {}) {
    const persistFn = mock.fn(async () => {});
    const findOneOrUndefinedFn = mock.fn(async () => overrides.findOne);
    const countFn = mock.fn(async () => overrides.count ?? 0);
    const findFn = mock.fn(async () => overrides.find ?? []);
    const findOneFn = mock.fn(async () => overrides.findOne);
    const filterFn = mock.fn(() => ({
        findOneOrUndefined: findOneOrUndefinedFn,
        findOne: findOneFn,
        count: countFn,
        find: findFn
    }));

    return {
        db: {
            query: mock.fn(() => ({
                filter: filterFn,
                count: countFn,
                find: findFn
            })),
            persist: persistFn
        } as unknown as UxrrDatabase,
        persistFn,
        findOneOrUndefinedFn,
        countFn,
        filterFn
    };
}

describe('UserService', () => {
    describe('upsertFromOidc', () => {
        it('creates new user from OIDC payload', async () => {
            const { db, persistFn } = makeDb({ count: 1 });
            const svc = new UserService(db, makeConfig(), makeLogger());

            const payload: JWTPayload = { sub: 'oidc-sub-1', email: 'test@test.com', name: 'Test User' };
            const user = await svc.upsertFromOidc(payload);

            assert.ok(user.id);
            assert.equal(user.oidcSub, 'oidc-sub-1');
            assert.equal(user.email, 'test@test.com');
            assert.equal(user.name, 'Test User');
            assert.equal(persistFn.mock.callCount(), 1);
        });

        it('first user becomes admin', async () => {
            const { db } = makeDb({ count: 0 });
            const svc = new UserService(db, makeConfig(), makeLogger());

            const payload: JWTPayload = { sub: 'first-user', email: 'first@test.com' };
            const user = await svc.upsertFromOidc(payload);

            assert.equal(user.isAdmin, true);
        });

        it('subsequent users respect OIDC admin claim', async () => {
            const { db } = makeDb({ count: 5 });
            const config = makeConfig({
                OIDC_ADMIN_CLAIM: 'role',
                OIDC_ADMIN_VALUE: 'admin'
            });
            const svc = new UserService(db, config, makeLogger());

            const adminPayload: JWTPayload = { sub: 'admin-user', email: 'admin@test.com', role: 'admin' };
            const adminUser = await svc.upsertFromOidc(adminPayload);
            assert.equal(adminUser.isAdmin, true);
        });

        it('subsequent users without admin claim are not admin', async () => {
            const { db } = makeDb({ count: 5 });
            const config = makeConfig({
                OIDC_ADMIN_CLAIM: 'role',
                OIDC_ADMIN_VALUE: 'admin'
            });
            const svc = new UserService(db, config, makeLogger());

            const viewerPayload: JWTPayload = { sub: 'viewer-user', email: 'viewer@test.com', role: 'viewer' };
            const viewerUser = await svc.upsertFromOidc(viewerPayload);
            assert.equal(viewerUser.isAdmin, false);
        });

        it('existing user matched by oidcSub updates fields but not isAdmin', async () => {
            const existingUser = {
                id: 'user-uuid-1',
                oidcSub: 'oidc-sub-1',
                email: 'old@test.com',
                name: 'Old Name',
                isAdmin: true,
                lastLoginAt: new Date('2024-01-01'),
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-01-01')
            };

            // First call to filter (by oidcSub) returns the user
            const findOneOrUndefinedFn = mock.fn(async () => existingUser);
            const persistFn = mock.fn(async () => {});
            const db = {
                query: mock.fn(() => ({
                    filter: mock.fn(() => ({
                        findOneOrUndefined: findOneOrUndefinedFn,
                        count: mock.fn(async () => 1)
                    })),
                    count: mock.fn(async () => 1)
                })),
                persist: persistFn
            } as unknown as UxrrDatabase;

            const svc = new UserService(db, makeConfig(), makeLogger());
            const payload: JWTPayload = { sub: 'oidc-sub-1', email: 'new@test.com', name: 'New Name' };
            const user = await svc.upsertFromOidc(payload);

            assert.equal(user.id, 'user-uuid-1');
            assert.equal(user.email, 'new@test.com');
            assert.equal(user.name, 'New Name');
            assert.equal(user.isAdmin, true); // unchanged
            assert.equal(persistFn.mock.callCount(), 1);
        });

        it('rejects token with missing sub claim', async () => {
            const { db } = makeDb();
            const svc = new UserService(db, makeConfig(), makeLogger());

            await assert.rejects(
                () => svc.upsertFromOidc({ email: 'user@test.com' }),
                (err: Error) => {
                    assert.match(err.message, /missing required sub claim/);
                    return true;
                }
            );
        });

        it('rejects token with blank sub claim', async () => {
            const { db } = makeDb();
            const svc = new UserService(db, makeConfig(), makeLogger());

            await assert.rejects(
                () => svc.upsertFromOidc({ sub: '   ' }),
                (err: Error) => {
                    assert.match(err.message, /missing required sub claim/);
                    return true;
                }
            );
        });

        it('does not match by email when oidcSub differs', async () => {
            // Verifies email fallback was removed
            const { db, persistFn } = makeDb({ count: 5 });
            const svc = new UserService(db, makeConfig(), makeLogger());

            const payload: JWTPayload = { sub: 'new-idp-sub', email: 'user@test.com' };
            const user = await svc.upsertFromOidc(payload);

            // Should create a new user, not match by email
            assert.equal(user.oidcSub, 'new-idp-sub');
            assert.equal(persistFn.mock.callCount(), 1);
        });
    });

    describe('setAdmin', () => {
        it('toggles admin flag', async () => {
            const existingUser = {
                id: 'user-uuid-1',
                isAdmin: false,
                updatedAt: new Date('2024-01-01')
            };
            const persistFn = mock.fn(async () => {});
            const db = {
                query: mock.fn(() => ({
                    filter: mock.fn(() => ({
                        findOne: mock.fn(async () => existingUser)
                    }))
                })),
                persist: persistFn
            } as unknown as UxrrDatabase;

            const svc = new UserService(db, makeConfig(), makeLogger());
            const user = await svc.setAdmin('user-uuid-1', true);

            assert.equal(user.isAdmin, true);
            assert.equal(persistFn.mock.callCount(), 1);
        });
    });
});
