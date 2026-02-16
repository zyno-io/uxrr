<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { ILogEntry } from '@/openapi-client-generated';
import type { GrafanaConfig } from '@/auth';
import { buildGrafanaTraceUrl } from '@/grafana';

interface NetworkData {
    method: string;
    url: string;
    status: number;
    duration: number;
    traceId?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
}

const props = defineProps<{
    entries: ILogEntry[];
    currentTimeMs: number;
    sessionStartMs: number;
    grafana?: GrafanaConfig | null;
}>();

const emit = defineEmits<{
    seek: [offsetMs: number];
}>();

function seekToEntry(entry: ILogEntry) {
    emit('seek', entry.t - props.sessionStartMs);
}

const containerRef = ref<HTMLDivElement>();
const autoScroll = ref(true);
const expandedIndex = ref<number | null>(null);
let ignoreNextScroll = false;

const cutoffMs = computed(() => props.sessionStartMs + props.currentTimeMs);

const sortedEntries = computed(() => {
    return [...props.entries].sort((a, b) => a.t - b.t);
});

watch(sortedEntries, async () => {
    if (!autoScroll.value) return;
    ignoreNextScroll = true;
    await nextTick();
    if (containerRef.value) {
        containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
});

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

function net(entry: ILogEntry): NetworkData {
    const d = (entry.d ?? {}) as NetworkData;
    return {
        method: d.method ?? '???',
        url: d.url ?? '',
        status: d.status ?? 0,
        duration: d.duration ?? 0,
        traceId: d.traceId,
        requestHeaders: d.requestHeaders,
        requestBody: d.requestBody,
        responseHeaders: d.responseHeaders,
        responseBody: d.responseBody
    };
}

function hasDetail(data: NetworkData): boolean {
    return !!(data.requestHeaders || data.requestBody || data.responseHeaders || data.responseBody);
}

function toggleExpand(i: number) {
    expandedIndex.value = expandedIndex.value === i ? null : i;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusClass(status: number): string {
    if (status >= 200 && status < 300) return 'status-ok';
    if (status >= 300 && status < 400) return 'status-redirect';
    return 'status-error';
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function truncateUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.pathname + u.search;
    } catch {
        return url.length > 80 ? url.slice(0, 80) + '...' : url;
    }
}

function formatHeaders(headers: Record<string, string>): string {
    return Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
}
</script>

<template>
    <div class="network-panel">
        <div class="network-toolbar">
            <span class="network-title">Network</span>
            <span class="network-count">{{ sortedEntries.length }} requests</span>
            <label class="autoscroll-toggle">
                <input v-model="autoScroll" type="checkbox" />
                Auto-scroll
            </label>
        </div>
        <div ref="containerRef" class="network-entries">
            <div v-if="sortedEntries.length === 0" class="network-empty">No network requests yet</div>
            <table v-else class="network-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Method</th>
                        <th>URL</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th v-if="grafana">Trace</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="(entry, i) in sortedEntries" :key="i">
                        <tr
                            :class="{
                                clickable: hasDetail(net(entry)),
                                expanded: expandedIndex === i,
                                future: isFuture(entry)
                            }"
                            @click="hasDetail(net(entry)) && toggleExpand(i)"
                        >
                            <td class="col-time col-time--clickable" @click.stop="seekToEntry(entry)">
                                {{ formatTime(entry.t) }}
                            </td>
                            <td class="col-method">{{ net(entry).method }}</td>
                            <td class="col-url" :title="net(entry).url">{{ truncateUrl(net(entry).url) }}</td>
                            <td :class="['col-status', statusClass(net(entry).status)]">
                                {{ net(entry).status || '-' }}
                            </td>
                            <td class="col-duration">{{ formatDuration(net(entry).duration) }}</td>
                            <td v-if="grafana" class="col-trace">
                                <a
                                    v-if="net(entry).traceId"
                                    :href="
                                        buildGrafanaTraceUrl(grafana.baseUrl, grafana.datasource, net(entry).traceId!)
                                    "
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="trace-link"
                                    @click.stop
                                    title="View trace in Grafana"
                                >
                                    {{ net(entry).traceId!.slice(0, 8) }}
                                </a>
                            </td>
                        </tr>
                        <tr v-if="expandedIndex === i" class="detail-row">
                            <td :colspan="grafana ? 6 : 5">
                                <div class="detail-content">
                                    <div v-if="net(entry).requestHeaders" class="detail-section">
                                        <div class="detail-label">Request Headers</div>
                                        <pre class="detail-pre">{{ formatHeaders(net(entry).requestHeaders!) }}</pre>
                                    </div>
                                    <div v-if="net(entry).requestBody" class="detail-section">
                                        <div class="detail-label">Request Body</div>
                                        <pre class="detail-pre">{{ net(entry).requestBody }}</pre>
                                    </div>
                                    <div v-if="net(entry).responseHeaders" class="detail-section">
                                        <div class="detail-label">Response Headers</div>
                                        <pre class="detail-pre">{{ formatHeaders(net(entry).responseHeaders!) }}</pre>
                                    </div>
                                    <div v-if="net(entry).responseBody" class="detail-section">
                                        <div class="detail-label">Response Body</div>
                                        <pre class="detail-pre">{{ net(entry).responseBody }}</pre>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>
