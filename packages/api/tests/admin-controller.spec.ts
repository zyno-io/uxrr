import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { AdminController } from '../src/controllers/admin.controller';
import { AUTH_CONTEXT_KEY } from '../src/middleware/session-auth.middleware';
import type { UxrrDatabase } from '../src/database/database';
import type { AppResolverService } from '../src/services/app-resolver.service';
import type { UserService } from '../src/services/user.service';
import type { HttpRequest } from '@deepkit/http';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn() } as unknown as Logger;
}

function makeDb(
    overrides: { apps?: unknown[]; findOneApp?: unknown; adminCount?: number; findOneUser?: unknown } = {}
) {
    const persistFn = mock.fn(async () => {});
    const findOneFn = mock.fn(
        async () =>
            overrides.findOneApp ?? {
                id: 'app-1',
                name: 'Test',
                origins: [],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            }
    );
    const findFn = mock.fn(async () => overrides.apps ?? []);
    const countFn = mock.fn(async () => overrides.adminCount ?? 2);
    const findOneUserFn = mock.fn(async () => overrides.findOneUser ?? { id: 'user-target', isAdmin: true });
    return {
        db: {
            query: mock.fn(() => ({
                filter: mock.fn(() => ({
                    findOne: findOneFn,
                    find: findFn,
                    count: countFn,
                    findOneOrUndefined: mock.fn(async () => overrides.findOneUser)
                })),
                find: findFn,
                count: countFn
            })),
            persist: persistFn
        } as unknown as UxrrDatabase,
        persistFn,
        findOneFn,
        countFn,
        findOneUserFn
    };
}

function makeUserSvc(overrides: { users?: unknown[]; setAdminResult?: unknown } = {}): UserService {
    return {
        getAll: mock.fn(async () => overrides.users ?? []),
        setAdmin: mock.fn(
            async (_id: string, isAdmin: boolean) =>
                overrides.setAdminResult ?? {
                    id: 'user-1',
                    email: 'test@test.com',
                    name: 'Test',
                    isAdmin,
                    lastLoginAt: new Date(),
                    createdAt: new Date()
                }
        )
    } as unknown as UserService;
}

function makeRequest(userId: string = 'user-1'): HttpRequest {
    return {
        headers: {},
        [AUTH_CONTEXT_KEY]: { type: 'oidc', scope: 'admin', userId }
    } as unknown as HttpRequest;
}

function makeAppResolver(): AppResolverService {
    return { invalidateCache: mock.fn() } as unknown as AppResolverService;
}

