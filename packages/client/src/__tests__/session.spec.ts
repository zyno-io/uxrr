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
});
