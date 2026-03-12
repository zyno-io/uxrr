import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { eventWithTime } from '@rrweb/types';

import { IngestBuffer, type LogEntry } from '../transport/ingest-buffer';
import type { HttpTransport, PostResult } from '../transport/http';
import type { IdentityManager } from '../identity';
import type { SupportConnection } from '../support/connection';
import type { UxrrConfig } from '../types';

function makeEvent(ts = Date.now()): eventWithTime {
    return { type: 3, data: {}, timestamp: ts } as eventWithTime;
}

function makeLog(ts = Date.now()): LogEntry {
    return { t: ts, v: 1, c: 'test', m: 'hello' };
}

function makeIdentity(): IdentityManager {
    return {
        toPayload: vi.fn(() => ({
            deviceId: 'dev-1',
            userId: 'user-1'
        }))
    } as unknown as IdentityManager;
}

function makeTransport(postResult: PostResult = { ok: true }): HttpTransport {
    return {
        postJSON: vi.fn(async () => postResult),
        sendBeacon: vi.fn(() => true)
    } as unknown as HttpTransport;
}

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        endpoint: 'http://localhost:3100',
        appKey: 'test-app',
        ...overrides
    } as UxrrConfig;
}

function makeSupportConnection(connected = true): SupportConnection {
    return {
        isConnected: connected,
        sendEvents: vi.fn(),
        sendLogs: vi.fn(),
        upgrade: vi.fn()
    } as unknown as SupportConnection;
}

