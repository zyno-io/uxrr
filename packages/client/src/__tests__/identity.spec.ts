import { describe, it, expect, beforeEach } from 'vitest';

import { IdentityManager } from '../identity';

describe('IdentityManager', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('generates deviceId on first access and persists to localStorage', () => {
        const mgr = new IdentityManager();

        expect(mgr.deviceId).toBeTruthy();
        expect(mgr.deviceId).toMatch(/^[0-9a-f-]{36}$/);
        expect(localStorage.getItem('uxrr:deviceId')).toBe(mgr.deviceId);
    });

    it('returns existing deviceId from localStorage', () => {
        localStorage.setItem('uxrr:deviceId', 'existing-device-id');

        const mgr = new IdentityManager();

        expect(mgr.deviceId).toBe('existing-device-id');
    });

    it('respects custom deviceIdPrefix', () => {
        const mgr = new IdentityManager();
        const rawId = mgr.deviceId;

        mgr.identify({ deviceIdPrefix: 'pfx-' });

        expect(mgr.deviceId).toBe('pfx-' + rawId);
    });

    it('respects custom deviceId override', () => {
        const mgr = new IdentityManager();

        mgr.identify({ deviceId: 'custom-id' });

        expect(mgr.deviceId).toBe('custom-id');
        expect(localStorage.getItem('uxrr:deviceId')).toBe('custom-id');
    });

    it('custom deviceId ignores prefix', () => {
        const mgr = new IdentityManager();

        mgr.identify({ deviceIdPrefix: 'pfx-', deviceId: 'custom-id' });

        // Custom deviceId takes precedence, prefix is not applied
        expect(mgr.deviceId).toBe('custom-id');
    });

    it('identify sets userId, userName, userEmail', () => {
        const mgr = new IdentityManager();

        mgr.identify({
            userId: 'u-1',
            userName: 'Alice',
            userEmail: 'alice@example.com'
        });

        expect(mgr.userId).toBe('u-1');

        const payload = mgr.toPayload();
        expect(payload.userId).toBe('u-1');
        expect(payload.userName).toBe('Alice');
        expect(payload.userEmail).toBe('alice@example.com');
    });

    it('toPayload returns correct shape', () => {
        const mgr = new IdentityManager();
        mgr.identify({ userId: 'u-1', userName: 'Bob', userEmail: 'bob@example.com' });

        const payload = mgr.toPayload();

        expect(payload).toEqual({
            deviceId: expect.any(String),
            userId: 'u-1',
            userName: 'Bob',
            userEmail: 'bob@example.com'
        });
    });

    it('toSpanAttributes returns OTel attributes', () => {
        const mgr = new IdentityManager();
        mgr.identify({ userId: 'u-1' });

        const attrs = mgr.toSpanAttributes();

        expect(attrs['uxrr.did']).toBe(mgr.deviceId);
        expect(attrs['uxrr.uid']).toBe('u-1');
    });

    it('toSpanAttributes omits userId when not set', () => {
        const mgr = new IdentityManager();

        const attrs = mgr.toSpanAttributes();

        expect(attrs['uxrr.did']).toBe(mgr.deviceId);
        expect(attrs).not.toHaveProperty('uxrr.uid');
    });
});
