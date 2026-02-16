<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { ILogEntry } from '@/openapi-client-generated';
import type { GrafanaConfig } from '@/auth';
import { buildGrafanaTraceUrl } from '@/grafana';

const LOG_LEVELS: Record<number, { label: string; cssClass: string }> = {
    0: { label: 'DEBUG', cssClass: 'level-debug' },
    1: { label: 'INFO', cssClass: 'level-info' },
    2: { label: 'WARN', cssClass: 'level-warn' },
    3: { label: 'ERROR', cssClass: 'level-error' }
};

const props = defineProps<{
    logs: ILogEntry[];
    currentTimeMs: number; // replay time offset in ms from session start
    sessionStartMs: number; // session start unix timestamp in ms
    grafana?: GrafanaConfig | null;
}>();

const emit = defineEmits<{
    seek: [offsetMs: number];
}>();

function seekToEntry(entry: ILogEntry) {
    emit('seek', entry.t - props.sessionStartMs);
}

const containerRef = ref<HTMLDivElement>();
const levelFilter = ref<number | null>(null);
const includeNetwork = ref(true);
const autoScroll = ref(true);
let ignoreNextScroll = false;

// absolute timestamp cutoff: session start + replay offset
const cutoffMs = computed(() => props.sessionStartMs + props.currentTimeMs);

const visibleLogs = computed(() => {
    let entries = props.logs.filter((l): l is ILogEntry => !!l && typeof l === 'object');
    if (!includeNetwork.value) {
        entries = entries.filter(l => l.c !== 'uxrr:net');
    }
    if (levelFilter.value !== null) {
        entries = entries.filter(l => l.c === 'uxrr:net' || l.v >= levelFilter.value!);
    }
    return entries;
});

watch(
    visibleLogs,
    () => {
        if (!autoScroll.value) return;
        ignoreNextScroll = true;
        if (containerRef.value) {
            containerRef.value.scrollTop = containerRef.value.scrollHeight;
        }
    },
    { flush: 'post' }
);

function onScroll() {
    if (ignoreNextScroll) {
        ignoreNextScroll = false;
        return;
    }
    if (!containerRef.value) return;
    const el = containerRef.value;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (!atBottom && autoScroll.value) {
        autoScroll.value = false;
    }
}

onMounted(() => containerRef.value?.addEventListener('scroll', onScroll, { passive: true }));
onBeforeUnmount(() => containerRef.value?.removeEventListener('scroll', onScroll));

function isFuture(entry: ILogEntry): boolean {
    return entry.t > cutoffMs.value;
}

function isNetworkEntry(entry: ILogEntry): boolean {
    return entry.c === 'uxrr:net';
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getLevelInfo(v: number) {
    return LOG_LEVELS[v] ?? { label: `L${v}`, cssClass: 'level-debug' };
}

function getTraceId(entry: ILogEntry): string | undefined {
    if (!entry.d || typeof entry.d !== 'object') return undefined;
    const d = entry.d as Record<string, unknown>;
    return typeof d.traceId === 'string' && d.traceId.length > 0 ? d.traceId : undefined;
}

function formatData(d?: unknown): string {
    if (!d || typeof d !== 'object') return '';
    const data = d as Record<string, unknown>;
    if (Object.keys(data).length === 0) return '';
    const { traceId, ...rest } = data;
    if (Object.keys(rest).length === 0) return '';
    return JSON.stringify(rest);
}

function formatNetworkEntry(entry: ILogEntry): { method: string; url: string; status: number; duration: number } {
    const d = (entry.d && typeof entry.d === 'object' ? entry.d : {}) as Record<string, unknown>;
    // Fall back to parsing the message field ("METHOD url") when d is empty
    let method = d.method as string | undefined;
    let url = d.url as string | undefined;
    if (!method && entry.m) {
        const spaceIdx = entry.m.indexOf(' ');
        if (spaceIdx > 0) {
            method = entry.m.slice(0, spaceIdx);
            url = url ?? entry.m.slice(spaceIdx + 1);
        }
    }
    return {
        method: method ?? '???',
        url: url ?? '',
        status: (d.status as number) ?? 0,
        duration: (d.duration as number) ?? 0
    };
}

function truncateUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.pathname + u.search;
    } catch {
        return url.length > 60 ? url.slice(0, 60) + '...' : url;
    }
}

function statusClass(status: number): string {
    if (status >= 200 && status < 300) return 'net-status-ok';
    if (status >= 300 && status < 400) return 'net-status-redirect';
    return 'net-status-error';
}

function setFilter(level: number | null) {
    levelFilter.value = level;
}
</script>

