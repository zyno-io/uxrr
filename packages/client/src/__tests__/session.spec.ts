import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SessionManager } from '../session';

describe('SessionManager', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('reuses sessionId from sessionStorage across constructions', () => {
        const s1 = new SessionManager();
        const s2 = new SessionManager();

        expect(s1.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(s2.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(s1.sessionId).toBe(s2.sessionId);
    });

    it('stores sessionId in sessionStorage', () => {
        const mgr = new SessionManager();

        expect(sessionStorage.getItem('uxrr:sessionId')).toBe(mgr.sessionId);
    });

    it('sets launchTs to Date.now()', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        const mgr = new SessionManager();

        expect(mgr.launchTs).toBe(new Date('2025-06-15T12:00:00Z').getTime());

        vi.useRealTimers();
    });

    describe('reset()', () => {
        it('returns the old session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            const returned = mgr.reset();
            expect(returned).toBe(oldId);
        });

        it('generates a new session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();
            expect(mgr.sessionId).not.toBe(oldId);
            expect(mgr.sessionId).toMatch(/^[0-9a-f-]{36}$/);
        });

        it('sets previousSessionId to the old session ID', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();
            expect(mgr.previousSessionId).toBe(oldId);
        });

        it('updates launchTs', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
            const mgr = new SessionManager();

            vi.setSystemTime(new Date('2025-06-15T13:00:00Z'));
            mgr.reset();

            expect(mgr.launchTs).toBe(new Date('2025-06-15T13:00:00Z').getTime());
            vi.useRealTimers();
        });

        it('persists new session ID and previous session ID to sessionStorage', () => {
            const mgr = new SessionManager();
            const oldId = mgr.sessionId;
            mgr.reset();

            expect(sessionStorage.getItem('uxrr:sessionId')).toBe(mgr.sessionId);
            expect(sessionStorage.getItem('uxrr:previousSessionId')).toBe(oldId);
        });

        it('restores previousSessionId from sessionStorage on construction', () => {
            const mgr1 = new SessionManager();
            mgr1.reset();
            const expectedPrevious = mgr1.previousSessionId;

            const mgr2 = new SessionManager();
            expect(mgr2.previousSessionId).toBe(expectedPrevious);
        });
    });
});
