import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { ApiKeyService } from '../src/services/api-key.service';
import type { ApiKeyEntity } from '../src/database/entities/api-key.entity';
import type { UxrrDatabase } from '../src/database/database';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn() } as unknown as Logger;
}

function makeKey(overrides: Partial<ApiKeyEntity> = {}): ApiKeyEntity {
    return {
        id: 'key-1',
        name: 'Test Key',
        keyPrefix: 'test1234',
        keySecret: 'encrypted-secret',
        scope: 'interactive',
        appIds: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    } as ApiKeyEntity;
}

function makeDb(key: ApiKeyEntity | undefined): UxrrDatabase {
    return {
        query: mock.fn(() => ({
            filter: mock.fn(function (this: unknown) {
                return this;
            }),
            findOneOrUndefined: mock.fn(async () => key),
            find: mock.fn(async () => (key ? [key] : []))
        })),
        persist: mock.fn(async () => {})
    } as unknown as UxrrDatabase;
}

describe('ApiKeyService.update — scope validation', () => {
    it('rejects invalid scope values', async () => {
        const key = makeKey();
        const db = makeDb(key);
        const svc = new ApiKeyService(db, makeLogger());

        await assert.rejects(
            () => svc.update('key-1', { scope: 'admin' }),
            (err: Error) => {
                assert.match(err.message, /scope must be "readonly" or "interactive"/);
                return true;
            }
        );
    });

    it('rejects scope "superadmin"', async () => {
        const key = makeKey();
        const db = makeDb(key);
        const svc = new ApiKeyService(db, makeLogger());

        await assert.rejects(
            () => svc.update('key-1', { scope: 'superadmin' }),
            (err: Error) => {
                assert.match(err.message, /scope must be "readonly" or "interactive"/);
                return true;
            }
        );
    });

    it('accepts "readonly" scope', async () => {
        const key = makeKey({ scope: 'interactive' });
        const db = makeDb(key);
        const svc = new ApiKeyService(db, makeLogger());

        const updated = await svc.update('key-1', { scope: 'readonly' });
        assert.equal(updated.scope, 'readonly');
    });

    it('accepts "interactive" scope', async () => {
        const key = makeKey({ scope: 'readonly' });
        const db = makeDb(key);
        const svc = new ApiKeyService(db, makeLogger());

        const updated = await svc.update('key-1', { scope: 'interactive' });
        assert.equal(updated.scope, 'interactive');
    });
});

describe('ApiKeyService.resolveApiKey — deactivated key', () => {
    it('rejects deactivated API key', async () => {
        const key = makeKey({ isActive: false });
        // For resolveApiKey, the cache is populated via refresh() which only loads active keys
        // A deactivated key won't be in the cache, so resolveApiKey returns undefined
        const db = {
            query: mock.fn(() => ({
                filter: mock.fn(function (this: unknown) {
                    return this;
                }),
                findOneOrUndefined: mock.fn(async () => key),
                find: mock.fn(async () => []) // refresh returns no active keys
            })),
            persist: mock.fn(async () => {})
        } as unknown as UxrrDatabase;

        const svc = new ApiKeyService(db, makeLogger());
        const result = await svc.resolveApiKey('any-key');
        assert.equal(result, undefined);
    });
});