describe('IngestBuffer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('pushEvent adds events to queue', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent());
        buffer.pushEvent(makeEvent());

        // flush to verify events were queued
        buffer.flush();

        expect(transport.postJSON).toHaveBeenCalledOnce();
        const payload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.events).toHaveLength(2);
    });

    it('auto-flushes at eventBufferSize (50) threshold', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        for (let i = 0; i < 50; i++) {
            buffer.pushEvent(makeEvent());
        }

        expect(transport.postJSON).toHaveBeenCalledOnce();
    });

    it('timer-based flush fires at flushInterval (5s)', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent());

        expect(transport.postJSON).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5_000);

        expect(transport.postJSON).toHaveBeenCalledOnce();

        // suppress stop() beacon
        buffer.stop();
    });

    it('pushLog adds logs to queue', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushLog(makeLog());
        buffer.pushLog(makeLog());

        buffer.flush();

        expect(transport.postJSON).toHaveBeenCalledOnce();
        const payload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.logs).toHaveLength(2);
    });

    it('log queue drops oldest when exceeding maxLogQueue (1500)', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        for (let i = 0; i < 1600; i++) {
            buffer.pushLog({ t: i, v: 1, c: 'test', m: `msg-${i}` });
        }

        buffer.flush();

        const payload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
        const logs = payload.logs as LogEntry[];
        expect(logs).toHaveLength(1500);
        // oldest (first 100) should have been dropped; first remaining should be t=100
        expect(logs[0].t).toBe(100);
    });

    it('event queue overflow (>500) triggers flush + sets needsFullSnapshot', async () => {
        // Make the first postJSON hang so events accumulate past 500
        let resolveFirst!: (v: PostResult) => void;
        const transport = {
            postJSON: vi.fn(
                () =>
                    new Promise<PostResult>(r => {
                        resolveFirst = r;
                    })
            ),
            sendBeacon: vi.fn(() => true)
        } as unknown as HttpTransport;

        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
        const snapshotCb = vi.fn();
        buffer.onNeedFullSnapshot = snapshotCb;

        // First 50 events trigger a flush that hangs (isFlushing = true)
        for (let i = 0; i < 50; i++) {
            buffer.pushEvent(makeEvent());
        }
        expect(transport.postJSON).toHaveBeenCalledOnce();

        // Push 500 more — at 500 accumulated, overflow fires (needsFullSnapshot = true)
        for (let i = 0; i < 500; i++) {
            buffer.pushEvent(makeEvent());
        }

        // Resolve the original flush so handleFlushSuccess sees needsFullSnapshot
        (transport.postJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
        resolveFirst({ ok: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(snapshotCb).toHaveBeenCalled();
    });

    it('flush sends correct payload shape to transport', () => {
        const identity = makeIdentity();
        const transport = makeTransport();
        const buffer = new IngestBuffer(
            transport,
            identity,
            12345,
            makeConfig({
                version: '1.0.0',
                environment: 'test'
            })
        );

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());
        buffer.flush();

        expect(transport.postJSON).toHaveBeenCalledWith(
            'data',
            expect.objectContaining({
                identity: { deviceId: 'dev-1', userId: 'user-1' },
                meta: expect.objectContaining({
                    version: '1.0.0',
                    environment: 'test'
                }),
                launchTs: 12345,
                events: expect.any(Array),
                logs: expect.any(Array)
            })
        );
    });

    it('flush is no-op when already flushing', () => {
        // Make postJSON hang (never resolve) to keep isFlushing true
        const transport = {
            postJSON: vi.fn(() => new Promise<PostResult>(() => {})),
            sendBeacon: vi.fn(() => true)
        } as unknown as HttpTransport;

        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent());
        buffer.flush(); // starts flushing

        buffer.pushEvent(makeEvent());
        buffer.flush(); // should be no-op since still flushing

        expect(transport.postJSON).toHaveBeenCalledOnce();
    });

    it('flush is no-op when queues are empty', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.flush();

        expect(transport.postJSON).not.toHaveBeenCalled();
    });

    it('handleFlushSuccess clears queues', async () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());
        buffer.flush();

        // wait for postJSON promise to resolve
        await vi.advanceTimersByTimeAsync(0);

        // flushing again should be no-op since queues were cleared
        buffer.flush();
        expect(transport.postJSON).toHaveBeenCalledOnce();
    });

    it('failed flush re-queues events (up to 3 consecutive failures)', async () => {
        const transport = makeTransport({ ok: false });
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent(1));
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        // events should be re-queued; flush again to verify
        buffer.flush();
        expect(transport.postJSON).toHaveBeenCalledTimes(2);
        const secondPayload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<string, unknown>;
        expect((secondPayload.events as eventWithTime[]).length).toBeGreaterThanOrEqual(1);
    });

    it('after 3 consecutive failures, events dropped + needsFullSnapshot', async () => {
        const transport = makeTransport({ ok: false });
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        const snapshotCb = vi.fn();
        buffer.onNeedFullSnapshot = snapshotCb;

        // 3 consecutive failures
        for (let i = 0; i < 3; i++) {
            buffer.pushEvent(makeEvent(i));
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);
        }

        // After 3rd failure, events should be dropped
        // Next successful flush will trigger snapshot callback
        (transport.postJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
        buffer.pushEvent(makeEvent(99));
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        expect(snapshotCb).toHaveBeenCalled();
    });

    it('failed flush re-queues logs', async () => {
        const transport = makeTransport({ ok: false });
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushLog(makeLog(1));
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        // logs should be re-queued; flush again to verify
        buffer.flush();
        expect(transport.postJSON).toHaveBeenCalledTimes(2);
        const secondPayload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<string, unknown>;
        expect((secondPayload.logs as LogEntry[]).length).toBeGreaterThanOrEqual(1);
    });

    it('consecutiveFailures resets on success', async () => {
        let callCount = 0;
        const transport = {
            postJSON: vi.fn(async (): Promise<PostResult> => {
                callCount++;
                return callCount <= 2 ? { ok: false } : { ok: true };
            }),
            sendBeacon: vi.fn(() => true)
        } as unknown as HttpTransport;

        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        // 2 failures
        buffer.pushEvent(makeEvent(1));
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        // 3rd call succeeds — events should not be dropped
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        // If consecutiveFailures didn't reset, the next failure would be the 3rd
        // and events would be dropped. Let's verify they aren't by failing again.
        (transport.postJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
        buffer.pushEvent(makeEvent(2));
        buffer.flush();
        await vi.advanceTimersByTimeAsync(0);

        // Should still re-queue (only 1 failure since counter reset)
        buffer.flush();
        const lastPayload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.lastCall![1] as Record<string, unknown>;
        expect(lastPayload.events).toBeDefined();
    });

    it('setLiveMode(true) disables timer, pushes via WebSocket immediately', () => {
        const transport = makeTransport();
        const conn = makeSupportConnection(true);
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
        buffer.setSupportConnection(conn);

        buffer.setLiveMode(true);

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());

        // Should send via WS, not HTTP
        expect(conn.sendEvents).toHaveBeenCalledOnce();
        expect(conn.sendLogs).toHaveBeenCalledOnce();
        expect(transport.postJSON).not.toHaveBeenCalled();

        // Timer should be disabled — advancing should not trigger flush
        vi.advanceTimersByTime(10_000);
        expect(transport.postJSON).not.toHaveBeenCalled();
    });

    it('flush sends via WebSocket when connection is active', () => {
        const transport = makeTransport();
        const conn = makeSupportConnection(true);
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
        buffer.setSupportConnection(conn);

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());
        buffer.flush();

        expect(conn.sendEvents).toHaveBeenCalledOnce();
        expect(conn.sendLogs).toHaveBeenCalledOnce();
        expect(transport.postJSON).not.toHaveBeenCalled();
    });

    it('stop clears timer and flushes remaining via beacon', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());
        buffer.stop();

        expect(transport.sendBeacon).toHaveBeenCalledOnce();

        // Timer should be dead — advancing should not trigger flush
        vi.advanceTimersByTime(10_000);
        expect(transport.postJSON).not.toHaveBeenCalled();
    });

    it('flushBeacon uses sendBeacon API', () => {
        const transport = makeTransport();
        const identity = makeIdentity();
        const buffer = new IngestBuffer(transport, identity, 1000, makeConfig());

        buffer.pushEvent(makeEvent());
        buffer.pushLog(makeLog());
        buffer.flushBeacon();

        expect(transport.sendBeacon).toHaveBeenCalledWith(
            'data',
            expect.objectContaining({
                identity: expect.any(Object),
                events: expect.any(Array),
                logs: expect.any(Array)
            })
        );
    });

    it('flushBeacon is no-op when queues are empty', () => {
        const transport = makeTransport();
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

        buffer.flushBeacon();

        expect(transport.sendBeacon).not.toHaveBeenCalled();
    });

    it('successful flush with ws flag triggers connection upgrade', async () => {
        const transport = makeTransport({ ok: true, ws: true });
        const conn = makeSupportConnection(false); // not yet connected
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
        buffer.setSupportConnection(conn);

        buffer.pushEvent(makeEvent());
        buffer.flush();

        await vi.advanceTimersByTimeAsync(0);

        expect(conn.upgrade).toHaveBeenCalledOnce();
    });

    describe('HTTP 413 handling', () => {
        it('splits events and logs into separate requests on 413', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            // First call: combined payload → 413
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 });
            // Second call: events-only → success
            postJSONFn.mockResolvedValueOnce({ ok: true });
            // Third call: logs-only → success
            postJSONFn.mockResolvedValueOnce({ ok: true });

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.pushEvent(makeEvent());
            buffer.pushLog(makeLog());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            // Let the split async function run
            await vi.advanceTimersByTimeAsync(0);

            expect(postJSONFn).toHaveBeenCalledTimes(3);
            // Second call should have events but not logs
            const eventsPayload = postJSONFn.mock.calls[1][1] as Record<string, unknown>;
            expect(eventsPayload.events).toBeDefined();
            expect(eventsPayload.logs).toBeUndefined();
            // Third call should have logs but not events
            const logsPayload = postJSONFn.mock.calls[2][1] as Record<string, unknown>;
            expect(logsPayload.logs).toBeDefined();
            expect(logsPayload.events).toBeUndefined();
        });

        it('drops events and sets needsFullSnapshot when events-only also returns 413', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // combined
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // events-only
            postJSONFn.mockResolvedValueOnce({ ok: true }); // logs-only

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
            const snapshotCb = vi.fn();
            buffer.onNeedFullSnapshot = snapshotCb;

            buffer.pushEvent(makeEvent());
            buffer.pushLog(makeLog());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(0);

            // Events dropped, logs succeeded
            expect(postJSONFn).toHaveBeenCalledTimes(3);

            // Trigger a success flush to fire the snapshot callback
            postJSONFn.mockResolvedValueOnce({ ok: true });
            buffer.pushEvent(makeEvent());
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);
            expect(snapshotCb).toHaveBeenCalled();
        });

        it('drops logs when logs-only also returns 413', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // combined
            postJSONFn.mockResolvedValueOnce({ ok: true }); // events-only
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // logs-only

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.pushLog(makeLog());
            buffer.pushEvent(makeEvent());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(0);

            // Should not have re-queued anything — next flush should be empty
            buffer.flush();
            // The third call was for logs-only 413, fourth call should not happen
            expect(postJSONFn).toHaveBeenCalledTimes(3);
        });
    });

    describe('HTTP 410 handling (session expired)', () => {
        it('fires onSessionExpired and drops data on 410', async () => {
            const transport = makeTransport({ ok: false, status: 410 });
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
            const expiredCb = vi.fn();
            buffer.onSessionExpired = expiredCb;

            buffer.pushEvent(makeEvent());
            buffer.pushLog(makeLog());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);

            expect(expiredCb).toHaveBeenCalledOnce();
            // Data should NOT be re-queued
            buffer.flush();
            expect(transport.postJSON).toHaveBeenCalledOnce(); // only the original call
        });

        it('fires onSessionExpired on 410 during split retry (events)', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // combined → split
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 410 }); // events-only → expired

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
            const expiredCb = vi.fn();
            buffer.onSessionExpired = expiredCb;

            buffer.pushEvent(makeEvent());
            buffer.pushLog(makeLog());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(0);

            expect(expiredCb).toHaveBeenCalledOnce();
            // Should NOT have attempted logs (early return after 410)
            expect(postJSONFn).toHaveBeenCalledTimes(2);
        });

        it('fires onSessionExpired on 410 during split retry (logs)', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // combined → split
            postJSONFn.mockResolvedValueOnce({ ok: true }); // events-only → ok
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 410 }); // logs-only → expired

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
            const expiredCb = vi.fn();
            buffer.onSessionExpired = expiredCb;

            buffer.pushEvent(makeEvent());
            buffer.pushLog(makeLog());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(0);

            expect(expiredCb).toHaveBeenCalledOnce();
        });
    });

    describe('session generation (prevents stale re-queuing)', () => {
        it('does not re-queue events after session rotation on failure', async () => {
            const transport = makeTransport({ ok: false, status: 500 });
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.pushEvent(makeEvent(1));
            buffer.flush();

            // Rotate session before the promise resolves
            buffer.resetSession(2000, 'old-session-id');

            await vi.advanceTimersByTimeAsync(0);

            // Events should NOT be re-queued (generation mismatch)
            // Push a new event and flush — should only see the new event
            (transport.postJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
            buffer.pushEvent(makeEvent(2));
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            const lastPayload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.lastCall![1] as Record<string, unknown>;
            const events = lastPayload.events as eventWithTime[];
            expect(events).toHaveLength(1);
            expect(events[0].timestamp).toBe(2);
        });

        it('does not re-queue logs after session rotation on failure', async () => {
            const transport = makeTransport({ ok: false, status: 500 });
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.pushLog(makeLog(1));
            buffer.flush();

            // Rotate session before the promise resolves
            buffer.resetSession(2000, 'old-session-id');

            await vi.advanceTimersByTimeAsync(0);

            // Logs should NOT be re-queued (generation mismatch)
            (transport.postJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
            buffer.pushLog(makeLog(2));
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            const lastPayload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.lastCall![1] as Record<string, unknown>;
            const logs = lastPayload.logs as LogEntry[];
            expect(logs).toHaveLength(1);
            expect(logs[0].t).toBe(2);
        });

        it('does not re-queue split retry data after session rotation', async () => {
            const postJSONFn = vi.fn<(path: string, body: unknown) => Promise<PostResult>>();
            postJSONFn.mockResolvedValueOnce({ ok: false, status: 413 }); // combined → split
            // events-only fails with generic error
            postJSONFn.mockImplementationOnce(async () => {
                // Simulate session rotation happening during the split
                buffer.resetSession(2000, 'old-session-id');
                return { ok: false, status: 500 };
            });
            postJSONFn.mockResolvedValueOnce({ ok: true }); // logs-only

            const transport = { postJSON: postJSONFn, sendBeacon: vi.fn(() => true) } as unknown as HttpTransport;
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.pushEvent(makeEvent(1));
            buffer.pushLog(makeLog(1));
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(0);

            // Events should NOT have been re-queued (generation changed)
            postJSONFn.mockResolvedValue({ ok: true });
            buffer.pushEvent(makeEvent(2));
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            const lastPayload = postJSONFn.mock.lastCall![1] as Record<string, unknown>;
            const events = lastPayload.events as eventWithTime[];
            expect(events).toHaveLength(1);
            expect(events[0].timestamp).toBe(2);
        });

        it('resetSession resets consecutiveFailures counter', async () => {
            const transport = makeTransport({ ok: false });
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
            const snapshotCb = vi.fn();
            buffer.onNeedFullSnapshot = snapshotCb;

            // 2 consecutive failures
            buffer.pushEvent(makeEvent());
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            // Reset session — counter should go back to 0
            buffer.resetSession(2000, 'old-id');

            // Next failure is only the 1st after reset, so events should be re-queued, not dropped
            buffer.pushEvent(makeEvent(99));
            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            buffer.flush();
            await vi.advanceTimersByTimeAsync(0);

            // Still on 2nd failure — events should still be in queue
            buffer.flush();
            expect(transport.postJSON).toHaveBeenCalledTimes(5); // original 2 + 3 after reset
        });

        it('resetSession updates launchTs and previousSessionId in payload', async () => {
            const transport = makeTransport();
            const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());

            buffer.resetSession(9999, 'prev-session-123');
            buffer.pushEvent(makeEvent());
            buffer.flush();

            await vi.advanceTimersByTimeAsync(0);

            const payload = (transport.postJSON as ReturnType<typeof vi.fn>).mock.lastCall![1] as Record<string, unknown>;
            expect(payload.launchTs).toBe(9999);
            expect(payload.previousSessionId).toBe('prev-session-123');
        });
    });

    it('successful flush with ws flag triggers connection upgrade', async () => {
        const transport = makeTransport({ ok: true, ws: true });
        const conn = makeSupportConnection(false); // not yet connected
        const buffer = new IngestBuffer(transport, makeIdentity(), 1000, makeConfig());
        buffer.setSupportConnection(conn);

        buffer.pushEvent(makeEvent());
        buffer.flush();

        await vi.advanceTimersByTimeAsync(0);

        expect(conn.upgrade).toHaveBeenCalledOnce();
    });
});
