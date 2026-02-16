import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationLogger } from '../logging/navigation';
import type { IngestBuffer } from '../transport/ingest-buffer';

describe('NavigationLogger', () => {
    beforeEach(() => {
        history.replaceState({}, '', '/');
    });

    it('logs initial URL on start', () => {
        history.replaceState({}, '', '/init');
        const pushLog = vi.fn();
        const logger = new NavigationLogger({ pushLog } as unknown as IngestBuffer);

        logger.start();

        expect(pushLog).toHaveBeenCalledTimes(1);
        expect(pushLog).toHaveBeenCalledWith(
            expect.objectContaining({
                c: 'uxrr:navigation',
                d: expect.objectContaining({
                    source: 'init',
                    url: expect.stringContaining('/init')
                })
            })
        );

        logger.stop();
    });

    it('logs URL changes from history navigation', () => {
        const pushLog = vi.fn();
        const logger = new NavigationLogger({ pushLog } as unknown as IngestBuffer);

        logger.start();
        history.pushState({}, '', '/products?tab=all');
        history.replaceState({}, '', '/products?tab=sale');

        expect(pushLog).toHaveBeenCalledTimes(3);

        const pushStateLog = pushLog.mock.calls[1]![0];
        expect(pushStateLog.d).toMatchObject({
            source: 'pushState',
            toUrl: expect.stringContaining('/products?tab=all')
        });

        const replaceStateLog = pushLog.mock.calls[2]![0];
        expect(replaceStateLog.d).toMatchObject({
            source: 'replaceState',
            toUrl: expect.stringContaining('/products?tab=sale')
        });

        logger.stop();
    });

    it('stops logging after stop() and restores history methods', () => {
        const pushLog = vi.fn();
        const logger = new NavigationLogger({ pushLog } as unknown as IngestBuffer);

        logger.start();
        logger.stop();

        const callsBefore = pushLog.mock.calls.length;
        history.pushState({}, '', '/after-stop');

        expect(pushLog).toHaveBeenCalledTimes(callsBefore);
    });
});
