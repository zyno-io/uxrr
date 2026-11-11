<script setup lang="ts">
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';

import type { ISession, GetSessionListSessionsData } from '@/openapi-client-generated';

import DateRangePicker, { type DateRange } from '@/components/DateRangePicker.vue';
import SessionTable from '@/components/SessionTable.vue';
import { embedState } from '@/embed';
import { createLogger } from '@/logger';
import { SessionApi } from '@/openapi-client-generated';
import { connectEmbedSessionListStream, type SessionListStreamHandle } from '@/session-list-stream';

const log = createLogger('embed-session-list');
const REFRESH_INTERVAL = 30_000;

const router = useRouter();
const PAGE_SIZE = 50;
const sessions = ref<ISession[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const error = ref<string | null>(null);

const selectedAppKey = ref(embedState.appKeys.length === 1 ? embedState.appKeys[0] : '');
const userId = ref('');
const deviceId = ref('');
const hasChat = ref(false);
const dateRange = ref<DateRange>({});
const datePickerRef = ref<InstanceType<typeof DateRangePicker>>();

const showAppFilter = computed(() => embedState.appKeys.length > 1);

let currentFilters: NonNullable<GetSessionListSessionsData['query']> = {};
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let streamHandle: SessionListStreamHandle | null = null;

function buildFilters(): NonNullable<GetSessionListSessionsData['query']> {
    const range = datePickerRef.value?.computeRange() ?? dateRange.value;
    return {
        appKey: selectedAppKey.value || undefined,
        userId: userId.value || undefined,
        deviceId: deviceId.value || undefined,
        hasChat: hasChat.value || undefined,
        from: range.from || undefined,
        to: range.to || undefined
    };
}

function startStream() {
    streamHandle?.disconnect();
    streamHandle = connectEmbedSessionListStream(
        {
            appKey: currentFilters.appKey || undefined,
            userId: currentFilters.userId || undefined,
            deviceId: currentFilters.deviceId || undefined,
            from: currentFilters.from || undefined,
            to: currentFilters.to || undefined
        },
        {
            onSessionCreated(session) {
                sessions.value = [session, ...sessions.value];
            },
            onSessionUpdated(session) {
                const idx = sessions.value.findIndex(s => s.id === session.id);
                if (idx >= 0) {
                    sessions.value = sessions.value.map((s, i) => (i === idx ? session : s));
                }
            },
            onSessionLiveStatus(sessionId, isLive, lastActivityAt) {
                const idx = sessions.value.findIndex(s => s.id === sessionId);
                if (idx >= 0) {
                    sessions.value = sessions.value.map((s, i) => (i === idx ? { ...s, isLive, lastActivityAt } : s));
                }
            },
            onReconnect() {
                silentRefresh();
            }
        }
    );
}

async function load() {
    currentFilters = buildFilters();
    log.log('loading embed sessions, filters:', currentFilters);
    loading.value = true;
    error.value = null;
    hasMore.value = true;
    try {
        const result = dataFrom(await SessionApi.getSessionListSessions({ query: { ...currentFilters, limit: PAGE_SIZE } }));
        sessions.value = result;
        hasMore.value = result.length >= PAGE_SIZE;
        log.log('loaded', result.length, 'sessions');
    } catch (err: unknown) {
        log.error('failed to load embed sessions:', err);
        error.value = (err as Error).message ?? 'Failed to load sessions';
    } finally {
        loading.value = false;
    }
    startStream();
}

async function silentRefresh() {
    try {
        const filters = buildFilters();
        const fresh = dataFrom(await SessionApi.getSessionListSessions({ query: { ...filters, limit: PAGE_SIZE } }));
        if (sessions.value.length <= PAGE_SIZE) {
            sessions.value = fresh;
        } else {
            const freshIds = new Set(fresh.map(s => s.id));
            const tail = sessions.value.slice(PAGE_SIZE).filter(s => !freshIds.has(s.id));
            sessions.value = [...fresh, ...tail];
        }
        log.log('silent refresh complete,', sessions.value.length, 'sessions');
    } catch (err) {
        log.warn('silent refresh failed:', err);
    }
}

async function loadMore() {
    if (loadingMore.value || !hasMore.value || sessions.value.length === 0) return;
    loadingMore.value = true;
    try {
        const last = sessions.value[sessions.value.length - 1];
        if (!last) return;
        const filters = buildFilters();
        const more = dataFrom(await SessionApi.getSessionListSessions({ query: { ...filters, limit: PAGE_SIZE, before: last.id } }));
        if (more.length < PAGE_SIZE) hasMore.value = false;
        const existingIds = new Set(sessions.value.map(s => s.id));
        const unique = more.filter(s => !existingIds.has(s.id));
        sessions.value = [...sessions.value, ...unique];
    } catch (err) {
        log.warn('load more failed:', err);
    } finally {
        loadingMore.value = false;
    }
}

function onDateChange(range: DateRange) {
    dateRange.value = range;
    load();
}

function onSelect(session: ISession) {
    router.push({ name: 'embed-session-detail', params: { id: session.id } });
}

function onFilterByUser(uid: string) {
    userId.value = uid;
    load();
}

function onFilterByApp(appKey: string) {
    if (embedState.appKeys.includes(appKey)) {
        selectedAppKey.value = appKey;
        load();
    }
}

function onFilterByDevice(deviceId_: string) {
    deviceId.value = deviceId_;
    load();
}

onMounted(() => {
    log.log('mounted');
    load();
    refreshTimer = setInterval(silentRefresh, REFRESH_INTERVAL);
});

onBeforeUnmount(() => {
    log.log('unmounting, cleaning up');
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    streamHandle?.disconnect();
});
</script>

<template>
    <div class="embed-session-list">
        <div class="embed-filter-bar">
            <select v-if="showAppFilter" v-model="selectedAppKey" class="select embed-filter-select" @change="load">
                <option value="">All Apps</option>
                <option v-for="app in embedState.appKeys" :key="app" :value="app">{{ app }}</option>
            </select>
            <input v-model="userId" placeholder="User ID" class="input embed-filter-input" @keyup.enter="load" />
            <input v-model="deviceId" placeholder="Device ID" class="input embed-filter-input" @keyup.enter="load" />
            <DateRangePicker ref="datePickerRef" @change="onDateChange" />
            <label class="embed-filter-toggle">
                <input type="checkbox" v-model="hasChat" @change="load" />
                <span>Has Chat</span>
            </label>
            <button class="btn primary embed-filter-btn" @click="load">Filter</button>
        </div>
        <SessionTable
            :sessions="sessions"
            :loading="loading"
            :error="error"
            :loading-more="loadingMore"
            :has-more="hasMore"
            @select="onSelect"
            @load-more="loadMore"
            @filter-by-user="onFilterByUser"
            @filter-by-app="onFilterByApp"
            @filter-by-device="onFilterByDevice"
        />
    </div>
</template>

<style scoped lang="scss">
.embed-session-list {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.embed-filter-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    flex-wrap: wrap;
}

.embed-filter-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;

    input {
        cursor: pointer;
    }
}
</style>
