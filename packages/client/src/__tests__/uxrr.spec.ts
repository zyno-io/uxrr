import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock rrweb and its plugin before importing anything
vi.mock('rrweb', () => {
    const record = vi.fn(() => vi.fn()) as ReturnType<typeof vi.fn> & { takeFullSnapshot: ReturnType<typeof vi.fn> };
    record.takeFullSnapshot = vi.fn();
    return { record };
});
vi.mock('@rrweb/rrweb-plugin-console-record', () => ({
    getRecordConsolePlugin: vi.fn(() => ({}))
}));

vi.mock('../recording/recorder', () => ({
    createRecorder: vi.fn(async () => ({
        takeFullSnapshot: vi.fn(),
        stop: vi.fn()
    }))
}));

// Mock the tracing provider to avoid OTel setup
vi.mock('../tracing/provider', () => {
    return {
        createTracingProvider: vi.fn(async () => ({
            tracer: {},
            shutdown: vi.fn()
        }))
    };
});

// Mock support connection
vi.mock('../support/connection', () => {
    return {
        SupportConnection: class MockSupportConnection {
            setOnLiveModeChange = vi.fn();
            setOnSnapshotRequested = vi.fn();
            updateSessionId = vi.fn();
            downgrade = vi.fn();
            setIngestBuffer = vi.fn();
            constructor(..._args: unknown[]) {}
        }
    };
});

import type { UxrrConfig } from '../types';

import { uxrr } from '../uxrr';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        endpoint: 'https://example.com',
        appKey: 'app-1',
        ...overrides
    };
}

function forceFreshSessionOnNextInit(): void {
    localStorage.setItem(
        `uxrr:sessionOwner:${uxrr.sessionId}`,
        JSON.stringify({
            instanceId: 'test-owner',
            ts: Date.now()
        })
    );
}

