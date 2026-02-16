import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { ISession, ILogEntry } from '@/openapi-client-generated';
import type { ChatMessage } from '@/components/ChatPanel.vue';
import type { LiveStreamCallbacks, LiveStreamHandle } from '@/live-stream';
import ReplayPlayer from '@/components/ReplayPlayer.vue';
import { createLogger } from '@/logger';
import { useLivePlayerController } from './useLivePlayerController';
import type { LiveState } from './useLivePlayerController';

export interface SessionDetailOptions {
    loggerScope: string;
    loadSession: () => Promise<ISession>;
    loadEvents: (startChunk?: number, endChunk?: number) => Promise<any[]>;
    loadLogs: (since?: number) => Promise<ILogEntry[]>;
    loadChat?: () => Promise<ChatMessage[]>;
    connectLive: (callbacks: LiveStreamCallbacks) => LiveStreamHandle;
    interactive?: boolean;
    onAgentsUpdated?: (agents: any[]) => void;
    onPenStart?: (x: number, y: number) => void;
    onPenMove?: (x: number, y: number) => void;
    onPenEnd?: () => void;
}

export interface SessionDetailReturn {
    // State
    session: Ref<ISession | null>;
    logs: Ref<ILogEntry[]>;
    chatMessages: Ref<ChatMessage[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    currentTimeMs: Ref<number>;
    activeTab: Ref<'console' | 'network' | 'chat'>;
    isLive: Ref<boolean>;
    clientConnected: Ref<boolean>;
    chatStarted: Ref<boolean>;
    chatActive: Ref<boolean>;
    userTyping: Ref<boolean>;
    clientFocused: Ref<boolean>;
    hasControl: Ref<boolean>;

    // Layout
    layout: Ref<'right' | 'bottom'>;
    sidePaneSize: Ref<number>;
    isResizing: Ref<boolean>;

    // Refs
    playerRef: Ref<InstanceType<typeof ReplayPlayer> | undefined>;
    contentRef: Ref<HTMLDivElement | undefined>;

    // Computed
    sessionStartMs: ComputedRef<number>;
    consoleLogs: ComputedRef<ILogEntry[]>;
    networkLogs: ComputedRef<ILogEntry[]>;
    showChatTab: ComputedRef<boolean | undefined>;
    liveStatus: ComputedRef<'ended' | 'waiting' | 'syncing' | 'live' | null>;
    playbackTime: ComputedRef<Date | null>;
    livePlayerReady: Ref<boolean>;
    clientEverConnected: Ref<boolean>;
    eventLoadProgress: Ref<{ loaded: number; total: number } | null>;

    // Actions
    toggleLayout: () => void;
    startResize: (e: MouseEvent) => void;
    skipLive: () => Promise<void>;
    onTimeUpdate: (ms: number) => void;
    seekTo: (offsetMs: number) => void;
    formatLocal: (d: Date) => string;
    formatUtc: (d: Date) => string;
    formatMeta: (s: ISession) => string;

    // Live stream access for page-specific features
    getLiveStream: () => LiveStreamHandle | null;

    // Pen event handlers (for pages that support pen rendering)
    onPenStart: (x: number, y: number) => void;
    onPenMove: (x: number, y: number) => void;
    onPenEnd: () => void;
}

export function useSessionDetail(options: SessionDetailOptions): SessionDetailReturn {
    const log = createLogger(options.loggerScope);
    const lpc = useLivePlayerController(options.loggerScope + ':lpc');

    // ── State ─────────────────────────────────────────────────────
    const session = ref<ISession | null>(null);
    let loadedEvents: any[] = [];
    const firstEventTs = ref(0);
    const logs = ref<ILogEntry[]>([]);
    const chatMessages = ref<ChatMessage[]>([]);
    const loading = ref(true);
    const error = ref<string | null>(null);
    const currentTimeMs = ref(0);
    const activeTab = ref<'console' | 'network' | 'chat'>('console');
    const isLive = ref(false);
    const chatStarted = ref(false);
    const chatActive = ref(false);
    const userTyping = ref(false);
    let userTypingTimeout: ReturnType<typeof setTimeout> | null = null;
    const clientFocused = ref(true);
    const hasControl = ref(true);
    const eventLoadProgress = ref<{ loaded: number; total: number } | null>(null);

    // ── Layout ────────────────────────────────────────────────────
    const savedLayout = localStorage.getItem('uxrr:sidebar-layout') as 'right' | 'bottom' | null;
    const layout = ref<'right' | 'bottom'>(savedLayout === 'right' || savedLayout === 'bottom' ? savedLayout : 'right');
    const savedSize = localStorage.getItem(`uxrr:sidebar-size-${layout.value}`);
    const sidePaneSize = ref(savedSize ? parseInt(savedSize, 10) : layout.value === 'right' ? 420 : 300);
    const isResizing = ref(false);

    // ── Refs ──────────────────────────────────────────────────────
    const playerRef = ref<InstanceType<typeof ReplayPlayer>>();
    const contentRef = ref<HTMLDivElement>();
    let liveStream: LiveStreamHandle | null = null;

    // ── Layout actions ───────────────────────────────────────────
    function toggleLayout() {
        localStorage.setItem(`uxrr:sidebar-size-${layout.value}`, String(sidePaneSize.value));
        layout.value = layout.value === 'right' ? 'bottom' : 'right';
        localStorage.setItem('uxrr:sidebar-layout', layout.value);
        const saved = localStorage.getItem(`uxrr:sidebar-size-${layout.value}`);
        sidePaneSize.value = saved ? parseInt(saved, 10) : layout.value === 'right' ? 420 : 300;
    }

    function startResize(e: MouseEvent) {
        e.preventDefault();
        isResizing.value = true;
        const startPos = layout.value === 'right' ? e.clientX : e.clientY;
        const startSize = sidePaneSize.value;

        function onMove(ev: MouseEvent) {
            const contentEl = contentRef.value;
            if (!contentEl) return;

            if (layout.value === 'right') {
                const delta = startPos - ev.clientX;
                const maxW = contentEl.clientWidth - 200;
                sidePaneSize.value = Math.max(200, Math.min(maxW, startSize + delta));
            } else {
                const delta = startPos - ev.clientY;
                const maxH = contentEl.clientHeight - 200;
                sidePaneSize.value = Math.max(150, Math.min(maxH, startSize + delta));
            }
        }

        function onUp() {
            isResizing.value = false;
            localStorage.setItem(`uxrr:sidebar-size-${layout.value}`, String(sidePaneSize.value));
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // ── Computed ──────────────────────────────────────────────────
    const sessionStartMs = computed(() => {
        if (firstEventTs.value) return firstEventTs.value;
        if (!session.value) return 0;
        return new Date(session.value.startedAt).getTime();
    });

    const consoleLogs = computed(() => logs.value.filter(l => !!l));
    const networkLogs = computed(() => logs.value.filter(l => l && l.c === 'uxrr:net'));

    const showChatTab = computed(() => isLive.value || chatStarted.value || session.value?.hasChatMessages);

    const liveStatus = computed<'ended' | 'waiting' | 'syncing' | 'live' | null>(() => {
        const s = lpc.state.value as LiveState;
        if (s === 'ended') return 'ended';
        if (!isLive.value && lpc.clientEverConnected.value) return 'ended';
        if (!isLive.value) return null;
        if (s === 'connecting' || s === 'waiting' || !lpc.clientConnected.value) return 'waiting';
        if (s === 'syncing' || s === 'reconnecting') return 'syncing';
        if (s === 'live') return 'live';
        return null;
    });

    const playbackTime = computed(() => {
        if (!session.value || currentTimeMs.value === Number.MAX_SAFE_INTEGER) return null;
        return new Date(sessionStartMs.value + currentTimeMs.value);
    });

    // ── Chunked event loading ─────────────────────────────────────
    const CHUNK_BATCH_SIZE = 10;

    async function loadEventsChunked(): Promise<any[]> {
        const chunkCount = session.value?.eventChunkCount ?? 0;
        if (chunkCount === 0) {
            return options.loadEvents();
        }

        const totalChunks = chunkCount;
        eventLoadProgress.value = { loaded: 0, total: totalChunks };
        const allEvents: any[] = [];

        for (let start = 0; start < totalChunks; start += CHUNK_BATCH_SIZE) {
            const end = Math.min(start + CHUNK_BATCH_SIZE - 1, totalChunks - 1);
            const chunk = await options.loadEvents(start, end);
            allEvents.push(...chunk);
            eventLoadProgress.value = { loaded: end + 1, total: totalChunks };
        }

        eventLoadProgress.value = null;
        return allEvents;
    }

    function applyLoadedEvents(events: any[]) {
        loadedEvents = events;
        const firstEvent = loadedEvents.find(ev => ev && typeof ev.timestamp === 'number');
        if (firstEvent) {
            firstEventTs.value = firstEvent.timestamp;
        }
    }

    // ── Data loading ─────────────────────────────────────────────
    async function loadData() {
        log.log('loading session data');
        loading.value = true;
        error.value = null;
        try {
            // Step 1: Load session metadata first to check isLive
            const s = await options.loadSession();
            session.value = s;

            if (s.isLive) {
                // Live session: load only logs, skip events
                logs.value = await options.loadLogs();
                log.log('loaded session:', s.id, 'logs:', logs.value.length, 'isLive: true (events deferred)');

                if (s.hasChatMessages && options.loadChat) {
                    const messages = await options.loadChat();
                    chatMessages.value = messages;
                    chatStarted.value = true;
                    log.log('loaded chat messages:', chatMessages.value.length);
                }

                startLive();
            } else {
                // Non-live session: load events (chunked) + logs in parallel
                const [e, l] = await Promise.all([loadEventsChunked(), options.loadLogs()]);
                applyLoadedEvents(e);
                logs.value = l;
                log.log('loaded session:', s.id, 'events:', loadedEvents.length, 'logs:', logs.value.length, 'isLive: false');

                if (s.hasChatMessages && options.loadChat) {
                    const messages = await options.loadChat();
                    chatMessages.value = messages;
                    chatStarted.value = true;
                    log.log('loaded chat messages:', chatMessages.value.length);
                }
            }
        } catch (err: unknown) {
            log.error('failed to load session:', err);
            error.value = (err as Error).message ?? 'Failed to load session';
        } finally {
            loading.value = false;
        }

        if (loadedEvents.length > 0 && !isLive.value) {
            await nextTick();
            playerRef.value?.mount(loadedEvents);
            log.log('mounted replay player with', loadedEvents.length, 'events');
        }
    }

    // ── Log backfill ─────────────────────────────────────────────
    async function backfillLogs() {
        const existing = logs.value;
        const lastTs = existing.length > 0 ? Math.max(...existing.map(l => l.t)) : undefined;
        if (!lastTs) return;
        try {
            const gap = await options.loadLogs(lastTs);
            if (gap.length === 0) return;
            const seen = new Set(existing.map(l => `${l.t}|${l.c}|${l.m}`));
            const newLogs = gap.filter(l => !seen.has(`${l.t}|${l.c}|${l.m}`));
            if (newLogs.length > 0) {
                logs.value = [...existing, ...newLogs].sort((a, b) => a.t - b.t);
                log.log('backfilled', newLogs.length, 'logs');
            }
        } catch (err) {
            log.error('log backfill failed:', err);
        }
    }

    // ── Live stream ──────────────────────────────────────────────
    function startLive() {
        log.log('starting live mode');
        isLive.value = true;
        currentTimeMs.value = Number.MAX_SAFE_INTEGER;

        // Bind the player handle via optional chaining so LPC can proceed with
        // state transitions even before the component renders (playerRef may be undefined).
        lpc.bindPlayer({
            mount: (events: unknown[]) => playerRef.value?.mount(events as any[]) ?? Promise.resolve(),
            addEvent: (event: unknown) => playerRef.value?.addEvent(event as any)
        });

        liveStream = options.connectLive({
            onEvents(newEvents: any[]) {
                lpc.onEvents(newEvents);
            },
            onLogs(newLogs) {
                logs.value.push(...(newLogs as ILogEntry[]));
            },
            onChat(message, from) {
                chatStarted.value = true;
                if (options.interactive) chatActive.value = true;
                chatMessages.value.push({ message, from, timestamp: Date.now() });
                if (from === 'user') {
                    userTyping.value = false;
                    if (userTypingTimeout) clearTimeout(userTypingTimeout);
                }
            },
            onTyping() {
                if (!options.interactive) return;
                userTyping.value = true;
                if (userTypingTimeout) clearTimeout(userTypingTimeout);
                userTypingTimeout = setTimeout(() => {
                    userTyping.value = false;
                }, 3000);
            },
            onFocusChange(focused) {
                clientFocused.value = focused;
            },
            onClientConnected() {
                isLive.value = true;
                clientFocused.value = true;
                currentTimeMs.value = Number.MAX_SAFE_INTEGER;
                lpc.onClientConnected();
                backfillLogs();
            },
            onClientDisconnected() {
                log.log('client disconnected, ending live mode');
                isLive.value = false;
                lpc.onClientDisconnected();
            },
            onControlGranted() {
                hasControl.value = true;
            },
            onControlRevoked() {
                hasControl.value = false;
            },
            onAgentsUpdated(agents) {
                options.onAgentsUpdated?.(agents);
            },
            onChatStarted() {
                chatStarted.value = true;
                if (options.interactive) chatActive.value = true;
            },
            onChatEnded() {
                chatActive.value = false;
            },
            onPenStart(x, y) {
                options.onPenStart?.(x, y);
            },
            onPenMove(x, y) {
                options.onPenMove?.(x, y);
            },
            onPenEnd() {
                options.onPenEnd?.();
            }
        });
    }

    async function skipLive() {
        log.log('skipping live mode, disconnecting stream');
        liveStream?.disconnect();
        liveStream = null;
        isLive.value = false;
        lpc.reset();

        if (loadedEvents.length === 0) {
            log.log('loading events on demand');
            loading.value = true;
            try {
                const events = await loadEventsChunked();
                applyLoadedEvents(events);
                log.log('loaded', loadedEvents.length, 'events on demand');
            } catch (err: unknown) {
                log.error('failed to load events:', err);
                error.value = (err as Error).message ?? 'Failed to load events';
            } finally {
                loading.value = false;
            }
        }

        if (loadedEvents.length > 0) {
            await nextTick();
            playerRef.value?.mount(loadedEvents);
        }
    }

    // ── Player controls ──────────────────────────────────────────
    function onTimeUpdate(ms: number) {
        currentTimeMs.value = ms;
    }

    function seekTo(offsetMs: number) {
        playerRef.value?.seek(offsetMs);
    }

    // ── Formatting ───────────────────────────────────────────────
    function formatLocal(d: Date): string {
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatUtc(d: Date): string {
        return d.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'UTC'
        });
    }

    function formatMeta(s: ISession): string {
        const parts = [s.appId];
        if (s.version) parts.push(`v${s.version}`);
        if (s.environment) parts.push(s.environment);
        return parts.join(' / ');
    }

    // ── Pen event pass-through (for pages that handle rendering) ───
    function onPenStart(x: number, y: number): void {
        const local = playerRef.value?.toLocalCoords(x, y);
        if (local && options.onPenStart) {
            options.onPenStart(local.x, local.y);
        }
    }

    function onPenMove(x: number, y: number): void {
        const local = playerRef.value?.toLocalCoords(x, y);
        if (local && options.onPenMove) {
            options.onPenMove(local.x, local.y);
        }
    }

    function onPenEnd(): void {
        options.onPenEnd?.();
    }

    // ── Lifecycle ────────────────────────────────────────────────
    onMounted(() => {
        log.log('mounted');
        loadData();
    });

    onBeforeUnmount(() => {
        log.log('unmounting, disconnecting live stream');
        liveStream?.disconnect();
        liveStream = null;
    });

    return {
        session,
        logs,
        chatMessages,
        loading,
        error,
        currentTimeMs,
        activeTab,
        isLive,
        clientConnected: lpc.clientConnected,
        chatStarted,
        chatActive,
        userTyping,
        clientFocused,
        hasControl,
        layout,
        sidePaneSize,
        isResizing,
        playerRef,
        contentRef,
        sessionStartMs,
        consoleLogs,
        networkLogs,
        showChatTab,
        liveStatus,
        playbackTime,
        livePlayerReady: lpc.ready,
        clientEverConnected: lpc.clientEverConnected,
        eventLoadProgress,
        toggleLayout,
        startResize,
        skipLive,
        onTimeUpdate,
        seekTo,
        formatLocal,
        formatUtc,
        formatMeta,
        getLiveStream: () => liveStream,
        onPenStart,
        onPenMove,
        onPenEnd
    };
}