<template>
    <div class="console-panel">
        <div class="console-toolbar">
            <span class="console-title">Console</span>
            <div class="console-filters">
                <button :class="['filter-chip', { active: levelFilter === null }]" @click="setFilter(null)">All</button>
                <button :class="['filter-chip', { active: levelFilter === 0 }]" @click="setFilter(0)">Debug</button>
                <button :class="['filter-chip', { active: levelFilter === 1 }]" @click="setFilter(1)">Info+</button>
                <button :class="['filter-chip', { active: levelFilter === 2 }]" @click="setFilter(2)">Warn+</button>
                <button :class="['filter-chip', { active: levelFilter === 3 }]" @click="setFilter(3)">Error</button>
            </div>
            <label class="filter-chip-toggle">
                <input v-model="includeNetwork" type="checkbox" />
                Net
            </label>
            <label class="autoscroll-toggle">
                <input v-model="autoScroll" type="checkbox" />
                Auto-scroll
            </label>
        </div>
        <div ref="containerRef" class="console-entries">
            <div v-if="visibleLogs.length === 0" class="console-empty">No log entries yet</div>
            <template v-for="(entry, i) in visibleLogs" :key="i">
                <div
                    v-if="isNetworkEntry(entry)"
                    :class="['console-entry', 'level-debug', 'net-entry', { future: isFuture(entry) }]"
                >
                    <span class="entry-time entry-time--clickable" @click="seekToEntry(entry)">{{
                        formatTime(entry.t)
                    }}</span>
                    <span class="entry-net-icon" title="Network request">&#8644;</span>
                    <span :class="['entry-method', statusClass(formatNetworkEntry(entry).status)]">{{
                        formatNetworkEntry(entry).method
                    }}</span>
                    <span class="entry-url" :title="formatNetworkEntry(entry).url">{{
                        truncateUrl(formatNetworkEntry(entry).url)
                    }}</span>
                    <span :class="['entry-status', statusClass(formatNetworkEntry(entry).status)]">{{
                        formatNetworkEntry(entry).status || '-'
                    }}</span>
                    <span class="entry-duration">{{ formatNetworkEntry(entry).duration }}ms</span>
                    <a
                        v-if="grafana && getTraceId(entry)"
                        :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(entry)!)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="entry-trace"
                        title="View trace in Grafana"
                        >trace</a
                    >
                </div>
                <div v-else :class="['console-entry', getLevelInfo(entry.v).cssClass, { future: isFuture(entry) }]">
                    <span class="entry-time entry-time--clickable" @click="seekToEntry(entry)">{{
                        formatTime(entry.t)
                    }}</span>
                    <span class="entry-level">{{ getLevelInfo(entry.v).label }}</span>
                    <span class="entry-scope">{{ entry.c }}</span>
                    <span class="entry-msg">{{ entry.m }}</span>
                    <span v-if="formatData(entry.d)" class="entry-data">{{ formatData(entry.d) }}</span>
                    <a
                        v-if="grafana && getTraceId(entry)"
                        :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(entry)!)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="entry-trace"
                        title="View trace in Grafana"
                        >trace</a
                    >
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped lang="scss">
.console-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--uxrr-surface);
    border-radius: 4px;
    overflow: hidden;
}

.console-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--uxrr-border);
    flex-shrink: 0;
}

.console-title {
    font-weight: 600;
    font-size: 13px;
    margin-right: auto;
}

.console-filters {
    display: flex;
    gap: 4px;
}

.filter-chip {
    padding: 2px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 3px;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 11px;
    cursor: pointer;

    &.active {
        background: var(--uxrr-accent);
        color: #fff;
        border-color: var(--uxrr-accent);
    }
}

.filter-chip-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--uxrr-text-muted);
    cursor: pointer;
    user-select: none;
}

.autoscroll-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--uxrr-text-muted);
    cursor: pointer;
    user-select: none;
}

.console-entries {
    flex: 1;
    overflow-y: auto;
    font-family: var(--uxrr-mono);
    font-size: 12px;
    line-height: 1.6;
}

.console-empty {
    padding: 24px;
    text-align: center;
    color: var(--uxrr-text-muted);
}

.console-entry {
    padding: 2px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    word-break: break-word;
    transition: opacity 0.15s;

    > span,
    > a {
        margin-right: 8px;
    }

    &.future {
        opacity: 0.2;
    }

    &.level-debug {
        color: var(--uxrr-text-muted);
    }
    &.level-info {
        color: var(--uxrr-info);
    }
    &.level-warn {
        color: var(--uxrr-warning);
        background: rgba(225, 176, 91, 0.04);
    }
    &.level-error {
        color: var(--uxrr-danger);
        background: rgba(225, 91, 91, 0.06);
    }
}

.net-entry {
    color: var(--uxrr-text-muted);
}

.entry-net-icon {
    opacity: 0.5;
    font-size: 11px;
}

.entry-time {
    color: var(--uxrr-text-muted);

    &--clickable {
        cursor: pointer;

        &:hover {
            color: var(--uxrr-accent);
            text-decoration: underline;
        }
    }
}

.entry-level {
    font-weight: 600;
}

.entry-scope {
    color: var(--uxrr-accent);
}

.entry-data {
    color: var(--uxrr-text-muted);
}

.entry-method {
    font-weight: 600;
}

.entry-url {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
    vertical-align: bottom;
    white-space: nowrap;
}

.entry-status {
    font-weight: 600;
}

.entry-duration {
    color: var(--uxrr-text-muted);
}

.net-status-ok {
    color: var(--uxrr-success, #22c55e);
}
.net-status-redirect {
    color: var(--uxrr-warning);
}
.net-status-error {
    color: var(--uxrr-danger);
}

.entry-trace {
    color: var(--uxrr-accent);
    text-decoration: none;
    font-size: 10px;
    opacity: 0.7;

    &:hover {
        text-decoration: underline;
        opacity: 1;
    }
}
</style>
