import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import type { ISession } from '@/openapi-client-generated';
import { useSessionDetail, type SessionDetailReturn } from '@/composables/useSessionDetail';
import type { LiveStreamCallbacks, LiveStreamHandle } from '@/live-stream';

vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} })
}));

function flushPromises(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function makeSession(): ISession {
    return {
        id: 'sess-1',
        appId: 'app-1',
        startedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
        isLive: true,
        hasChatMessages: false
    } as unknown as ISession;
}

describe('useSessionDetail live reconnect', () => {
    it('restarts live mode when client reconnects after disconnect', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 2 }]);
        await flushPromises();

        expect(state.isLive.value).toBe(true);
        expect(state.livePlayerReady.value).toBe(true);
        expect(state.liveStatus.value).toBe('live');

        callbacks.onClientDisconnected();

        expect(state.isLive.value).toBe(false);
        expect(state.clientConnected.value).toBe(false);
        expect(state.liveStatus.value).toBe('ended');

        callbacks.onClientConnected();
        await flushPromises();

        expect(state.isLive.value).toBe(true);
        expect(state.clientConnected.value).toBe(true);
        expect(state.livePlayerReady.value).toBe(false);
        expect(state.liveStatus.value).toBe('syncing');

        wrapper.unmount();
    });

    it('becomes live again after full snapshot arrives post-reconnect', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 2 }]);
        callbacks.onClientDisconnected();
        callbacks.onClientConnected();
        await flushPromises();

        expect(state.liveStatus.value).toBe('syncing');
        expect(state.livePlayerReady.value).toBe(false);

        callbacks.onEvents([{ type: 3 }]);
        await flushPromises();
        expect(state.livePlayerReady.value).toBe(false);
        expect(state.liveStatus.value).toBe('syncing');

        callbacks.onEvents([{ type: 2 }]);
        await flushPromises();
        expect(state.livePlayerReady.value).toBe(true);
        expect(state.liveStatus.value).toBe('live');

        wrapper.unmount();
    });

    it('re-mounts from latest meta + first full snapshot when pre-snapshot events are buffered', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;
        const mountSpy = vi.fn();
        const addEventSpy = vi.fn();

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                state.playerRef.value = {
                    mount: mountSpy,
                    addEvent: addEventSpy
                } as unknown as SessionDetailReturn['playerRef']['value'];
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        callbacks.onClientConnected();
        callbacks.onEvents([
            { type: 3, data: { source: 0 } },
            { type: 4, data: { width: 1280, height: 720 } },
            { type: 2 },
            { type: 3, data: { source: 0 } }
        ]);
        await flushPromises();

        expect(state.livePlayerReady.value).toBe(true);
        expect(mountSpy).toHaveBeenCalledTimes(1);
        expect(mountSpy.mock.calls[0]![0]).toEqual([
            { type: 4, data: { width: 1280, height: 720 } },
            { type: 2 },
            { type: 3, data: { source: 0 } }
        ]);
        expect(addEventSpy).not.toHaveBeenCalled();

        wrapper.unmount();
    });

    it('remounts on reconnect snapshot when a timeline already exists', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;
        const mountSpy = vi.fn();
        const addEventSpy = vi.fn();

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                state.playerRef.value = {
                    mount: mountSpy,
                    addEvent: addEventSpy
                } as unknown as SessionDetailReturn['playerRef']['value'];
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        // Initial bootstrap: mounts player from the first full snapshot.
        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
        await flushPromises();
        expect(mountSpy).toHaveBeenCalledTimes(1);

        // Reconnect bootstrap: should remount to ensure fresh player state (fixes black screen bug)
        callbacks.onClientDisconnected();
        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 4, data: { width: 1024, height: 768 } }, { type: 2 }]);
        await flushPromises();

        expect(mountSpy).toHaveBeenCalledTimes(2); // Initial mount + reconnect remount
        // After reconnection, we remount with the new snapshot instead of adding events
        expect(addEventSpy).not.toHaveBeenCalledWith({ type: 4, data: { width: 1024, height: 768 } });
        expect(addEventSpy).not.toHaveBeenCalledWith({ type: 2 });

        wrapper.unmount();
    });

    it('filters out FullSnapshot and Meta from live player but keeps incrementals', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;
        const mountSpy = vi.fn();
        const addEventSpy = vi.fn();

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                state.playerRef.value = {
                    mount: mountSpy,
                    addEvent: addEventSpy
                } as unknown as SessionDetailReturn['playerRef']['value'];
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        // Initial live baseline
        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
        await flushPromises();
        expect(mountSpy).toHaveBeenCalledTimes(1);

        // Snapshot refresh while still connected (e.g. another viewer joins
        // and server sends request_snapshot). rrweb's Replayer.addEvent()
        // cannot handle FullSnapshot/Meta in live mode — they must be filtered.
        callbacks.onEvents([
            { type: 4, data: { width: 1024, height: 768 } },
            { type: 2 },
            { type: 3, data: { source: 0 } }
        ]);
        await flushPromises();

        expect(mountSpy).toHaveBeenCalledTimes(1);
        expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 0 } });
        expect(addEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 2 }));
        expect(addEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 4 }));
        expect(state.livePlayerReady.value).toBe(true);

        wrapper.unmount();
    });

    it('filters duplicate snapshot bursts while already live', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;
        const mountSpy = vi.fn();
        const addEventSpy = vi.fn();

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: vi.fn(),
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                state.playerRef.value = {
                    mount: mountSpy,
                    addEvent: addEventSpy
                } as unknown as SessionDetailReturn['playerRef']['value'];
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        callbacks.onClientConnected();
        callbacks.onEvents([{ type: 4, data: { width: 800, height: 600 } }, { type: 2 }]);
        await flushPromises();
        expect(mountSpy).toHaveBeenCalledTimes(1);

        // Multiple snapshot bursts (e.g. several viewers join quickly)
        callbacks.onEvents([{ type: 4, data: { width: 1024, height: 768 } }, { type: 2 }]);
        callbacks.onEvents([{ type: 4, data: { width: 1280, height: 720 } }, { type: 2 }]);
        callbacks.onEvents([{ type: 3, data: { source: 0 } }]);
        await flushPromises();

        expect(mountSpy).toHaveBeenCalledTimes(1);
        expect(addEventSpy).toHaveBeenCalledWith({ type: 3, data: { source: 0 } });
        expect(addEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 2 }));
        expect(state.livePlayerReady.value).toBe(true);

        wrapper.unmount();
    });

    it('buffers pre-connect snapshots and mounts only after client_connected', async () => {
        let state!: SessionDetailReturn;
        let callbacks!: LiveStreamCallbacks;
        const mountSpy = vi.fn();
        const addEventSpy = vi.fn();
        const sendSpy = vi.fn();

        const connectLive = vi.fn((cb: LiveStreamCallbacks): LiveStreamHandle => {
            callbacks = cb;
            return {
                send: sendSpy,
                disconnect: vi.fn()
            };
        });

        const TestHost = defineComponent({
            setup() {
                state = useSessionDetail({
                    loggerScope: 'use-session-detail-test',
                    loadSession: async () => makeSession(),
                    loadEvents: async () => [],
                    loadLogs: async () => [],
                    connectLive
                });
                state.playerRef.value = {
                    mount: mountSpy,
                    addEvent: addEventSpy
                } as unknown as SessionDetailReturn['playerRef']['value'];
                return () => h('div');
            }
        });

        const wrapper = mount(TestHost);
        await flushPromises();

        // Full snapshot arrives before client_connected signal.
        callbacks.onEvents([{ type: 4, data: { width: 1200, height: 800 } }, { type: 2 }]);
        expect(mountSpy).toHaveBeenCalledTimes(0);
        expect(state.livePlayerReady.value).toBe(false);

        callbacks.onClientConnected();
        await flushPromises();

        expect(mountSpy).toHaveBeenCalledTimes(1);
        expect(mountSpy.mock.calls[0]![0]).toEqual([{ type: 4, data: { width: 1200, height: 800 } }, { type: 2 }]);
        expect(state.livePlayerReady.value).toBe(true);
        // Buffered snapshot should be used; no extra snapshot request needed.
        expect(sendSpy).not.toHaveBeenCalledWith({ type: 'request_snapshot' });

        wrapper.unmount();
    });
});
