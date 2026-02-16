import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { AppGuard, APP_KEY_KEY, APP_UUID_KEY, getAppKey } from '../src/middleware/origin.guard';
import type { AppResolverService } from '../src/services/app-resolver.service';
import type { ScopedLogger } from '@deepkit/logger';
import { validateSessionId } from '../src/util/validation';

const mockLogger = { warn: mock.fn() } as unknown as ScopedLogger;

function makeEvent(url: string, headers: Record<string, string> = {}) {
    const request = { url, headers } as Record<string | symbol, unknown>;
    return {
        sent: false,
        request
    } as unknown as Parameters<AppGuard['onController']>[0] & {
        sent: boolean;
        request: Record<string | symbol, unknown>;
    };
}

describe('AppGuard', () => {
    it('attaches resolved appKey from origin to request', async () => {
        const resolver = {
            resolveByOrigin: mock.fn(async (_origin: string) => ({ uuid: 'uuid-app-1', appKey: 'app-1' })),
            resolveByApiKey: mock.fn(async (_key: string) => undefined)
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-1/sess-1/data', { origin: 'https://example.com' });

        await guard.onController(event);
        assert.equal(event.request[APP_KEY_KEY], 'app-1');
        assert.equal(event.request[APP_UUID_KEY], 'uuid-app-1');
    });

    it('attaches resolved appKey from API key to request', async () => {
        const resolver = {
            resolveByOrigin: mock.fn(async (_origin: string) => undefined),
            resolveByApiKey: mock.fn(async (_key: string) => ({ uuid: 'uuid-app-2', appKey: 'app-2' }))
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-2/sess-1/data', { 'x-api-key': 'valid-key' });

        await guard.onController(event);
        assert.equal(event.request[APP_KEY_KEY], 'app-2');
        assert.equal(event.request[APP_UUID_KEY], 'uuid-app-2');
    });

    it('throws on unknown origin and no API key', async () => {
        const resolver = {
            resolveByOrigin: mock.fn(async (_origin: string) => undefined),
            resolveByApiKey: mock.fn(async (_key: string) => undefined)
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-1/sess-1/data', { origin: 'https://unknown.com' });

        await assert.rejects(
            () => guard.onController(event),
            (err: unknown) => {
                assert.match((err as Error).message, /Unregistered origin/);
                return true;
            }
        );
    });

    it('throws when no origin or API key provided', async () => {
        const resolver = {
            resolveByOrigin: mock.fn(async (_origin: string) => undefined),
            resolveByApiKey: mock.fn(async (_key: string) => undefined)
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-1/sess-1/data');

        await assert.rejects(
            () => guard.onController(event),
            (err: unknown) => {
                assert.match((err as Error).message, /Unregistered origin/);
                return true;
            }
        );
    });

    it('skips non-ingest URLs', async () => {
        const resolveByOriginFn = mock.fn(async (_origin: string) => undefined);
        const resolver = {
            resolveByOrigin: resolveByOriginFn,
            resolveByApiKey: mock.fn(async (_key: string) => undefined)
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/sessions', { origin: 'https://example.com' });

        // Should not throw — guard should skip non-ingest paths
        await guard.onController(event);
        assert.equal(resolveByOriginFn.mock.callCount(), 0);
    });

    it('skips already-sent events', async () => {
        const resolveByOriginFn = mock.fn(async (_origin: string) => undefined);
        const resolver = {
            resolveByOrigin: resolveByOriginFn,
            resolveByApiKey: mock.fn(async (_key: string) => undefined)
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-1/sess-1/data', { origin: 'https://example.com' });
        event.sent = true;

        await guard.onController(event);
        assert.equal(resolveByOriginFn.mock.callCount(), 0);
    });

    it('prefers origin over API key when both present', async () => {
        const resolveOriginFn = mock.fn(async (_origin: string) => ({ uuid: 'uuid-origin', appKey: 'app-from-origin' }));
        const resolver = {
            resolveByOrigin: resolveOriginFn,
            resolveByApiKey: mock.fn(async (_key: string) => ({ uuid: 'uuid-key', appKey: 'app-from-key' }))
        } as unknown as AppResolverService;

        const guard = new AppGuard(resolver, mockLogger);
        const event = makeEvent('/v1/ng/app-1/sess-1/data', {
            origin: 'https://example.com',
            'x-api-key': 'valid-key'
        });

        await guard.onController(event);
        assert.equal(event.request[APP_KEY_KEY], 'app-from-origin');
        assert.equal(event.request[APP_UUID_KEY], 'uuid-origin');
        assert.equal(resolveOriginFn.mock.callCount(), 1);
    });
});

describe('getAppKey', () => {
    it('returns appKey from request', () => {
        const request = { [APP_KEY_KEY]: 'app-1' } as unknown as Parameters<typeof getAppKey>[0];
        assert.equal(getAppKey(request), 'app-1');
    });
});

describe('validateSessionId', () => {
    it('accepts valid UUIDv4', () => {
        assert.doesNotThrow(() => validateSessionId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'));
    });

    it('accepts uppercase UUID', () => {
        assert.doesNotThrow(() => validateSessionId('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'));
    });

    it('rejects empty string', () => {
        assert.throws(() => validateSessionId(''), /Invalid session ID/);
    });

    it('rejects path traversal attempt', () => {
        assert.throws(() => validateSessionId('../../../etc/passwd'), /Invalid session ID/);
    });

    it('rejects non-UUID string', () => {
        assert.throws(() => validateSessionId('not-a-uuid'), /Invalid session ID/);
    });

    it('rejects UUID without hyphens', () => {
        assert.throws(() => validateSessionId('a1b2c3d4e5f67890abcdef1234567890'), /Invalid session ID/);
    });
});
