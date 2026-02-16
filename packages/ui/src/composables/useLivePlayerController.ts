import { ref } from 'vue';
import type { Ref } from 'vue';
import { createLogger } from '@/logger';

/**
 * Manages the rrweb live player lifecycle, solving three critical bugs:
 *
 * 1. No goto() in live mode — timestamps are compressed at mount time only,
 *    so rrweb's internal timer is never disrupted.
 * 2. Server-side snapshot caching delivers snapshots to all viewers (including
 *    shared viewers) without needing a send() round-trip.
 * 3. Event queue prevents silent drops during async player mount.
 *    Events that arrive while the player is mounting are queued and drained
 *    once the mount completes.
 */

export type LiveState = 'connecting' | 'waiting' | 'syncing' | 'live' | 'reconnecting' | 'ended';

export interface PlayerHandle {
    mount(events: unknown[]): Promise<void>;
    addEvent(event: unknown): void;
}

export interface LivePlayerController {
    /** Reactive live state. */
    state: Ref<LiveState>;

    /** True when the player is mounted and accepting events. */
    ready: Ref<boolean>;

    /** True if the client has ever connected (used for ended detection). */
    clientEverConnected: Ref<boolean>;

    /** True if the client is currently connected. */
    clientConnected: Ref<boolean>;

    /** Feed incoming rrweb events from the WebSocket. */
    onEvents(events: unknown[]): void;

    /** Called when the server signals client_connected. */
    onClientConnected(): void;

    /** Called when the server signals client_disconnected. */
    onClientDisconnected(): void;

    /** Bind the player handle (ReplayPlayer's exposed API). */
    bindPlayer(handle: PlayerHandle | undefined): void;

    /** Reset to initial state (e.g. on unmount or skip live). */
    reset(): void;
}

