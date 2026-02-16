import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'crypto';

import { AppResolverService } from '../src/services/app-resolver.service';
import type { UxrrDatabase } from '../src/database/database';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function createMocks(apps: { id: string; origins: string[]; apiKey?: string; isActive: boolean }[] = []) {
    const findFn = mock.fn(async () => apps);
    const filterFn = mock.fn(function (this: unknown) {
        return this;
    });

    const db = {
        query: mock.fn(() => ({
            filter: filterFn,
            find: findFn
        }))
    } as unknown as UxrrDatabase;

    return { db, findFn, filterFn };
}

describe('AppResolverService', () => {
    describe('resolveByOrigin', () => {
        it('maps known origin to appId', async () => {
            const { db } = createMocks([
                { id: 'app-1', origins: ['https://example.com'], apiKey: undefined, isActive: true }
            ]);
            const resolver = new AppResolverService(db, makeLogger());

            const result = await resolver.resolveByOrigin('https://example.com');
            assert.equal(result, 'app-1');
        });

        it('returns undefined for unknown origin', async () => {
            const { db } = createMocks([
                { id: 'app-1', origins: ['https://example.com'], apiKey: undefined, isActive: true }
            ]);
            const resolver = new AppResolverService(db, makeLogger());

            const result = await resolver.resolveByOrigin('https://unknown.com');
            assert.equal(result, undefined);
        });

        it('handles multiple origins per app', async () => {
            const { db } = createMocks([
                { id: 'app-1', origins: ['https://a.com', 'https://b.com'], apiKey: undefined, isActive: true }
            ]);
            const resolver = new AppResolverService(db, makeLogger());

            assert.equal(await resolver.resolveByOrigin('https://a.com'), 'app-1');
            assert.equal(await resolver.resolveByOrigin('https://b.com'), 'app-1');
        });
    });

    describe('resolveByApiKey', () => {
        it('maps known API key hash to appId', async () => {
            const rawKey = 'test-api-key-123';
            const keyHash = createHash('sha256').update(rawKey).digest('hex');
            const { db } = createMocks([{ id: 'app-2', origins: [], apiKey: keyHash, isActive: true }]);
            const resolver = new AppResolverService(db, makeLogger());

            const result = await resolver.resolveByApiKey(rawKey);
            assert.equal(result, 'app-2');
        });

        it('returns undefined for unknown API key', async () => {
            const { db } = createMocks([]);
            const resolver = new AppResolverService(db, makeLogger());

            const result = await resolver.resolveByApiKey('nonexistent-key');
            assert.equal(result, undefined);
        });
    });

    describe('cache TTL', () => {
        it('caches results and does not re-query within TTL', async () => {
            const { db, findFn } = createMocks([
                { id: 'app-1', origins: ['https://example.com'], apiKey: undefined, isActive: true }
            ]);
            const resolver = new AppResolverService(db, makeLogger());

            await resolver.resolveByOrigin('https://example.com');
            await resolver.resolveByOrigin('https://example.com');

            // Should only query DB once
            assert.equal(findFn.mock.callCount(), 1);
        });

        it('re-queries after cache invalidation', async () => {
            const apps = [{ id: 'app-1', origins: ['https://example.com'], apiKey: undefined, isActive: true }];
            const { db, findFn } = createMocks(apps);
            const resolver = new AppResolverService(db, makeLogger());

            await resolver.resolveByOrigin('https://example.com');
            assert.equal(findFn.mock.callCount(), 1);

            apps[0]!.origins = ['https://new.example.com'];
            resolver.invalidateCache();

            const next = await resolver.resolveByOrigin('https://new.example.com');
            assert.equal(next, 'app-1');
            assert.equal(findFn.mock.callCount(), 2);
        });
    });

    describe('getAllowedOrigins', () => {
        it('returns all registered origins', async () => {
            const { db } = createMocks([
                { id: 'app-1', origins: ['https://a.com', 'https://b.com'], apiKey: undefined, isActive: true },
                { id: 'app-2', origins: ['https://c.com'], apiKey: undefined, isActive: true }
            ]);
            const resolver = new AppResolverService(db, makeLogger());

            const origins = await resolver.getAllowedOrigins();
            assert.deepEqual(origins.sort(), ['https://a.com', 'https://b.com', 'https://c.com']);
        });
    });

    describe('error handling', () => {
        it('logs error and keeps stale cache on refresh failure', async () => {
            const errorFn = mock.fn((..._msg: unknown[]) => {});
            const logger = { warn: mock.fn(), error: errorFn, info: mock.fn(), debug: mock.fn() } as unknown as Logger;

            const findFn = mock.fn(async () => {
                throw new Error('DB connection failed');
            });
            const db = {
                query: mock.fn(() => ({
                    filter: mock.fn(function (this: unknown) {
                        return this;
                    }),
                    find: findFn
                }))
            } as unknown as UxrrDatabase;

            const resolver = new AppResolverService(db, logger);

            // Should not throw
            const result = await resolver.resolveByOrigin('https://example.com');
            assert.equal(result, undefined);
            assert.equal(errorFn.mock.callCount(), 1);
        });
    });
});
