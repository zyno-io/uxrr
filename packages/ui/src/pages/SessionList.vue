<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';

defineOptions({ name: 'SessionList' });
import { useRoute, useRouter } from 'vue-router';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import type { ISession, GetSessionListSessionsData } from '@/openapi-client-generated';
import { SessionApi } from '@/openapi-client-generated';
import FilterBar from '@/components/FilterBar.vue';
import SessionTable from '@/components/SessionTable.vue';
import { connectSessionListStream, type SessionListStreamHandle } from '@/session-list-stream';
import { createLogger } from '@/logger';

const log = createLogger('session-list');
const REFRESH_INTERVAL = 30_000;

const route = useRoute();
const router = useRouter();
const PAGE_SIZE = 50;
const sessions = ref<ISession[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const error = ref<string | null>(null);
const filterBarRef = ref<InstanceType<typeof FilterBar>>();
let currentFilters: NonNullable<GetSessionListSessionsData['query']> = {};
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let streamHandle: SessionListStreamHandle | null = null;

function startStream() {
    streamHandle?.disconnect();
    streamHandle = connectSessionListStream(
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

async function load(filters: NonNullable<GetSessionListSessionsData['query']> = {}) {
    currentFilters = filters;
    log.log('loading sessions, filters:', filters);
    loading.value = true;
    error.value = null;
    hasMore.value = true;
    try {
        const result = dataFrom(await SessionApi.getSessionListSessions({ query: { ...filters, limit: PAGE_SIZE } }));
        sessions.value = result;
        hasMore.value = result.length >= PAGE_SIZE;
        log.log('loaded', result.length, 'sessions');
    } catch (err: unknown) {
        log.error('failed to load sessions:', err);
        error.value = (err as Error).message ?? 'Failed to load sessions';
    } finally {
        loading.value = false;
    }
    if (streamHandle) {
        streamHandle.updateFilters(currentFilters);
    } else {
        startStream();
    }
}

async function silentRefresh() {
    try {
        // Re-compute filters (relative date presets need fresh timestamps)
        const filters = filterBarRef.value?.getFilters() ?? currentFilters;
        const fresh = dataFrom(await SessionApi.getSessionListSessions({ query: { ...filters, limit: PAGE_SIZE } }));
        if (sessions.value.length <= PAGE_SIZE) {
            sessions.value = fresh;
        } else {
            // Merge: fresh first page + remaining loaded pages (deduped)
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
        const filters = filterBarRef.value?.getFilters() ?? currentFilters;
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

function onSelect(session: ISession) {
    router.push({ name: 'session-detail', params: { id: session.id } });
}

function onFilterByUser(userId: string) {
    filterBarRef.value?.setFilter('userId', userId);
}

function onFilterByApp(appKey: string) {
    filterBarRef.value?.setFilter('appKey', appKey);
}

function onFilterByDevice(deviceId: string) {
    filterBarRef.value?.setFilter('deviceId', deviceId);
}

let firstActivation = true;

onMounted(() => {
    log.log('mounted');
    const queryParams: Record<string, string> = {};
    for (const key of ['userId', 'appKey', 'deviceId']) {
        if (route.query[key]) queryParams[key] = String(route.query[key]);
    }

    if (Object.keys(queryParams).length > 0) {
        log.log('initializing filters from query params:', queryParams);
        filterBarRef.value?.initFilters(queryParams);
    } else if (filterBarRef.value?.restoreFromStorage()) {
        log.log('restored filters from sessionStorage');
        load(filterBarRef.value.getFilters());
    } else {
        load();
    }
});

onActivated(() => {
    log.log('activated');
    refreshTimer = setInterval(silentRefresh, REFRESH_INTERVAL);
    if (firstActivation) {
        // Stream already started by load() in onMounted
        firstActivation = false;
    } else {
        // Reactivation: check for new query params (e.g. ?userId= from "view all sessions")
        const queryParams: Record<string, string> = {};
        for (const key of ['userId', 'appKey', 'deviceId']) {
            if (route.query[key]) queryParams[key] = String(route.query[key]);
        }

        if (Object.keys(queryParams).length > 0) {
            log.log('reactivated with query params:', queryParams);
            filterBarRef.value?.initFilters(queryParams);
        } else {
            startStream();
            silentRefresh();
        }
    }
});

onDeactivated(() => {
    log.log('deactivated');
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    streamHandle?.disconnect();
    streamHandle = null;
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
    <div class="session-list">
        <div class="session-list-header">
            <h1>Sessions</h1>
            <FilterBar ref="filterBarRef" @filter="load" />
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
.session-list {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.session-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    gap: 16px;
    flex-wrap: wrap;

    h1 {
        font-size: 20px;
        font-weight: 600;
    }
}
</style>
