import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IdleMonitor } from '../idle-monitor';

describe('IdleMonitor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires onIdle after timeout expires', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        vi.advanceTimersByTime(4999);
        expect(onIdle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onIdle).toHaveBeenCalledOnce();
        expect(onDeIdle).not.toHaveBeenCalled();
    });

    it('does NOT re-arm after firing (no infinite session creation)', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        // First timeout fires
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledOnce();

        // Wait another full timeout period — should NOT fire again
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledOnce();

        // Wait a long time — still no re-fire
        vi.advanceTimersByTime(50000);
        expect(onIdle).toHaveBeenCalledOnce();
    });

    it('fires onDeIdle when activity resumes after idle', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        // Go idle
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledOnce();

        // Simulate user activity
        document.dispatchEvent(new MouseEvent('mousedown'));

        expect(onDeIdle).toHaveBeenCalledOnce();
    });

    it('resets timer on user activity before timeout', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        // At 3s, user does something
        vi.advanceTimersByTime(3000);
        document.dispatchEvent(new MouseEvent('mousedown'));

        // At 7s (4s after activity) — should not have fired
        vi.advanceTimersByTime(4000);
        expect(onIdle).not.toHaveBeenCalled();

        // At 8s (5s after activity) — should fire
        vi.advanceTimersByTime(1000);
        expect(onIdle).toHaveBeenCalledOnce();
    });

    it('does not fire onDeIdle for activity when not idle', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        // User is active before timeout
        vi.advanceTimersByTime(2000);
        document.dispatchEvent(new MouseEvent('mousedown'));

        expect(onDeIdle).not.toHaveBeenCalled();
    });

    it('re-arms timer after de-idle, allowing idle to fire again', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        // First idle cycle
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledOnce();

        // Resume activity
        document.dispatchEvent(new MouseEvent('mousedown'));
        expect(onDeIdle).toHaveBeenCalledOnce();

        // Second idle cycle
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledTimes(2);

        // Resume again
        document.dispatchEvent(new MouseEvent('mousedown'));
        expect(onDeIdle).toHaveBeenCalledTimes(2);
    });

    it('updateTimeout changes the timeout duration', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        const monitor = new IdleMonitor(5000, onIdle, onDeIdle);

        monitor.updateTimeout(2000);

        vi.advanceTimersByTime(2000);
        expect(onIdle).toHaveBeenCalledOnce();
    });

    it('updateTimeout does not re-arm when already idle', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        const monitor = new IdleMonitor(5000, onIdle, onDeIdle);

        // Go idle
        vi.advanceTimersByTime(5000);
        expect(onIdle).toHaveBeenCalledOnce();

        // Update timeout while idle — should NOT start a new timer
        monitor.updateTimeout(1000);

        vi.advanceTimersByTime(1000);
        expect(onIdle).toHaveBeenCalledOnce(); // still just once

        // Activity resumes — now the new timeout should take effect
        document.dispatchEvent(new MouseEvent('mousedown'));
        vi.advanceTimersByTime(1000);
        expect(onIdle).toHaveBeenCalledTimes(2);
    });

    it('stop() removes listeners and clears timer', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        const monitor = new IdleMonitor(5000, onIdle, onDeIdle);

        monitor.stop();

        vi.advanceTimersByTime(10000);
        expect(onIdle).not.toHaveBeenCalled();

        // Activity after stop should not trigger onDeIdle
        document.dispatchEvent(new MouseEvent('mousedown'));
        expect(onDeIdle).not.toHaveBeenCalled();
    });

    it('responds to all tracked event types', () => {
        const onIdle = vi.fn();
        const onDeIdle = vi.fn();
        new IdleMonitor(5000, onIdle, onDeIdle);

        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'pointerdown'];

        for (const eventType of events) {
            vi.advanceTimersByTime(5000);
            expect(onIdle).toHaveBeenCalled();
            onIdle.mockClear();

            document.dispatchEvent(new Event(eventType));
            expect(onDeIdle).toHaveBeenCalled();
            onDeIdle.mockClear();
        }
    });
});
