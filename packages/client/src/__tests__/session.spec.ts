import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { SessionManager } from '../session';

describe('SessionManager', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reuses sessionId from sessionStorage across constructions', () => {
        const s1 = new SessionManager();
        const s2 = new SessionManager();

        expect(s1.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(s2.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(s1.sessionId).toBe(s2.sessionId);

        s1.stop();
        s2.stop();
    });

    it('stores sessionId in sessionStorage', () => {
        const mgr = new SessionManager();

        expect(sessionStorage.getItem('uxrr:sessionId')).toBe(mgr.sessionId);

        mgr.stop();
    });

    it('sets launchTs to Date.now()', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        const mgr = new SessionManager();

        expect(mgr.launchTs).toBe(new Date('2025-06-15T12:00:00Z').getTime());

        mgr.stop();
    });

    describe('reset()', () => {
        it('returns the old session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            const returned = mgr.reset();
            expect(returned).toBe(oldId);
            mgr.stop();
        });

        it('generates a new session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();
            expect(mgr.sessionId).not.toBe(oldId);
            expect(mgr.sessionId).toMatch(/^[0-9a-f-]{36}$/);
            mgr.stop();
        });

        it('sets previousSessionId to the old session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();
            expect(mgr.previousSessionId).toBe(oldId);
            mgr.stop();
        });

        it('updates launchTs', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
            const mgr = new SessionManager();

            vi.setSystemTime(new Date('2025-06-15T13:00:00Z'));
            mgr.reset();

            expect(mgr.launchTs).toBe(new Date('2025-06-15T13:00:00Z').getTime());
            mgr.stop();
        });

        it('persists new session ID and previous session ID to sessionStorage', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();

            expect(sessionStorage.getItem('uxrr:sessionId')).toBe(mgr.sessionId);
            expect(sessionStorage.getItem('uxrr:previousSessionId')).toBe(oldId);
            mgr.stop();
        });

        it('restores previousSessionId from sessionStorage on construction', () => {
            const mgr1 = new SessionManager();
            mgr1.reset();
            const expectedPrevious = mgr1.previousSessionId;

            const mgr2 = new SessionManager();
            expect(mgr2.previousSessionId).toBe(expectedPrevious);
            mgr1.stop();
            mgr2.stop();
        });
    });

    describe('duplicate tab detection', () => {
        it('detects duplicate session and resets when another tab responds', async () => {
            // First tab - the "original"
            const mgr1 = new SessionManager();
            const originalSessionId = mgr1.sessionId;

            // Simulate a duplicate tab scenario: mgr2 loads with the same sessionStorage
            // (In real browser, window.open copies sessionStorage)
            const mgr2 = new SessionManager();

            // Both should initially have the same session ID
            expect(mgr2.sessionId).toBe(originalSessionId);

            // Wait for BroadcastChannel messages to propagate
            await new Promise(r => setTimeout(r, 150));

            // The duplicate (mgr2) should have detected the conflict and reset
            expect(mgr2.sessionId).not.toBe(originalSessionId);
            expect(mgr2.previousSessionId).toBe(originalSessionId);

            // Original should still have the same session ID
            expect(mgr1.sessionId).toBe(originalSessionId);

            mgr1.stop();
            mgr2.stop();
        });

        it('calls onSessionReset callback when duplicate is detected', async () => {
            const mgr1 = new SessionManager();
            const originalSessionId = mgr1.sessionId;

            const mgr2 = new SessionManager();
            const resetCallback = vi.fn();
            mgr2.setOnSessionReset(resetCallback);

            await new Promise(r => setTimeout(r, 150));

            expect(resetCallback).toHaveBeenCalledTimes(1);
            expect(mgr2.sessionId).not.toBe(originalSessionId);

            mgr1.stop();
            mgr2.stop();
        });

        it('does not trigger reset for fresh session (no existing sessionStorage)', async () => {
            const resetCallback = vi.fn();
            const mgr = new SessionManager();
            mgr.setOnSessionReset(resetCallback);

            await new Promise(r => setTimeout(r, 150));

            expect(resetCallback).not.toHaveBeenCalled();

            mgr.stop();
        });

        it('responds to session checks from other tabs', async () => {
            const mgr = new SessionManager();
            const sessionId = mgr.sessionId;

            // Simulate another tab asking if this session ID is in use
            const testChannel = new BroadcastChannel('uxrr:session');
            const responsePromise = new Promise<boolean>(resolve => {
                testChannel.onmessage = e => {
                    if (e.data?.type === 'session-in-use' && e.data.sessionId === sessionId) {
                        resolve(true);
                    }
                };
                setTimeout(() => resolve(false), 150);
            });

            testChannel.postMessage({ type: 'session-check', sessionId });

            const gotResponse = await responsePromise;
            expect(gotResponse).toBe(true);

            testChannel.close();
            mgr.stop();
        });
    });
});
