import { describe, it, expect, vi } from 'vitest';
import { useLivePlayerController, type PlayerHandle } from '@/composables/useLivePlayerController';

vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} })
}));

function createController() {
    const controller = useLivePlayerController('test');
    const mountSpy = vi.fn<PlayerHandle['mount']>().mockResolvedValue(undefined);
    const addEventSpy = vi.fn();
    const player: PlayerHandle = {
        mount: mountSpy,
        addEvent: addEventSpy
    };
    controller.bindPlayer(player);
    return { controller, mountSpy, addEventSpy };
}

/** Flush pending microtasks (Promise .then callbacks). */
async function flushMicrotasks(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('useLivePlayerController', () => {
    describe('initial mount', () => {
        it('buffers events and mounts after client connects', async () => {
            const { controller, mountSpy } = createController();

            controller.onEvents([
                { type: 4, data: { width: 1024, height: 768 } },
                { type: 2 }
            ]);
            expect(mountSpy).not.toHaveBeenCalled();
            expect(controller.ready.value).toBe(false);

            controller.onClientConnected();
            expect(mountSpy).toHaveBeenCalledTimes(1);
            // ready becomes true after async mount resolves
            await flushMicrotasks();
            expect(controller.ready.value).toBe(true);
            expect(controller.state.value).toBe('live');
        });

        it('mounts immediately when snapshot arrives after client already connected', async () => {
            const { controller, mountSpy } = createController();

            controller.onClientConnected();
            expect(controller.state.value).toBe('syncing');

            controller.onEvents([
                { type: 4, data: { width: 1024, height: 768 } },
                { type: 2 }
            ]);
            expect(mountSpy).toHaveBeenCalledTimes(1);
            await flushMicrotasks();
            expect(controller.ready.value).toBe(true);
            expect(controller.state.value).toBe('live');
        });

        it('uses latest Meta when Meta and FullSnapshot arrive in separate batches', async () => {
            const { controller, mountSpy } = createController();

            controller.onClientConnected();

            // Meta arrives first (separate WS message)
            controller.onEvents([{ type: 4, data: { width: 1280, height: 720 }, timestamp: 1000 }]);
            expect(mountSpy).not.toHaveBeenCalled();

            // FullSnapshot arrives second
            controller.onEvents([{ type: 2, timestamp: 1001 }]);
            expect(mountSpy).toHaveBeenCalledTimes(1);

            const mountEvents = mountSpy.mock.calls[0]![0] as Array<{ type: number }>;
            expect(mountEvents[0]).toMatchObject({ type: 4, data: { width: 1280, height: 720 } });
            expect(mountEvents[1]).toMatchObject({ type: 2 });
        });

        it('drains events buffered during async mount', async () => {
            const { controller, mountSpy, addEventSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([
                { type: 4, data: { width: 800, height: 600 } },
                { type: 2 }
            ]);
            expect(mountSpy).toHaveBeenCalledTimes(1);

            // Events arrive while mount is still async (ready is false)
            controller.onEvents([{ type: 3, data: { source: 0 } }]);
            controller.onEvents([{ type: 3, data: { source: 1 } }]);
            expect(addEventSpy).not.toHaveBeenCalled(); // still mounting

            // Mount completes — buffered events are drained
            await flushMicrotasks();
            expect(controller.ready.value).toBe(true);
            expect(addEventSpy).toHaveBeenCalledTimes(2);
            expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 0 } });
            expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 1 } });
        });

        it('filters FullSnapshot and Meta from drain buffer', async () => {
            const { controller, mountSpy, addEventSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);

            // Snapshot burst arrives during async mount
            controller.onEvents([
                { type: 4, data: { width: 1024, height: 768 } },
                { type: 2 },
                { type: 3, data: { source: 5 } }
            ]);

            await flushMicrotasks();
            // Only incremental should be forwarded
            expect(addEventSpy).toHaveBeenCalledTimes(1);
            expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 5 } });
        });
    });

    describe('live event filtering (share viewer join scenario)', () => {
        it('filters FullSnapshot and Meta from addEvent when already live', async () => {
            const { controller, mountSpy, addEventSpy } = createController();

            // Bootstrap to live state
            controller.onClientConnected();
            controller.onEvents([
                { type: 4, data: { width: 800, height: 600 } },
                { type: 2 }
            ]);
            await flushMicrotasks();
            expect(mountSpy).toHaveBeenCalledTimes(1);
            expect(controller.state.value).toBe('live');

            // Simulate snapshot burst from request_snapshot (triggered by share viewer joining).
            // rrweb's Replayer.addEvent() cannot handle FullSnapshot — it tears down
            // the iframe DOM but fails to rebuild, producing a black screen.
            controller.onEvents([
                { type: 4, data: { width: 1024, height: 768 } },
                { type: 2 },
                { type: 3, data: { source: 0 } }
            ]);

            // Only incremental event should reach addEvent
            expect(addEventSpy).toHaveBeenCalledTimes(1);
            expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 0 } });
            // Should NOT remount — already live
            expect(mountSpy).toHaveBeenCalledTimes(1);
        });

        it('filters multiple snapshot bursts without disrupting live state', async () => {
            const { controller, mountSpy, addEventSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
            await flushMicrotasks();

            // Multiple viewers joining rapidly — each triggers a request_snapshot response
            controller.onEvents([{ type: 4, data: { width: 1024, height: 768 } }, { type: 2 }]);
            controller.onEvents([{ type: 4, data: { width: 1280, height: 720 } }, { type: 2 }]);
            controller.onEvents([{ type: 3, data: { source: 1 } }]);

            expect(mountSpy).toHaveBeenCalledTimes(1);
            expect(addEventSpy).toHaveBeenCalledTimes(1);
            expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 1 } });
            expect(controller.ready.value).toBe(true);
            expect(controller.state.value).toBe('live');
        });

        it('forwards incremental events normally when live', async () => {
            const { controller, addEventSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
            await flushMicrotasks();

            controller.onEvents([
                { type: 3, data: { source: 0 } },
                { type: 3, data: { source: 1 } },
                { type: 3, data: { source: 5 } }
            ]);

            expect(addEventSpy).toHaveBeenCalledTimes(3);
        });
    });

    describe('reconnection', () => {
        it('enters reconnecting state and remounts from new snapshot', async () => {
            const { controller, mountSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
            await flushMicrotasks();
            expect(mountSpy).toHaveBeenCalledTimes(1);

            controller.onClientDisconnected();
            expect(controller.state.value).toBe('ended');
            expect(controller.ready.value).toBe(false);

            controller.onClientConnected();
            expect(controller.state.value).toBe('reconnecting');

            controller.onEvents([{ type: 4, data: { width: 1024, height: 768 } }, { type: 2 }]);
            expect(mountSpy).toHaveBeenCalledTimes(2);
            await flushMicrotasks();
            expect(controller.state.value).toBe('live');
            expect(controller.ready.value).toBe(true);
        });

        it('stays in reconnecting until full snapshot arrives', async () => {
            const { controller, mountSpy } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
            await flushMicrotasks();
            controller.onClientDisconnected();
            controller.onClientConnected();

            // Incremental without snapshot — should not mount
            controller.onEvents([{ type: 3, data: { source: 0 } }]);
            expect(controller.ready.value).toBe(false);
            expect(controller.state.value).toBe('reconnecting');

            // Full snapshot arrives
            controller.onEvents([{ type: 2 }]);
            expect(mountSpy).toHaveBeenCalledTimes(2);
            await flushMicrotasks();
            expect(controller.ready.value).toBe(true);
        });
    });

    describe('reset', () => {
        it('returns to initial state', async () => {
            const { controller } = createController();

            controller.onClientConnected();
            controller.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
            await flushMicrotasks();

            controller.reset();
            expect(controller.state.value).toBe('connecting');
            expect(controller.ready.value).toBe(false);
            expect(controller.clientConnected.value).toBe(false);
            expect(controller.clientEverConnected.value).toBe(false);
        });
    });
});