export function useLivePlayerController(loggerScope: string): LivePlayerController {
    const log = createLogger(loggerScope);

    const state = ref<LiveState>('connecting');
    const ready = ref(false);
    const clientEverConnected = ref(false);
    const clientConnected = ref(false);

    let player: PlayerHandle | undefined;
    let eventBuffer: unknown[] = [];
    let lastMetaEvent: unknown | undefined;
    let hasMountedTimeline = false;
    let mounting = false;
    let mountGeneration = 0;

    function bindPlayer(handle: PlayerHandle | undefined): void {
        player = handle ?? undefined;
    }

    // ── Snapshot extraction ─────────────────────────────────────────

    /**
     * Find the latest full snapshot (type 2) in a batch and return the mount
     * payload: [Meta?, FullSnapshot, ...trailing events].
     * Returns null if no full snapshot found.
     */
    function extractSnapshotPayload(events: unknown[]): { mountEvents: unknown[]; fullSnapshotIndex: number } | null {
        let snapshotIndex = -1;
        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i] as { type?: number } | undefined;
            if (ev?.type === 2) {
                snapshotIndex = i;
                break;
            }
        }
        if (snapshotIndex === -1) return null;

        const fullSnapshotEvent = events[snapshotIndex] as { timestamp?: number };
        const fullSnapshotTs = typeof fullSnapshotEvent?.timestamp === 'number' ? fullSnapshotEvent.timestamp : undefined;

        // Find Meta event (type 4) before the snapshot
        let metaEvent: unknown | undefined;
        for (let i = snapshotIndex - 1; i >= 0; i--) {
            const ev = events[i] as { type?: number } | undefined;
            if (ev?.type === 4) {
                metaEvent = ev;
                break;
            }
        }

        const baselineMeta = metaEvent ?? lastMetaEvent;
        const normalizedMeta = baselineMeta && fullSnapshotTs
            ? { ...(baselineMeta as Record<string, unknown>), timestamp: Math.min(
                typeof (baselineMeta as { timestamp?: unknown }).timestamp === 'number'
                    ? (baselineMeta as { timestamp: number }).timestamp
                    : fullSnapshotTs - 1,
                fullSnapshotTs - 1
            ) }
            : baselineMeta;

        const mountEvents = normalizedMeta
            ? [normalizedMeta, ...events.slice(snapshotIndex)]
            : events.slice(snapshotIndex);

        return { mountEvents, fullSnapshotIndex: snapshotIndex };
    }

    // ── Mount logic ─────────────────────────────────────────────────

    function tryMount(): void {
        if (ready.value || mounting || !clientConnected.value) return;
        if (!player) return;

        const payload = extractSnapshotPayload(eventBuffer);
        if (!payload) return;

        mounting = true;
        const gen = ++mountGeneration;
        log.log('mounting live player with', payload.mountEvents.length, 'events');

        // Clear consumed events; events arriving during the async mount will
        // be re-buffered (ready is still false) and drained after mount completes.
        eventBuffer = [];
        hasMountedTimeline = true;

        player.mount(payload.mountEvents).then(() => {
            if (gen !== mountGeneration) return; // superseded
            ready.value = true;
            state.value = 'live';
            mounting = false;
            drainBuffer();
        });
    }

    function remount(): void {
        if (mounting || !player) return;
        if (!clientConnected.value) return;

        const payload = extractSnapshotPayload(eventBuffer);
        if (!payload) return;

        mounting = true;
        const gen = ++mountGeneration;
        log.log('remounting live player after reconnect with', payload.mountEvents.length, 'events');

        eventBuffer = [];

        player.mount(payload.mountEvents).then(() => {
            if (gen !== mountGeneration) return;
            ready.value = true;
            state.value = 'live';
            mounting = false;
            drainBuffer();
        });
    }

    /** Forward buffered events that arrived during async mount. */
    function drainBuffer(): void {
        if (eventBuffer.length === 0 || !player) return;
        const pending = eventBuffer.splice(0);
        for (const event of pending) {
            const type = (event as { type?: number })?.type;
            if (type === 2 || type === 4) continue;
            player.addEvent(event);
        }
    }

    // ── Public API ──────────────────────────────────────────────────

    function onEvents(events: unknown[]): void {
        // Track meta events
        for (const event of events) {
            const ev = event as { type?: number } | undefined;
            if (ev?.type === 4) lastMetaEvent = event;
        }

        if (ready.value && player) {
            // Already live — forward only incremental events.
            // rrweb's Replayer.addEvent() does not support FullSnapshot (type 2)
            // or Meta (type 4) in live mode: it tears down the iframe DOM but
            // fails to rebuild, producing a black screen. These events only work
            // via the constructor path (i.e. mount() creating a new Replayer).
            for (const event of events) {
                const type = (event as { type?: number })?.type;
                if (type === 2 || type === 4) continue;
                player.addEvent(event);
            }
            return;
        }

        // Not ready — buffer and attempt mount
        eventBuffer.push(...events);

        if (state.value === 'reconnecting') {
            remount();
        } else {
            tryMount();
        }
    }

    function onClientConnected(): void {
        const wasDisconnected = !clientConnected.value;
        const isReconnect = wasDisconnected && clientEverConnected.value;

        clientConnected.value = true;
        clientEverConnected.value = true;

        if (isReconnect) {
            log.log('client reconnected — entering syncing state');
            ready.value = false;
            hasMountedTimeline = false;
            state.value = 'reconnecting';
            eventBuffer = [];

            // If there are already buffered events with a snapshot, try immediate remount
            // (Server sends cached snapshot with client_connected in many cases)
        } else {
            log.log('client connected');
            if (!ready.value) {
                state.value = 'syncing';
            }
            // Try to mount from any pre-buffered snapshot
            tryMount();
        }
    }

    function onClientDisconnected(): void {
        log.log('client disconnected');
        clientConnected.value = false;
        ready.value = false;
        state.value = 'ended';
        eventBuffer = [];
        ++mountGeneration; // invalidate any pending async mount
        mounting = false;
    }

    function reset(): void {
        state.value = 'connecting';
        ready.value = false;
        clientConnected.value = false;
        clientEverConnected.value = false;
        hasMountedTimeline = false;
        mounting = false;
        eventBuffer = [];
        lastMetaEvent = undefined;
    }

    return {
        state,
        ready,
        clientEverConnected,
        clientConnected,
        onEvents,
        onClientConnected,
        onClientDisconnected,
        bindPlayer,
        reset
    };
}
