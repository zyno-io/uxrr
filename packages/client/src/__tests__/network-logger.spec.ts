import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkLogger } from '../tracing/network-logger';
import type { IngestBuffer } from '../transport/ingest-buffer';
import type { UxrrConfig } from '../types';

// Mock @opentelemetry/api
vi.mock('@opentelemetry/api', () => ({
    trace: {
        getActiveSpan: vi.fn(() => undefined)
    }
}));

function makeIngestBuffer() {
    return {
        pushLog: vi.fn()
    } as unknown as IngestBuffer;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
        appId: 'test-app',
        endpoint: 'https://uxrr.example.com/v1/ng',
        tracing: {
            ignoreUrls: [],
            includeRequestHeaders: 'never' as const,
            includeRequestBody: 'never' as const,
            includeResponseHeaders: 'never' as const,
            includeResponseBody: 'never' as const,
            ...overrides.tracing
        },
        logging: {},
        ...overrides
    } as unknown as UxrrConfig;
}

describe('NetworkLogger', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = vi.fn(async () => new Response('OK', { status: 200 })) as unknown as typeof globalThis.fetch;
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    describe('fetch wrapping', () => {
        it('replaces globalThis.fetch', () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());
            expect(globalThis.fetch).not.toBe(originalFetch);
            logger.restore();
        });

        it('restores original fetch on restore()', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());
            const wrappedFetch = globalThis.fetch;
            logger.restore();
            // After restore, fetch should no longer be the wrapped version
            expect(globalThis.fetch).not.toBe(wrappedFetch);
            // And calling fetch should no longer push logs
            buf.pushLog.mockClear();
            await globalThis.fetch('https://api.example.com/test');
            expect(buf.pushLog).not.toHaveBeenCalled();
        });
    });

    describe('URL ignoring', () => {
        it('ignores requests to the configured endpoint', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://uxrr.example.com/v1/ng/app-1/sess-1/data');
            expect(buf.pushLog).not.toHaveBeenCalled();

            logger.restore();
        });

        it('ignores URLs matching ignoreUrls strings', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { ignoreUrls: ['analytics.example.com'] }
                })
            );

            await globalThis.fetch('https://analytics.example.com/track');
            expect(buf.pushLog).not.toHaveBeenCalled();

            logger.restore();
        });

        it('ignores URLs matching ignoreUrls regex', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { ignoreUrls: [/\.gif$/] }
                })
            );

            await globalThis.fetch('https://cdn.example.com/pixel.gif');
            expect(buf.pushLog).not.toHaveBeenCalled();

            logger.restore();
        });

        it('does not ignore non-matching URLs', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/users');
            expect(buf.pushLog).toHaveBeenCalled();

            logger.restore();
        });
    });

    describe('log entry', () => {
        it('pushes log with method, url, status, duration', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/users');

            expect(buf.pushLog).toHaveBeenCalledTimes(1);
            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.c).toBe('uxrr:net');
            expect(logEntry.m).toBe('GET https://api.example.com/users');
            expect(logEntry.d.method).toBe('GET');
            expect(logEntry.d.url).toBe('https://api.example.com/users');
            expect(logEntry.d.status).toBe(200);
            expect(typeof logEntry.d.duration).toBe('number');

            logger.restore();
        });

        it('uses method from init', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/users', { method: 'POST' });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.method).toBe('POST');

            logger.restore();
        });

        it('extracts method from Request object', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            const request = new Request('https://api.example.com/users', { method: 'PUT' });
            await globalThis.fetch(request);

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.method).toBe('PUT');

            logger.restore();
        });

        it('sets error log level for 4xx/5xx responses', async () => {
            globalThis.fetch = originalFetch;
            const mockFetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
            globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/missing');

            const logEntry = buf.pushLog.mock.calls[0][0];
            // v=3 for errors (warn level)
            expect(logEntry.v).toBe(3);

            logger.restore();
        });

        it('sets debug log level for 2xx responses', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/users');

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.v).toBe(0);

            logger.restore();
        });
    });

    describe('fetch error handling', () => {
        it('logs and rethrows on fetch failure', async () => {
            globalThis.fetch = originalFetch;
            const mockFetch = vi.fn(async () => {
                throw new Error('Network error');
            });
            globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await expect(globalThis.fetch('https://api.example.com/fail')).rejects.toThrow('Network error');
            expect(buf.pushLog).toHaveBeenCalledTimes(1);
            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.status).toBe(0);

            logger.restore();
        });
    });

    describe('header capture', () => {
        it('captures request headers in always mode', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestHeaders: 'always' }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' }
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestHeaders).toBeDefined();
            expect(logEntry.d.requestHeaders['Content-Type']).toBe('application/json');
            expect(logEntry.d.requestHeaders['X-Custom']).toBe('value');

            logger.restore();
        });

        it('redacts sensitive headers by default', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestHeaders: 'always' }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                headers: { Authorization: 'Bearer secret', 'X-Custom': 'ok' }
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestHeaders['Authorization']).toBe('[redacted]');
            expect(logEntry.d.requestHeaders['X-Custom']).toBe('ok');

            logger.restore();
        });

        it('does not capture headers in never mode', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestHeaders: 'never' }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                headers: { 'Content-Type': 'application/json' }
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestHeaders).toBeUndefined();

            logger.restore();
        });

        it('captures headers only on error in onError mode', async () => {
            globalThis.fetch = originalFetch;
            const mockFetch = vi.fn(async () => new Response('OK', { status: 200 }));
            globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestHeaders: 'onError' }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                headers: { 'Content-Type': 'application/json' }
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestHeaders).toBeUndefined();

            logger.restore();
        });
    });

    describe('body capture', () => {
        it('captures request body in always mode', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestBody: 'always' }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                method: 'POST',
                body: '{"name":"Alice"}'
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestBody).toBe('{"name":"Alice"}');

            logger.restore();
        });

        it('truncates large bodies', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: { includeRequestBody: 'always' }
                })
            );

            const bigBody = 'x'.repeat(20 * 1024);
            await globalThis.fetch('https://api.example.com/users', {
                method: 'POST',
                body: bigBody
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestBody.length).toBeLessThan(bigBody.length);
            expect(logEntry.d.requestBody).toContain('[truncated]');

            logger.restore();
        });
    });

    describe('console prefix', () => {
        it('uses custom console prefix', async () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    logging: { consolePrefix: 'myapp' }
                })
            );

            await globalThis.fetch('https://api.example.com/users');

            expect(consoleSpy).toHaveBeenCalledWith('[myapp:uxrr:net]', expect.any(String));

            consoleSpy.mockRestore();
            logger.restore();
        });

        it('uses default prefix when no custom prefix', async () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(buf, makeConfig());

            await globalThis.fetch('https://api.example.com/users');

            expect(consoleSpy).toHaveBeenCalledWith('[uxrr:net]', expect.any(String));

            consoleSpy.mockRestore();
            logger.restore();
        });
    });

    describe('authorization header inclusion', () => {
        it('does not redact Authorization when includeAuthorizationInHeader is true', async () => {
            const buf = makeIngestBuffer();
            const logger = new NetworkLogger(
                buf,
                makeConfig({
                    tracing: {
                        includeRequestHeaders: 'always',
                        includeAuthorizationInHeader: true
                    }
                })
            );

            await globalThis.fetch('https://api.example.com/users', {
                headers: { Authorization: 'Bearer token123' }
            });

            const logEntry = buf.pushLog.mock.calls[0][0];
            expect(logEntry.d.requestHeaders['Authorization']).toBe('Bearer token123');

            logger.restore();
        });
    });
});
