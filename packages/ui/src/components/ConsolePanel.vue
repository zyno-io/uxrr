<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

import type { GrafanaConfig } from '@/auth';
import type { ILogEntry } from '@/openapi-client-generated';

import { buildGrafanaTraceUrl } from '@/grafana';

const VIRTUAL_THRESHOLD = 200;

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
const scrollerRef = ref<{ $el?: HTMLElement; scrollToBottom?: () => void; scrollToItem?: (index: number) => void } | null>(null);
const levelFilter = ref<number | null>(null);
const includeNetwork = ref(true);
const autoScroll = ref(true);
const searchQuery = ref('');
const selectedLogItemId = ref<string | null>(null);
let ignoreNextScroll = false;
let suppressAutoScroll = false;

// absolute timestamp cutoff: session start + replay offset
const cutoffMs = computed(() => props.sessionStartMs + props.currentTimeMs);

interface ConsoleLogItem {
    entry: ILogEntry;
    id: string;
}

const allLogItems = computed<ConsoleLogItem[]>(() =>
    props.logs.flatMap((entry, index) => (entry && typeof entry === 'object' ? [{ entry, id: `${entry.t}:${index}` }] : []))
);

const visibleLogItems = computed(() => {
    let items = allLogItems.value;
    if (!includeNetwork.value) {
        items = items.filter(({ entry }) => entry.c !== 'uxrr:net');
    }
    if (levelFilter.value !== null) {
        items = items.filter(({ entry }) => entry.c === 'uxrr:net' || entry.v >= levelFilter.value!);
    }
    const query = searchQuery.value.trim().toLocaleLowerCase();
    if (query) {
        items = items.filter(({ entry }) => getSearchableText(entry).includes(query));
    }
    return items;
});

const visibleLogs = computed(() => visibleLogItems.value.map(({ entry }) => entry));

const useVirtual = computed(() => visibleLogs.value.length > VIRTUAL_THRESHOLD);

const scrollerItems = computed(() => visibleLogItems.value);

function getScrollerEl(): HTMLElement | null {
    const inst = scrollerRef.value as unknown as { $el?: HTMLElement } | null;
    return inst?.$el ?? null;
}

watch(
    visibleLogs,
    () => {
        if (!autoScroll.value || suppressAutoScroll) return;
        ignoreNextScroll = true;
        if (useVirtual.value) {
            scrollerRef.value?.scrollToBottom?.();
        } else if (containerRef.value) {
            containerRef.value.scrollTop = containerRef.value.scrollHeight;
        }
    },
    { flush: 'post' }
);

function onScroll(e: Event) {
    if (ignoreNextScroll) {
        ignoreNextScroll = false;
        return;
    }
    const el = (e.currentTarget as HTMLElement | null) ?? containerRef.value ?? getScrollerEl();
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (!atBottom && autoScroll.value) {
        autoScroll.value = false;
    }
}

let virtualScrollEl: HTMLElement | null = null;