describe('AdminController', () => {
    describe('listApps', () => {
        it('returns all apps', async () => {
            const apps = [
                {
                    id: 'a1',
                    name: 'App 1',
                    origins: ['https://a.com'],
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                { id: 'a2', name: 'App 2', origins: [], isActive: false, createdAt: new Date(), updatedAt: new Date() }
            ];
            const { db } = makeDb({ apps });
            const ctrl = new AdminController(db, makeUserSvc(), makeAppResolver(), makeLogger());
            const result = await ctrl.listApps();
            assert.equal(result.length, 2);
            assert.equal(result[0].id, 'a1');
        });
    });

    describe('createApp', () => {
        it('generates UUID and persists', async () => {
            const { db, persistFn } = makeDb();
            const resolver = makeAppResolver();
            const ctrl = new AdminController(db, makeUserSvc(), resolver, makeLogger());
            const result = await ctrl.createApp({
                name: 'New App',
                origins: ['https://new.com']
            } as unknown as Parameters<typeof ctrl.createApp>[0]);
            assert.ok(result.id);
            assert.equal(result.name, 'New App');
            assert.deepEqual(result.origins, ['https://new.com']);
            assert.equal(persistFn.mock.callCount(), 1);
            assert.equal((resolver.invalidateCache as any).mock.callCount(), 1);
        });

        it('rejects empty app name', async () => {
            const { db } = makeDb();
            const ctrl = new AdminController(db, makeUserSvc(), makeAppResolver(), makeLogger());
            await assert.rejects(
                () => ctrl.createApp({ name: '   ', origins: [] } as unknown as Parameters<typeof ctrl.createApp>[0]),
                (err: Error) => {
                    assert.match(err.message, /name/i);
                    return true;
                }
            );
        });

        it('rejects invalid origin', async () => {
            const { db } = makeDb();
            const ctrl = new AdminController(db, makeUserSvc(), makeAppResolver(), makeLogger());
            await assert.rejects(
                () =>
                    ctrl.createApp({ name: 'App', origins: ['not-a-url'] } as unknown as Parameters<
                        typeof ctrl.createApp
                    >[0]),
                (err: Error) => {
                    assert.match(err.message, /origin/i);
                    return true;
                }
            );
        });
    });

    describe('updateApp', () => {
        it('patches fields selectively', async () => {
            const app = {
                id: 'a1',
                name: 'Old',
                origins: ['https://old.com'],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const { db, persistFn } = makeDb({ findOneApp: app });
            const resolver = makeAppResolver();
            const ctrl = new AdminController(db, makeUserSvc(), resolver, makeLogger());
            const result = await ctrl.updateApp('a1', { name: 'New' } as unknown as Parameters<
                typeof ctrl.updateApp
            >[1]);
            assert.equal(result.name, 'New');
            assert.deepEqual(result.origins, ['https://old.com']); // unchanged
            assert.equal(persistFn.mock.callCount(), 1);
            assert.equal((resolver.invalidateCache as any).mock.callCount(), 1);
        });
    });

    describe('deactivateApp', () => {
        it('sets isActive to false', async () => {
            const app = {
                id: 'a1',
                name: 'App',
                origins: [],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const { db, persistFn } = makeDb({ findOneApp: app });
            const resolver = makeAppResolver();
            const ctrl = new AdminController(db, makeUserSvc(), resolver, makeLogger());
            const result = await ctrl.deactivateApp('a1');
            assert.equal(result.ok, true);
            assert.equal(app.isActive, false);
            assert.equal(persistFn.mock.callCount(), 1);
            assert.equal((resolver.invalidateCache as any).mock.callCount(), 1);
        });
    });

    describe('listUsers', () => {
        it('delegates to UserService.getAll', async () => {
            const users = [
                {
                    id: 'u1',
                    email: 'a@test.com',
                    name: 'A',
                    isAdmin: true,
                    lastLoginAt: new Date(),
                    createdAt: new Date()
                }
            ];
            const userSvc = makeUserSvc({ users });
            const { db } = makeDb();
            const ctrl = new AdminController(db, userSvc, makeAppResolver(), makeLogger());
            const result = await ctrl.listUsers();
            assert.equal(result.length, 1);
            assert.equal(result[0].email, 'a@test.com');
        });
    });

    describe('updateUser', () => {
        it('toggles admin via UserService.setAdmin', async () => {
            const userSvc = makeUserSvc();
            const { db } = makeDb({ adminCount: 2 });
            const ctrl = new AdminController(db, userSvc, makeAppResolver(), makeLogger());
            const req = makeRequest('user-requester');
            const result = await ctrl.updateUser('user-target', req, { isAdmin: true } as unknown as Parameters<
                typeof ctrl.updateUser
            >[2]);
            assert.equal(result.isAdmin, true);
        });

        it('blocks self-demotion', async () => {
            const userSvc = makeUserSvc();
            const { db } = makeDb();
            const ctrl = new AdminController(db, userSvc, makeAppResolver(), makeLogger());
            const req = makeRequest('user-self');
            await assert.rejects(
                () =>
                    ctrl.updateUser('user-self', req, { isAdmin: false } as unknown as Parameters<
                        typeof ctrl.updateUser
                    >[2]),
                (err: Error) => {
                    assert.match(err.message, /Cannot demote yourself/);
                    return true;
                }
            );
        });

        it('blocks demoting the last admin', async () => {
            const userSvc = makeUserSvc();
            // findOneApp is used by findOne() for any entity — set it to a user-like object
            const { db } = makeDb({ adminCount: 1, findOneApp: { id: 'user-target', isAdmin: true } });
            const ctrl = new AdminController(db, userSvc, makeAppResolver(), makeLogger());
            const req = makeRequest('user-requester');
            await assert.rejects(
                () =>
                    ctrl.updateUser('user-target', req, { isAdmin: false } as unknown as Parameters<
                        typeof ctrl.updateUser
                    >[2]),
                (err: Error) => {
                    assert.match(err.message, /last admin/);
                    return true;
                }
            );
        });
    });
});
