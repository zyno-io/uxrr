import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ScopedLogger } from '../logging/logger';
import type { IngestBuffer } from '../transport/ingest-buffer';

function makeBuffer() {
    return { pushLog: vi.fn() } as unknown as IngestBuffer;
}

describe('ScopedLogger', () => {
    beforeEach(() => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('log levels', () => {
        it('debug() pushes log with level 0', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'test', 'test', {});
            logger.debug('hello');
            expect(buf.pushLog).toHaveBeenCalledOnce();
            expect(buf.pushLog).toHaveBeenCalledWith(expect.objectContaining({ v: 0, m: 'hello' }));
        });

        it('info() pushes log with level 1', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'test', 'test', {});
            logger.info('hello');
            expect(buf.pushLog).toHaveBeenCalledWith(expect.objectContaining({ v: 1, m: 'hello' }));
        });

        it('warn() pushes log with level 2', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'test', 'test', {});
            logger.warn('hello');
            expect(buf.pushLog).toHaveBeenCalledWith(expect.objectContaining({ v: 2, m: 'hello' }));
        });

        it('error() pushes log with level 3', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'test', 'test', {});
            logger.error('hello');
            expect(buf.pushLog).toHaveBeenCalledWith(expect.objectContaining({ v: 3, m: 'hello' }));
        });
    });

    describe('log shape', () => {
        it('includes timestamp, scope, and message', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'auth', 'auth', {});
            logger.info('logged in');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.t).toBeTypeOf('number');
            expect(entry.c).toBe('auth');
            expect(entry.m).toBe('logged in');
        });

        it('merges extra args as data', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'auth', 'auth', {});
            logger.info('result', { userId: 'u1' });

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.d).toEqual({ userId: 'u1' });
        });

        it('includes scope data in every log entry', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'auth', 'auth', { env: 'test' });
            logger.info('msg');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.d).toEqual({ env: 'test' });
        });

        it('omits data when no scope data and no args', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'auth', 'auth', {});
            logger.info('simple msg');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.d).toBeUndefined();
        });
    });

    describe('console output', () => {
        // Note: ScopedLogger binds console methods at module load time via
        // console.debug.bind(console), so vi.spyOn after import can't intercept.
        // We verify console output doesn't throw and transport gets correct data.

        it('all log methods work without transport (console-only)', () => {
            const logger = new ScopedLogger(undefined, 'auth', 'MyApp:auth', {});
            expect(() => {
                logger.debug('d');
                logger.info('i');
                logger.warn('w');
                logger.error('e');
            }).not.toThrow();
        });

        it('extra args included in log entry as { args: [...] }', () => {
            const buf = makeBuffer();
            const logger = new ScopedLogger(buf, 'auth', 'auth', {});
            logger.info('msg', 'extra1', 'extra2');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.d).toEqual({ args: ['extra1', 'extra2'] });
        });
    });

    describe('console-only mode (no transport)', () => {
        it('does not throw when transport is undefined', () => {
            const logger = new ScopedLogger(undefined, 'auth', 'auth', {});
            expect(() => logger.info('hello')).not.toThrow();
        });
    });

    describe('createScoped', () => {
        it('creates child logger with combined scope', () => {
            const buf = makeBuffer();
            const parent = new ScopedLogger(buf, 'auth', 'App:auth', {});
            const child = parent.createScoped('session');
            child.info('msg');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.c).toBe('auth/session');
        });

        it('child merges parent scope data with own data', () => {
            const buf = makeBuffer();
            const parent = new ScopedLogger(buf, 'auth', 'auth', { env: 'prod' });
            const child = parent.createScoped('sub', { feature: 'login' });
            child.info('msg');

            const entry = (buf.pushLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(entry.d).toEqual({ env: 'prod', feature: 'login' });
        });
    });
});
