<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import type { eventWithTime } from '@rrweb/types';
import { createLogger } from '@/logger';
import {
    splitIntoSegments,
    padSegmentEvents,
    filterValidEvents,
    findSegmentForTime
} from './replay-segments';
import type { Segment } from './replay-segments';

const log = createLogger('player');

interface RRWebPlayer {
    $set(props: Record<string, unknown>): void;
    triggerResize(): void;
    $destroy(): void;
    getReplayer(): { addEvent(event: eventWithTime): void; getCurrentTime?(): number };
    goto(timeOffset: number, play: boolean): void;
}

const props = defineProps<{
    liveMode?: boolean;
}>();

const emit = defineEmits<{
    timeUpdate: [timeMs: number];
    interact: [
        type: 'click' | 'mousedown' | 'mousemove' | 'mouseup',
        viewportX: number,
        viewportY: number,
        localX: number,
        localY: number
    ];
    interactEnd: [];
}>();

const containerRef = ref<HTMLDivElement>();
let player: RRWebPlayer | null = null;
let timeInterval: ReturnType<typeof setInterval> | undefined;
let resizeObserver: ResizeObserver | undefined;
let metaWidth = 0;
let metaHeight = 0;
let mountToken = 0;

// Segment-based replay state (see replay-segments.ts for details)
let PlayerCtor: (new (opts: Record<string, unknown>) => RRWebPlayer) | null = null;
let segments: Segment[] = [];
let currentSegmentIndex = 0;
let segmentTransitioning = false;
let recordingStartTs = 0;
let recordingEndTs = 0;

// ── Player lifecycle ───────────────────────────────────────────

async function mount(events: eventWithTime[]) {
    if (!containerRef.value || events.length === 0) return;

    const currentMountToken = ++mountToken;
    log.log('mounting player with', events.length, 'events, liveMode:', props.liveMode);

    destroyPlayer({ invalidateMounts: false });

    // dynamic import to avoid SSR/bundling issues with Svelte component
    const rrwebPlayer = await import('rrweb-player');
    await import('rrweb-player/dist/style.css');
    if (currentMountToken !== mountToken || !containerRef.value) return;
    log.log('rrweb-player loaded');

    PlayerCtor = (rrwebPlayer.default ?? rrwebPlayer) as unknown as typeof PlayerCtor;

    const validEvents = filterValidEvents(events);
    if (validEvents.length < events.length) {
        log.warn('filtered', events.length - validEvents.length, 'malformed events');
    }

    // Reset segment state
    segments = [];
    currentSegmentIndex = 0;
    segmentTransitioning = false;

    if (props.liveMode) {
        createPlayer(validEvents, true, true);
    } else {
        segments = splitIntoSegments(validEvents);
        if (segments.length > 1) {
            log.log('detected', segments.length, 'recording segments (page refreshes during session)');
            recordingStartTs = validEvents[0]!.timestamp;
            recordingEndTs = validEvents[validEvents.length - 1]!.timestamp;
            createPlayer(padSegmentEvents(segments[0]!, recordingStartTs, recordingEndTs), false, true);
        } else {
            createPlayer(validEvents, false, true);
        }
    }
}

/**
 * Create an rrweb-player instance. Synchronous — requires PlayerCtor to already
 * be loaded via the async import in mount().
 */
function createPlayer(events: eventWithTime[], isLive: boolean, autoPlay: boolean) {
    if (!containerRef.value || !PlayerCtor) return;

    const metaEvent = events.find(e => e && typeof e === 'object' && e.type === 4);
    if (metaEvent?.data) {
        metaWidth = ((metaEvent.data as Record<string, unknown>).width as number) ?? 0;
        metaHeight = ((metaEvent.data as Record<string, unknown>).height as number) ?? 0;
        log.log('meta viewport:', metaWidth, 'x', metaHeight);
    }

    const controllerHeight = isLive ? 0 : 80;

    let playerEvents = events;
    if (isLive && events.length > 0) {
        const firstEvent = events[0];
        if (!firstEvent) return;
        const firstTs = firstEvent.timestamp;
        const now = Date.now();
        playerEvents = events.map(e => ({
            ...e,
            timestamp: now - (firstTs - e.timestamp)
        }));
    }

    player = new PlayerCtor({
        target: containerRef.value,
        props: {
            events: playerEvents,
            width: containerRef.value.clientWidth,
            height: containerRef.value.clientHeight - controllerHeight,
            autoPlay,
            showController: !isLive,
            skipInactive: !isLive,
            liveMode: isLive,
            mouseTail: {
                strokeStyle: 'rgba(34, 197, 94, 0.6)',
                lineWidth: 2
            }
        }
    });

    resizeObserver = new ResizeObserver(entries => {
        if (!player || !containerRef.value) return;
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        player.$set({
            width: Math.floor(width),
            height: Math.floor(height) - controllerHeight
        });
        player.triggerResize();
    });
    resizeObserver.observe(containerRef.value);

    timeInterval = setInterval(() => {
        if (isLive) {
            emit('timeUpdate', Number.MAX_SAFE_INTEGER);
            return;
        }
        if (!player?.getReplayer) return;
        const currentTime = player.getReplayer().getCurrentTime?.();
        if (typeof currentTime !== 'number') return;

        emit('timeUpdate', currentTime);

        // Multi-segment: detect when playback has moved outside the current segment
        if (segments.length > 1 && !segmentTransitioning) {
            const seg = segments[currentSegmentIndex];
            if (!seg) return;
            const segEnd = seg.offsetMs + seg.durationMs;

            if (currentTime > segEnd + 200) {
                const nextIdx = currentSegmentIndex + 1;
                if (nextIdx < segments.length) {
                    transitionToSegment(nextIdx);
                }
            } else if (seg.offsetMs > 0 && currentTime < seg.offsetMs - 200) {
                const targetIdx = findSegmentForTime(
                    segments.slice(0, currentSegmentIndex),
                    currentTime
                );
                transitionToSegment(targetIdx, currentTime);
            }
        }
    }, 100);
}