onMounted(() => {
    containerRef.value?.addEventListener('scroll', onScroll, { passive: true });
    virtualScrollEl = getScrollerEl();
    virtualScrollEl?.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => {
    containerRef.value?.removeEventListener('scroll', onScroll);
    virtualScrollEl?.removeEventListener('scroll', onScroll);
});

watch(useVirtual, () => {
    virtualScrollEl?.removeEventListener('scroll', onScroll);
    virtualScrollEl = null;
    queueMicrotask(() => {
        virtualScrollEl = getScrollerEl();
        virtualScrollEl?.addEventListener('scroll', onScroll, { passive: true });
    });
});

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

function getSearchableText(entry: ILogEntry): string {
    let data = '';
    try {
        data = JSON.stringify(entry.d) ?? '';
    } catch {
        // Ingested log data should be JSON-safe, but a malformed entry should
        // not prevent the rest of the console from being searched.
    }
    return `${formatTime(entry.t)} ${getLevelInfo(entry.v).label} ${entry.c} ${entry.m} ${data}`.toLocaleLowerCase();
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

function scrollToLogItem(id: string) {
    const index = visibleLogItems.value.findIndex(item => item.id === id);
    if (index < 0) return;

    ignoreNextScroll = true;
    if (useVirtual.value) {
        scrollerRef.value?.scrollToItem?.(index);
        return;
    }

    const row = Array.from(containerRef.value?.querySelectorAll<HTMLElement>('.console-entry') ?? []).find(element => element.dataset.logId === id);
    row?.scrollIntoView({ block: 'center' });
}

async function toggleLogSelection(item: ConsoleLogItem) {
    const isSelected = selectedLogItemId.value === item.id;
    selectedLogItemId.value = isSelected ? null : item.id;

    if (!searchQuery.value) return;

    if (!isSelected) suppressAutoScroll = true;
    searchQuery.value = '';
    await nextTick();

    if (!isSelected) {
        scrollToLogItem(item.id);
        suppressAutoScroll = false;
    }
}
</script>

<template>
    <div class="console-panel">
        <div class="console-toolbar">
            <span class="console-title">Console</span>
            <div class="console-search">
                <input
                    v-model="searchQuery"
                    type="search"
                    class="console-search-input"
                    placeholder="Search console"
                    aria-label="Search console"
                    autocomplete="off"
                    spellcheck="false"
                />
                <button v-if="searchQuery" type="button" class="console-search-clear" aria-label="Clear console search" @click="searchQuery = ''">
                    &times;
                </button>
            </div>
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
        <div v-if="!useVirtual" ref="containerRef" class="console-entries">
            <div v-if="visibleLogs.length === 0" class="console-empty">
                {{ allLogItems.length === 0 ? 'No log entries yet' : 'No matching log entries' }}
            </div>
            <template v-for="item in visibleLogItems" :key="item.id">
                <div
                    v-if="isNetworkEntry(item.entry)"
                    :class="['console-entry', 'level-debug', 'net-entry', { future: isFuture(item.entry), selected: selectedLogItemId === item.id }]"
                    :data-log-id="item.id"
                    @click="toggleLogSelection(item)"
                >
                    <span class="entry-time entry-time--clickable" @click="seekToEntry(item.entry)">{{ formatTime(item.entry.t) }}</span>
                    <span class="entry-net-icon" title="Network request">&#8644;</span>
                    <span :class="['entry-method', statusClass(formatNetworkEntry(item.entry).status)]">{{
                        formatNetworkEntry(item.entry).method
                    }}</span>
                    <span class="entry-url" :title="formatNetworkEntry(item.entry).url">{{ truncateUrl(formatNetworkEntry(item.entry).url) }}</span>
                    <span :class="['entry-status', statusClass(formatNetworkEntry(item.entry).status)]">{{
                        formatNetworkEntry(item.entry).status || '-'
                    }}</span>
                    <span class="entry-duration">{{ formatNetworkEntry(item.entry).duration }}ms</span>
                    <a
                        v-if="grafana && getTraceId(item.entry)"
                        :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(item.entry)!)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="entry-trace"
                        title="View trace in Grafana"
                        >trace</a
                    >
                </div>
                <div
                    v-else
                    :class="[
                        'console-entry',
                        getLevelInfo(item.entry.v).cssClass,
                        { future: isFuture(item.entry), selected: selectedLogItemId === item.id }
                    ]"
                    :data-log-id="item.id"
                    @click="toggleLogSelection(item)"
                >
                    <span class="entry-time entry-time--clickable" @click="seekToEntry(item.entry)">{{ formatTime(item.entry.t) }}</span>
                    <span class="entry-level">{{ getLevelInfo(item.entry.v).label }}</span>
                    <span class="entry-scope">{{ item.entry.c }}</span>
                    <span class="entry-msg">{{ item.entry.m }}</span>
                    <span v-if="formatData(item.entry.d)" class="entry-data">{{ formatData(item.entry.d) }}</span>
                    <a
                        v-if="grafana && getTraceId(item.entry)"
                        :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(item.entry)!)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="entry-trace"
                        title="View trace in Grafana"
                        >trace</a
                    >
                </div>
            </template>
        </div>
        <DynamicScroller v-else ref="scrollerRef" :items="scrollerItems" :min-item-size="24" key-field="id" class="console-entries">
            <template #default="{ item, active }">
                <DynamicScrollerItem :item="item" :active="active" :size-dependencies="[item.entry.m, item.entry.d, item.entry.v, item.entry.c]">
                    <div
                        v-if="isNetworkEntry(item.entry)"
                        :class="[
                            'console-entry',
                            'level-debug',
                            'net-entry',
                            { future: isFuture(item.entry), selected: selectedLogItemId === item.id }
                        ]"
                        :data-log-id="item.id"
                        @click="toggleLogSelection(item)"
                    >
                        <span class="entry-time entry-time--clickable" @click="seekToEntry(item.entry)">{{ formatTime(item.entry.t) }}</span>
                        <span class="entry-net-icon" title="Network request">&#8644;</span>
                        <span :class="['entry-method', statusClass(formatNetworkEntry(item.entry).status)]">{{
                            formatNetworkEntry(item.entry).method
                        }}</span>
                        <span class="entry-url" :title="formatNetworkEntry(item.entry).url">{{
                            truncateUrl(formatNetworkEntry(item.entry).url)
                        }}</span>
                        <span :class="['entry-status', statusClass(formatNetworkEntry(item.entry).status)]">{{
                            formatNetworkEntry(item.entry).status || '-'
                        }}</span>
                        <span class="entry-duration">{{ formatNetworkEntry(item.entry).duration }}ms</span>
                        <a
                            v-if="grafana && getTraceId(item.entry)"
                            :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(item.entry)!)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="entry-trace"
                            title="View trace in Grafana"
                            >trace</a
                        >
                    </div>
                    <div
                        v-else
                        :class="[
                            'console-entry',
                            getLevelInfo(item.entry.v).cssClass,
                            { future: isFuture(item.entry), selected: selectedLogItemId === item.id }
                        ]"
                        :data-log-id="item.id"
                        @click="toggleLogSelection(item)"
                    >
                        <span class="entry-time entry-time--clickable" @click="seekToEntry(item.entry)">{{ formatTime(item.entry.t) }}</span>
                        <span class="entry-level">{{ getLevelInfo(item.entry.v).label }}</span>
                        <span class="entry-scope">{{ item.entry.c }}</span>
                        <span class="entry-msg">{{ item.entry.m }}</span>
                        <span v-if="formatData(item.entry.d)" class="entry-data">{{ formatData(item.entry.d) }}</span>
                        <a
                            v-if="grafana && getTraceId(item.entry)"
                            :href="buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, getTraceId(item.entry)!)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="entry-trace"
                            title="View trace in Grafana"
                            >trace</a
                        >
                    </div>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
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

.console-search {
    position: relative;
    width: clamp(140px, 20vw, 240px);
    flex-shrink: 1;
}

.console-search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 24px 4px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 3px;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font: inherit;
    font-size: 11px;

    &::placeholder {
        color: var(--uxrr-text-muted);
    }

    &:focus {
        outline: none;
        border-color: var(--uxrr-accent);
    }

    &::-webkit-search-cancel-button {
        appearance: none;
    }
}

.console-search-clear {
    position: absolute;
    top: 50%;
    right: 5px;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 16px;
    line-height: 18px;
    cursor: pointer;
    transform: translateY(-50%);

    &:hover {
        color: var(--uxrr-text);
    }
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
    cursor: pointer;
    transition:
        opacity 0.15s,
        background-color 0.15s;

    > span,
    > a {
        margin-right: 8px;
    }

    &.future {
        opacity: 0.5;
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

    &.selected {
        background: rgba(108, 126, 225, 0.2);
        box-shadow: inset 3px 0 var(--uxrr-accent);
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
