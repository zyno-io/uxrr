import { describe, it, expect, vi } from 'vitest';

import { FlushCoordinator } from '../transport/flush';

describe('FlushCoordinator', () => {
    it('registers beforeunload and visibilitychange handlers', () => {
        const addWindowListener = vi.spyOn(window, 'addEventListener');
        const addDocListener = vi.spyOn(document, 'addEventListener');

        const coord = new FlushCoordinator();
        coord.register(vi.fn());

        expect(addWindowListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        expect(addDocListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

        addWindowListener.mockRestore();
        addDocListener.mockRestore();
    });

    it('calls registered function on beforeunload', () => {
        const fn = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn);

        window.dispatchEvent(new Event('beforeunload'));

        expect(fn).toHaveBeenCalledOnce();
    });

    it('calls registered function on visibilitychange to hidden', () => {
        const fn = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn);

        // Simulate visibilitychange to hidden
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            writable: true,
            configurable: true
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(fn).toHaveBeenCalledOnce();
    });

    it('does not flush on visibilitychange to visible', () => {
        const fn = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn);

        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            writable: true,
            configurable: true
        });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(fn).not.toHaveBeenCalled();
    });

    it('unregister removes function from flush list', () => {
        const fn = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn);
        coord.unregister(fn);

        window.dispatchEvent(new Event('beforeunload'));

        expect(fn).not.toHaveBeenCalled();
    });

    it('flushAsync calls all registered functions', async () => {
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn1);
        coord.register(fn2);

        await coord.flushAsync();

        expect(fn1).toHaveBeenCalledOnce();
        expect(fn2).toHaveBeenCalledOnce();
    });

    it('continues flushing even if one function throws', () => {
        const fn1 = vi.fn(() => {
            throw new Error('oops');
        });
        const fn2 = vi.fn();
        const coord = new FlushCoordinator();
        coord.register(fn1);
        coord.register(fn2);

        window.dispatchEvent(new Event('beforeunload'));

        expect(fn1).toHaveBeenCalledOnce();
        expect(fn2).toHaveBeenCalledOnce();
    });
});
