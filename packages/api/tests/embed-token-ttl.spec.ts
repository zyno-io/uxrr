import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { ApiKeyController } from '../src/controllers/api-key.controller';
import type { ApiKeyService } from '../src/services/api-key.service';
import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';
import type { HttpRequest } from '@deepkit/http';

function makeConfig(maxTtl: number = 2592000): UxrrConfig {
    return { UXRR_MAX_EMBED_TOKEN_TTL: maxTtl } as UxrrConfig;
}

function makeRequest(apiKey?: string): HttpRequest {
    return {
        headers: {
            'x-api-key': apiKey ?? 'test-raw-key'
        }
    } as unknown as HttpRequest;
}

function makeApiKeySvc(overrides: Partial<ApiKeyService> = {}): ApiKeyService {
    return {
        resolveApiKey: mock.fn(async () => ({
            keyId: 'key-1',
            scope: 'interactive' as const,
            appIds: [] as string[]
        })),
        get: mock.fn(async () => ({
            id: 'key-1',
            name: 'Test Key',
            keyPrefix: 'uxrr_',
            scope: 'interactive',
            appIds: [],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        })),
        signEmbedToken: mock.fn(() => 'mock.token'),
        ...overrides
    } as unknown as ApiKeyService;
}

const mockDb = {} as unknown as UxrrDatabase;

describe('ApiKeyController.signToken — TTL validation', () => {
    it('rejects token with exp in the past', async () => {
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(), mockDb);
        const now = Math.floor(Date.now() / 1000);

        await assert.rejects(
            () => controller.signToken(makeRequest(), { exp: now - 60, scope: 'readonly', apps: ['app-1'] }),
            (err: Error) => {
                assert.match(err.message, /must be in the future/);
                return true;
            }
        );
    });

    it('rejects token with exp exactly at current time', async () => {
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(), mockDb);
        const now = Math.floor(Date.now() / 1000);

        await assert.rejects(
            () => controller.signToken(makeRequest(), { exp: now, scope: 'readonly', apps: ['app-1'] }),
            (err: Error) => {
                assert.match(err.message, /must be in the future/);
                return true;
            }
        );
    });

    it('rejects token with exp exceeding max TTL', async () => {
        const maxTtl = 3600; // 1 hour
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(maxTtl), mockDb);
        const now = Math.floor(Date.now() / 1000);

        await assert.rejects(
            () => controller.signToken(makeRequest(), { exp: now + maxTtl + 60, scope: 'readonly', apps: ['app-1'] }),
            (err: Error) => {
                assert.match(err.message, /too far in future/);
                return true;
            }
        );
    });

    it('accepts token with exp within max TTL', async () => {
        const maxTtl = 3600;
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(maxTtl), mockDb);
        const now = Math.floor(Date.now() / 1000);

        const result = await controller.signToken(makeRequest(), {
            exp: now + maxTtl - 60,
            scope: 'readonly',
            apps: ['app-1']
        });

        assert.ok(result.token);
    });

    it('accepts token with exp exactly at max TTL boundary', async () => {
        const maxTtl = 3600;
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(maxTtl), mockDb);
        const now = Math.floor(Date.now() / 1000);

        const result = await controller.signToken(makeRequest(), {
            exp: now + maxTtl,
            scope: 'readonly',
            apps: ['app-1']
        });

        assert.ok(result.token);
    });

    it('rejects when no API key header is provided', async () => {
        const controller = new ApiKeyController(makeApiKeySvc(), makeConfig(), mockDb);

        await assert.rejects(
            () =>
                controller.signToken({ headers: {} } as unknown as HttpRequest, {
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    scope: 'readonly',
                    apps: ['app-1']
                }),
            (err: Error) => {
                assert.match(err.message, /X-API-Key header required/);
                return true;
            }
        );
    });

    it('rejects when API key is invalid', async () => {
        const apiKeySvc = makeApiKeySvc({
            resolveApiKey: mock.fn(async () => undefined) as unknown as ApiKeyService['resolveApiKey']
        });
        const controller = new ApiKeyController(apiKeySvc, makeConfig(), mockDb);

        await assert.rejects(
            () =>
                controller.signToken(makeRequest(), {
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    scope: 'readonly',
                    apps: ['app-1']
                }),
            (err: Error) => {
                assert.match(err.message, /Invalid API key/);
                return true;
            }
        );
    });

    it('rejects interactive scope with readonly key', async () => {
        const apiKeySvc = makeApiKeySvc({
            resolveApiKey: mock.fn(async () => ({
                keyId: 'key-1',
                scope: 'readonly' as const,
                appIds: []
            })) as unknown as ApiKeyService['resolveApiKey']
        });
        const controller = new ApiKeyController(apiKeySvc, makeConfig(), mockDb);

        await assert.rejects(
            () =>
                controller.signToken(makeRequest(), {
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    scope: 'interactive',
                    apps: ['app-1']
                }),
            (err: Error) => {
                assert.match(err.message, /Cannot sign interactive token with readonly key/);
                return true;
            }
        );
    });

    it('rejects empty apps when key is app-scoped', async () => {
        const apiKeySvc = makeApiKeySvc({
            resolveApiKey: mock.fn(async () => ({
                keyId: 'key-1',
                scope: 'interactive' as const,
                appIds: ['allowed-app']
            })) as unknown as ApiKeyService['resolveApiKey']
        });
        const controller = new ApiKeyController(apiKeySvc, makeConfig(), mockDb);

        await assert.rejects(
            () =>
                controller.signToken(makeRequest(), {
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    scope: 'readonly',
                    apps: []
                }),
            (err: Error) => {
                assert.match(err.message, /Apps must be specified/);
                return true;
            }
        );
    });

    it('rejects when app is not allowed for the key', async () => {
        const apiKeySvc = makeApiKeySvc({
            resolveApiKey: mock.fn(async () => ({
                keyId: 'key-1',
                scope: 'interactive' as const,
                appIds: ['allowed-app']
            })) as unknown as ApiKeyService['resolveApiKey']
        });
        const controller = new ApiKeyController(apiKeySvc, makeConfig(), mockDb);

        await assert.rejects(
            () =>
                controller.signToken(makeRequest(), {
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    scope: 'readonly',
                    apps: ['forbidden-app']
                }),
            (err: Error) => {
                assert.match(err.message, /not allowed for this key/);
                return true;
            }
        );
    });
});