</template>

<style scoped lang="scss">
.network-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--uxrr-surface);
    border-radius: 4px;
    overflow: hidden;
}

.network-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--uxrr-border);
    flex-shrink: 0;
}

.network-title {
    font-weight: 600;
    font-size: 13px;
}

.network-count {
    color: var(--uxrr-text-muted);
    font-size: 12px;
    margin-right: auto;
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

.network-entries {
    flex: 1;
    overflow-y: auto;
}

.network-empty {
    padding: 24px;
    text-align: center;
    color: var(--uxrr-text-muted);
}

.network-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--uxrr-mono);
    font-size: 12px;

    th,
    td {
        text-align: left;
        padding: 3px 8px;
        white-space: nowrap;
    }

    th {
        color: var(--uxrr-text-muted);
        font-weight: 500;
        font-size: 11px;
        text-transform: uppercase;
        border-bottom: 1px solid var(--uxrr-border);
        position: sticky;
        top: 0;
        background: var(--uxrr-surface);
    }

    td {
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
}

tr.clickable {
    cursor: pointer;

    &:hover td {
        background: rgba(255, 255, 255, 0.03);
    }
}

tr.expanded td {
    background: rgba(255, 255, 255, 0.02);
}

tr.future td {
    opacity: 0.2;
    transition: opacity 0.15s;
}

.col-time {
    color: var(--uxrr-text-muted);
    flex-shrink: 0;

    &--clickable {
        cursor: pointer;

        &:hover {
            color: var(--uxrr-accent);
            text-decoration: underline;
        }
    }
}

.col-method {
    font-weight: 600;
    width: 50px;
}

.col-url {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.col-status {
    font-weight: 600;
    width: 50px;
}

.status-ok {
    color: var(--uxrr-success, #22c55e);
}
.status-redirect {
    color: var(--uxrr-warning);
}
.status-error {
    color: var(--uxrr-danger);
}

.col-duration {
    color: var(--uxrr-text-muted);
    width: 60px;
    text-align: right;
}

.col-trace {
    width: 70px;
}

.trace-link {
    color: var(--uxrr-accent);
    text-decoration: none;
    font-size: 11px;

    &:hover {
        text-decoration: underline;
    }
}

.detail-row td {
    padding: 0;
    white-space: normal;
}

.detail-content {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(0, 0, 0, 0.15);
    border-bottom: 1px solid var(--uxrr-border);
}

.detail-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.detail-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--uxrr-text-muted);
}

.detail-pre {
    margin: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    color: var(--uxrr-text);
}
</style>
