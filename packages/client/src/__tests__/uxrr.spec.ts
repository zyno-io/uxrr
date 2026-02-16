import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock rrweb and its plugin before importing anything
vi.mock('rrweb', () => ({
    record: vi.fn(() => vi.fn()) // returns a stopFn
}));
vi.mock('@rrweb/rrweb-plugin-console-record', () => ({
    getRecordConsolePlugin: vi.fn(() => ({}))
}));

// Mock the tracing provider to avoid OTel setup
vi.mock('../tracing/provider', () => {
    return {
        TracingProvider: class MockTracingProvider {
            tracer = {};
            shutdown = vi.fn();
            constructor(..._args: unknown[]) {}
        }
    };
});

// Mock support connection
vi.mock('../support/connection', () => {
    return {
        SupportConnection: class MockSupportConnection {
            setOnLiveModeChange = vi.fn();
            setOnSnapshotRequested = vi.fn();
            downgrade = vi.fn();
            setIngestBuffer = vi.fn();
            constructor(..._args: unknown[]) {}
        }
    };
});

import { uxrr } from '../uxrr';
import type { UxrrConfig } from '../types';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        endpoint: 'https://example.com',
        appId: 'app-1',
        ...overrides
    };
}

describe('UXRR', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
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
