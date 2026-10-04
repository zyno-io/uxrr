<script setup lang="ts">
import { formatDistanceToNow, format } from 'date-fns';
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import type { ISession } from '@/openapi-client-generated';

import UserInfoPopover from './UserInfoPopover.vue';

const props = defineProps<{
    sessions: ISession[];
    loading: boolean;
    error: string | null;
    loadingMore?: boolean;
    hasMore?: boolean;
}>();

const emit = defineEmits<{
    select: [session: ISession];
    filterByUser: [userId: string];
    filterByApp: [appKey: string];
    filterByDevice: [deviceId: string];
    loadMore: [];
}>();

const sentinelRef = ref<HTMLTableRowElement>();
let observer: IntersectionObserver | undefined;

function setupObserver() {
    observer?.disconnect();
    if (!sentinelRef.value) return;
    const wrap = sentinelRef.value.closest('.session-table-wrap');
    observer = new IntersectionObserver(
        entries => {
            if (entries[0]?.isIntersecting && props.hasMore !== false && !props.loadingMore) {
                emit('loadMore');
            }
        },
        { root: wrap, rootMargin: '200px' }
    );
    observer.observe(sentinelRef.value);
}

watch(sentinelRef, setupObserver);
onMounted(setupObserver);
onBeforeUnmount(() => observer?.disconnect());

function formatTime(iso: string): string {
    return format(new Date(iso), 'MMM d, HH:mm:ss');
}

function formatDuration(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
}

function formatRelative(iso: string): string {
    const date = new Date(Math.min(new Date(iso).getTime(), Date.now()));
    return formatDistanceToNow(date, { addSuffix: true });
}
</script>

<template>
    <div class="session-table-wrap">
        <table class="session-table">
            <thead>
                <tr>
                    <th>Session</th>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>User</th>
                    <th>Device</th>
                    <th>App</th>
                    <th>Version</th>
                    <th>Env</th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="loading">
                    <td colspan="8" class="cell-empty">Loading sessions...</td>
                </tr>
                <tr v-else-if="error">
                    <td colspan="8" class="cell-empty cell-error">{{ error }}</td>
                </tr>
                <tr v-else-if="sessions.length === 0">
                    <td colspan="8" class="cell-empty">No sessions found</td>
                </tr>
                <tr v-for="s in sessions" :key="s.id" class="row-clickable" @click="emit('select', s)">
                    <td class="cell-mono">{{ s.id.slice(0, 8) }}</td>
                    <td>
                        <span v-if="s.isLive" class="live-badge">LIVE</span>
                        <span v-if="s.hasChatMessages" class="chat-badge" title="Has chat">&#x1F4AC;</span>
                        {{ formatRelative(s.startedAt) }}
                        <span class="cell-exact-time">{{ formatTime(s.startedAt) }}</span>
                    </td>
                    <td>
                        <span v-if="s.isLive" v-duration="new Date(s.startedAt).getTime()"></span>
                        <span v-else>{{ formatDuration(s.startedAt, s.lastActivityAt) }}</span>
                    </td>
                    <td>
                        <UserInfoPopover
                            v-if="s.userId"
                            :user-id="s.userId"
                            :user-name="s.userName"
                            :user-email="s.userEmail"
                            @filter="emit('filterByUser', $event)"
                        >
                            <span class="clickable-filter" @click.stop="emit('filterByUser', s.userId)">{{
                                s.userName || s.userEmail || s.userId
                            }}</span>
                        </UserInfoPopover>
                        <span v-else>-</span>
                    </td>
                    <td class="cell-mono">
                        <span class="clickable-filter" @click.stop="emit('filterByDevice', s.deviceId)">{{ s.deviceId.slice(0, 8) }}</span>
                    </td>
                    <td>
                        <span class="clickable-filter" @click.stop="emit('filterByApp', s.appId)">{{ s.appId }}</span>
                    </td>
                    <td>{{ s.version ?? '-' }}</td>
                    <td>{{ s.environment ?? '-' }}</td>
                </tr>
                <tr v-if="hasMore !== false && sessions.length > 0" ref="sentinelRef">
                    <td colspan="8" class="cell-empty cell-loading-more">
                        <span v-if="loadingMore">Loading more...</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped lang="scss">
.session-table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 12px 16px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
}

.session-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;

    th,
    td {
        text-align: left;
        padding: 8px 12px;
        white-space: nowrap;
    }

    th {
        color: var(--text-3);
        font-weight: 600;
        font-size: 11px;
        height: 32px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        background: var(--surface-2);
    }

    td {
        height: 40px;
        border-bottom: 1px solid var(--border);
    }
}

.row-clickable {
    cursor: pointer;

    &:hover td {
        background: var(--surface-hover);
    }
}

.cell-empty {
    text-align: center;
    color: var(--text-3);
    padding: 32px 12px;
}

.cell-error {
    color: var(--danger);
}

.cell-loading-more {
    padding: 16px 12px;
    font-size: 12px;
}

.cell-mono {
    font-family: var(--font-mono);
    font-size: 12px;
}

.cell-exact-time {
    margin-left: 6px;
    color: var(--text-3);
    font-size: 11px;
}

.clickable-filter {
    cursor: pointer;

    &:hover {
        color: var(--accent);
        text-decoration: underline;
    }
}

.chat-badge {
    font-size: 12px;
    margin-right: 4px;
    vertical-align: middle;
}

.live-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--danger-border);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-right: 6px;
    animation: pulse-live 2s ease-in-out infinite;
}

@keyframes pulse-live {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}
</style>