describe('UXRR', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sessionStorage.clear();
        localStorage.clear();
        vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        uxrr.stop();
        sessionStorage.clear();
        localStorage.clear();
        vi.mocked(navigator.sendBeacon).mockRestore();
        vi.mocked(console.debug).mockRestore();
        vi.mocked(console.log).mockRestore();
        vi.mocked(console.warn).mockRestore();
        vi.mocked(console.error).mockRestore();
        if (vi.isMockFunction(globalThis.fetch)) {
            vi.mocked(globalThis.fetch).mockRestore();
        }
        vi.useRealTimers();
    });

    describe('init()', () => {
        it('exposes sessionId after init', () => {
            uxrr.init(makeConfig());
            expect(uxrr.sessionId).toBeTruthy();
            expect(typeof uxrr.sessionId).toBe('string');
            uxrr.stop();
        });

        it('sessionId is a UUID format', () => {
            uxrr.init(makeConfig());
            expect(uxrr.sessionId).toMatch(/^[0-9a-f-]{36}$/);
            uxrr.stop();
        });

        it('rotates active sessions after maxSessionDuration', async () => {
            forceFreshSessionOnNextInit();
            uxrr.init(makeConfig({ maxSessionDuration: 5_000, enabled: { logging: false, tracing: false, support: false } }));
            const originalSessionId = uxrr.sessionId;

            await vi.advanceTimersByTimeAsync(5_000);

            expect(uxrr.sessionId).not.toBe(originalSessionId);
        });

        it('does not postpone maxSessionDuration when server config repeats', async () => {
            forceFreshSessionOnNextInit();
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(JSON.stringify({ ok: true, config: { maxSessionDuration: 10_000 } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            uxrr.init(
                makeConfig({
                    maxSessionDuration: 10_000,
                    logging: { flushInterval: 5_000 },
                    enabled: { tracing: false, support: false }
                })
            );
            const originalSessionId = uxrr.sessionId;

            uxrr.createLogger('test').info('queued before server config');
            await vi.advanceTimersByTimeAsync(5_000);
            expect(uxrr.sessionId).toBe(originalSessionId);

            await vi.advanceTimersByTimeAsync(4_999);
            expect(uxrr.sessionId).toBe(originalSessionId);

            await vi.advanceTimersByTimeAsync(1);
            expect(uxrr.sessionId).not.toBe(originalSessionId);
        });

        it('flushes queued data with the old session ID before max-duration rotation', async () => {
            forceFreshSessionOnNextInit();
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            );
            uxrr.init(
                makeConfig({
                    maxSessionDuration: 5_000,
                    logging: { flushInterval: 60_000 },
                    enabled: { tracing: false, support: false }
                })
            );
            const originalSessionId = uxrr.sessionId;

            uxrr.createLogger('test').info('queued before rotation');
            await vi.advanceTimersByTimeAsync(5_000);

            expect(uxrr.sessionId).not.toBe(originalSessionId);
            expect(navigator.sendBeacon).not.toHaveBeenCalled();
            expect(globalThis.fetch).toHaveBeenCalled();
            const flushUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
            expect(flushUrl).toContain(`/v1/ng/app-1/${originalSessionId}/data`);
            expect(flushUrl).not.toContain(`/v1/ng/app-1/${uxrr.sessionId}/data`);
        });

        it('keeps queued data and retries max-duration rotation when pre-rotation flush fails', async () => {
            forceFreshSessionOnNextInit();
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response('', { status: 500 }))
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({ ok: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    })
                );

            uxrr.init(
                makeConfig({
                    maxSessionDuration: 5_000,
                    logging: { flushInterval: 60_000 },
                    enabled: { tracing: false, support: false }
                })
            );
            const originalSessionId = uxrr.sessionId;

            uxrr.createLogger('test').info('queued before failed rotation');
            await vi.advanceTimersByTimeAsync(5_000);

            expect(uxrr.sessionId).toBe(originalSessionId);
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            expect(vi.mocked(globalThis.fetch).mock.calls[0]![0] as string).toContain(`/v1/ng/app-1/${originalSessionId}/data`);

            await vi.advanceTimersByTimeAsync(60_000);

            expect(uxrr.sessionId).not.toBe(originalSessionId);
            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
            expect(vi.mocked(globalThis.fetch).mock.calls[1]![0] as string).toContain(`/v1/ng/app-1/${originalSessionId}/data`);
            expect(navigator.sendBeacon).not.toHaveBeenCalled();
        });

        it('does not arm max-session rotation when configured as 0', () => {
            forceFreshSessionOnNextInit();
            uxrr.init(makeConfig({ maxSessionDuration: 0, enabled: { logging: false, tracing: false, support: false } }));
            const originalSessionId = uxrr.sessionId;

            vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);

            expect(uxrr.sessionId).toBe(originalSessionId);
        });

        it('rotates logging-only clients when /data expires server-side', async () => {
            forceFreshSessionOnNextInit();
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 410 }));

            uxrr.init(
                makeConfig({
                    logging: { flushInterval: 5_000 },
                    enabled: { sessions: false, tracing: false }
                })
            );
            const originalSessionId = uxrr.sessionId;

            uxrr.createLogger('test').info('logging only');
            await vi.advanceTimersByTimeAsync(5_000);

            expect(uxrr.sessionId).not.toBe(originalSessionId);
        });
    });

    describe('proxy singleton', () => {
        it('uxrr proxy exposes sessionId', () => {
            uxrr.init(makeConfig());
            expect(uxrr.sessionId).toBeTruthy();
            uxrr.stop();
        });

        it('uxrr proxy delegates identify()', () => {
            uxrr.init(makeConfig());
            // Should not throw
            expect(() => uxrr.identify({ userId: 'u1' })).not.toThrow();
            uxrr.stop();
        });
    });

    describe('identify()', () => {
        it('accepts identity before init', () => {
            // The proxy creates the instance lazily, so identify works even before init
            expect(() => uxrr.identify({ userId: 'u1', userName: 'Test User' })).not.toThrow();
        });
    });

    describe('createLogger()', () => {
        it('returns a logger with all level methods', () => {
            uxrr.init(makeConfig());
            const logger = uxrr.createLogger('test-scope');

            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.createScoped).toBe('function');
            uxrr.stop();
        });

        it('logger works end-to-end without throwing', () => {
            uxrr.init(makeConfig());
            const logger = uxrr.createLogger('myScope');
            expect(() => logger.info('test message')).not.toThrow();
            uxrr.stop();
        });

        it('createScoped returns a child logger', () => {
            uxrr.init(makeConfig());
            const logger = uxrr.createLogger('auth');
            const child = logger.createScoped('session');
            expect(() => child.info('msg')).not.toThrow();
            uxrr.stop();
        });
    });

    describe('stop()', () => {
        it('can be called multiple times without error', () => {
            uxrr.init(makeConfig());
            uxrr.stop();
            expect(() => uxrr.stop()).not.toThrow();
        });
    });

    describe('re-init', () => {
        it('tears down previous subsystems on re-init', () => {
            uxrr.init(makeConfig());
            // Re-init should not throw (internally calls stop then re-init)
            expect(() => uxrr.init(makeConfig())).not.toThrow();
            uxrr.stop();
        });
    });

    describe('selective feature enablement', () => {
        it('works with sessions disabled', () => {
            uxrr.init(makeConfig({ enabled: { sessions: false } }));
            expect(uxrr.sessionId).toBeTruthy();
            uxrr.stop();
        });

        it('works with tracing disabled', () => {
            uxrr.init(makeConfig({ enabled: { tracing: false } }));
            expect(uxrr.sessionId).toBeTruthy();
            uxrr.stop();
        });

        it('works with logging disabled', () => {
            uxrr.init(makeConfig({ enabled: { logging: false } }));
            expect(uxrr.sessionId).toBeTruthy();
            uxrr.stop();
        });
    });
});