function transitionToSegment(index: number, seekTimeMs?: number) {
    if (segmentTransitioning || index === currentSegmentIndex) return;
    if (index < 0 || index >= segments.length) return;

    segmentTransitioning = true;
    currentSegmentIndex = index;
    const seg = segments[index]!;
    log.log('segment transition →', index + 1, '/', segments.length, '(', seg.events.length, 'events)');

    destroyPlayer({ invalidateMounts: false });
    createPlayer(padSegmentEvents(seg, recordingStartTs, recordingEndTs), false, false);
    player?.goto(seekTimeMs ?? seg.offsetMs, true);
    segmentTransitioning = false;
}

function destroyPlayer(options: { invalidateMounts?: boolean } = {}) {
    if (options.invalidateMounts ?? true) {
        mountToken += 1;
    }
    if (player) log.log('destroying player');
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    if (timeInterval) {
        clearInterval(timeInterval);
        timeInterval = undefined;
    }
    if (player?.$destroy) {
        player.$destroy();
    }
    player = null;
    if (containerRef.value) {
        containerRef.value.innerHTML = '';
    }
}

// ── Event forwarding (live mode) ───────────────────────────────

function addEvent(event: eventWithTime): void {
    if (!player?.getReplayer) return;
    if (event.type === 3 && (!event.data || typeof event.data !== 'object' || !('source' in (event.data as object)))) {
        return;
    }
    player.getReplayer().addEvent(event);
}

// ── Seeking ────────────────────────────────────────────────────

function seek(timeOffsetMs: number): void {
    if (segments.length <= 1) {
        if (player?.goto) player.goto(timeOffsetMs, true);
        return;
    }

    const targetIdx = findSegmentForTime(segments, timeOffsetMs);
    if (targetIdx !== currentSegmentIndex) {
        transitionToSegment(targetIdx, timeOffsetMs);
    } else if (player?.goto) {
        player.goto(timeOffsetMs, true);
    }
}

// ── Coordinate translation ─────────────────────────────────────

function translateCoords(e: MouseEvent): { x: number; y: number } | null {
    const iframe = containerRef.value?.querySelector('iframe');
    if (!iframe || !metaWidth || !metaHeight) return null;

    const rect = iframe.getBoundingClientRect();
    const scaleX = metaWidth / rect.width;
    const scaleY = metaHeight / rect.height;
    return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
    };
}

function handleMouseEvent(type: 'click' | 'mousedown' | 'mousemove' | 'mouseup', e: MouseEvent) {
    if (!props.liveMode) return;
    const coords = translateCoords(e);
    if (!coords) return;
    const rect = containerRef.value!.getBoundingClientRect();
    emit('interact', type, coords.x, coords.y, e.clientX - rect.left, e.clientY - rect.top);
}

function handleMouseLeave() {
    if (!props.liveMode) return;
    emit('interactEnd');
}

/** Convert virtual coordinates (recorded page space) to container-relative pixel coordinates */
function toLocalCoords(vx: number, vy: number): { x: number; y: number } | null {
    const iframe = containerRef.value?.querySelector('iframe');
    if (!iframe || !metaWidth || !metaHeight) return null;
    const iframeRect = iframe.getBoundingClientRect();
    const containerRect = containerRef.value!.getBoundingClientRect();
    return {
        x: (vx * iframeRect.width) / metaWidth + (iframeRect.left - containerRect.left),
        y: (vy * iframeRect.height) / metaHeight + (iframeRect.top - containerRect.top)
    };
}

onBeforeUnmount(() => destroyPlayer());

defineExpose({ mount, addEvent, seek, toLocalCoords });
</script>

<template>
    <div
        ref="containerRef"
        class="replay-player"
        @click="e => handleMouseEvent('click', e)"
        @mousedown="e => handleMouseEvent('mousedown', e)"
        @mousemove="e => handleMouseEvent('mousemove', e)"
        @mouseup="e => handleMouseEvent('mouseup', e)"
        @mouseleave="handleMouseLeave"
    />
</template>

<style scoped lang="scss">
.replay-player {
    position: absolute;
    inset: 0;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    user-select: none;

    :deep(.rr-player) {
        float: none !important;
        width: 100% !important;
        height: 100% !important;
    }

    :deep(.rr-player__frame) {
        border-radius: 0;
        background: #000 !important;
    }

    :deep(.replayer-mouse) {
        border-color: rgba(34, 197, 94, 0.8) !important;
    }

    :deep(.replayer-mouse::after) {
        background: rgba(34, 197, 94, 0.4) !important;
    }
}
</style>
