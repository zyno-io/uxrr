<script setup lang="ts">
import { format } from 'date-fns';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { ShareApi } from '@/openapi-client-generated';
import type { ISession, ILogEntry, IChatMessage } from '@/openapi-client-generated';
import ReplayPlayer from '@/components/ReplayPlayer.vue';
import ConsolePanel from '@/components/ConsolePanel.vue';
import NetworkPanel from '@/components/NetworkPanel.vue';
import ChatPanel from '@/components/ChatPanel.vue';
import { connectSharedLiveSession } from '@/live-stream';
import { useRoute } from 'vue-router';
import { useSessionDetail } from '@/composables/useSessionDetail';

const route = useRoute();
const token = route.params.token as string;

const {
    session,
    logs,
    chatMessages,
    loading,
    error,
    currentTimeMs,
    activeTab,
    isLive,
    clientConnected,
    chatStarted,
    clientFocused,
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
    toggleLayout,
    startResize,
    skipLive,
    onTimeUpdate,
    seekTo,
    formatLocal,
    formatUtc,
    formatMeta
} = useSessionDetail({
    loggerScope: 'shared-session',
    loadSession: async () => dataFrom(await ShareApi.getShareGetSession({ path: { token } })) as unknown as ISession,
    loadEvents: async () => dataFrom(await ShareApi.getShareGetSessionEvents({ path: { token } })) as any[],
    loadLogs: async (since?: number) => dataFrom(await ShareApi.getShareGetSessionLogs({ path: { token }, query: { since } })) as ILogEntry[],
    loadChat: async () => {
        const c = await ShareApi.getShareGetSessionChat({ path: { token } });
        return (dataFrom(c) as IChatMessage[]).map(m => ({ message: m.message, from: m.from, timestamp: m.timestamp }));
    },
    connectLive: callbacks => connectSharedLiveSession(token, callbacks)
});
</script>

<template>
    <div class="session-detail">
        <div class="detail-header">
            <template v-if="session">
                <div class="detail-meta">
                    <span v-if="liveStatus === 'live'" class="live-badge">LIVE</span>
                    <span
                        v-else-if="liveStatus === 'waiting' || liveStatus === 'syncing'"
                        class="live-badge live-badge--connecting"
                        >CONNECTING</span
                    >
                    <span class="meta-id">{{ session.id.slice(0, 8) }}</span>
                    <span class="meta-sep">/</span>
                    <span>{{ formatMeta(session) }}</span>
                    <span class="meta-sep">/</span>
                    <span class="meta-time">{{ format(new Date(session.startedAt), 'MMM d, yyyy HH:mm:ss') }}</span>
                </div>
                <div class="detail-indicators">
                    <span v-if="liveStatus === 'waiting'" class="client-indicator client-indicator--off"
                        >Waiting for client to connect...
                        <button class="skip-live-link" @click="skipLive">Skip</button></span
                    >
                    <span v-else-if="liveStatus === 'syncing'" class="client-indicator client-indicator--off"
                        >Syncing...</span
                    >
                    <span v-else-if="liveStatus === 'live' && clientFocused" class="client-indicator"
                        >Client connected</span
                    >
                    <span
                        v-else-if="liveStatus === 'live' && !clientFocused"
                        class="client-indicator client-indicator--unfocused"
                        >Window hidden</span
                    >
                    <span v-else-if="liveStatus === 'ended'" class="client-indicator client-indicator--off"
                        >Session ended</span
                    >
                </div>
            </template>
        </div>

        <div v-if="loading" class="detail-loading">Loading session...</div>
        <div v-else-if="error" class="detail-error">{{ error }}</div>
        <div
            v-else
            ref="contentRef"
            :class="['detail-content', `layout-${layout}`]"
            :style="isResizing ? { userSelect: 'none' } : undefined"
        >
            <div class="replay-pane">
                <div v-if="liveStatus === 'waiting'" class="replay-status">
                    <div class="replay-status-content">
                        Waiting for client to connect...
                        <button class="skip-live-btn" @click="skipLive">Skip Live Connection</button>
                    </div>
                </div>
                <div v-else-if="liveStatus === 'syncing'" class="replay-status">Syncing...</div>
                <ReplayPlayer
                    ref="playerRef"
                    :live-mode="isLive"
                    @time-update="onTimeUpdate"
                />
                <div v-if="playbackTime" class="playback-time-bar">
                    <span class="playback-time-label">Local</span>
                    <span class="playback-time-value">{{ formatLocal(playbackTime) }}</span>
                    <span class="playback-time-sep">/</span>
                    <span class="playback-time-label">UTC</span>
                    <span class="playback-time-value">{{ formatUtc(playbackTime) }}</span>
                </div>
            </div>
            <div :class="['resize-handle', `resize-handle--${layout}`]" @mousedown="startResize" />
            <div
                class="side-pane"
                :style="layout === 'right' ? { width: sidePaneSize + 'px' } : { height: sidePaneSize + 'px' }"
            >
                <div class="tab-bar">
                    <button :class="['tab', { active: activeTab === 'console' }]" @click="activeTab = 'console'">
                        Console
                    </button>
                    <button :class="['tab', { active: activeTab === 'network' }]" @click="activeTab = 'network'">
                        Network
                    </button>
                    <button
                        v-if="showChatTab"
                        :class="['tab', { active: activeTab === 'chat' }]"
                        @click="activeTab = 'chat'"
                    >
                        Chat
                        <span v-if="chatMessages.length > 0" class="tab-badge">{{ chatMessages.length }}</span>
                    </button>
                    <button
                        class="layout-toggle"
                        @click="toggleLayout"
                        :title="layout === 'right' ? 'Move panel to bottom' : 'Move panel to right'"
                    >
                        {{ layout === 'right' ? '&#11027;' : '&#11028;' }}
                    </button>
                </div>
                <div class="tab-content">
                    <ConsolePanel
                        v-show="activeTab === 'console'"
                        :logs="consoleLogs"
                        :current-time-ms="currentTimeMs"
                        :session-start-ms="sessionStartMs"
                        @seek="seekTo"
                    />
                    <NetworkPanel
                        v-show="activeTab === 'network'"
                        :entries="networkLogs"
                        :current-time-ms="currentTimeMs"
                        :session-start-ms="sessionStartMs"
                        @seek="seekTo"
                    />
                    <ChatPanel
                        v-if="showChatTab"
                        v-show="activeTab === 'chat'"
                        :messages="chatMessages"
                        :chat-started="chatStarted"
                        :chat-active="false"
                        :client-connected="clientConnected"
                        :user-typing="false"
                        :readonly="true"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.session-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.detail-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--uxrr-border);
    flex-shrink: 0;
}

.detail-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}

.live-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--uxrr-danger);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    animation: pulse-live 2s ease-in-out infinite;
}

.live-badge--connecting {
    background: var(--uxrr-text-muted);
    animation: none;
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

.meta-id {
    font-family: var(--uxrr-mono);
    color: var(--uxrr-accent);
    font-weight: 600;
}

.meta-sep {
    color: var(--uxrr-text-muted);
}

.meta-time {
    color: var(--uxrr-text-muted);
}

.detail-indicators {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
}

.client-indicator {
    font-size: 12px;
    color: var(--uxrr-success, #22c55e);

    &--off {
        color: var(--uxrr-text-muted);
    }

    &--unfocused {
        color: var(--uxrr-warning, #eab308);
    }
}

.detail-loading,
.detail-error {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--uxrr-text-muted);
    font-size: 15px;
}

.detail-error {
    color: var(--uxrr-danger);
}

.detail-content {
    display: flex;
    flex: 1;
    min-height: 0;

    &.layout-bottom {
        flex-direction: column;
    }
}

.replay-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 8px;
    position: relative;
}

.playback-time-bar {
    position: absolute;
    top: 12px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 4px;
    font-family: var(--uxrr-mono);
    font-size: 11px;
    z-index: 10;
    pointer-events: none;
}

.playback-time-label {
    color: var(--uxrr-text-muted);
    font-size: 9px;
    text-transform: uppercase;
    font-weight: 600;
}

.playback-time-value {
    color: var(--uxrr-text);
}

.playback-time-sep {
    color: var(--uxrr-text-muted);
    opacity: 0.5;
}

.replay-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--uxrr-text-muted);
    font-size: 14px;
    z-index: 5;
}

.replay-status-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
}

.skip-live-btn {
    padding: 6px 16px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 12px;
    cursor: pointer;

    &:hover {
        border-color: var(--uxrr-accent);
        color: var(--uxrr-accent);
    }
}

.skip-live-link {
    margin-left: 8px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--uxrr-accent);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;

    &:hover {
        opacity: 0.8;
    }
}

.resize-handle {
    flex-shrink: 0;
    background: var(--uxrr-border);
    transition: background 0.15s;
    z-index: 10;

    &:hover,
    &:active {
        background: var(--uxrr-accent);
    }

    &--right {
        width: 4px;
        cursor: col-resize;
    }

    &--bottom {
        height: 4px;
        cursor: row-resize;
    }
}

.side-pane {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}

.tab-bar {
    display: flex;
    border-bottom: 1px solid var(--uxrr-border);
    flex-shrink: 0;
}

.tab {
    flex: 1;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;

    &.active {
        color: var(--uxrr-accent);
        border-bottom-color: var(--uxrr-accent);
    }
}

.tab-badge {
    display: inline-block;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--uxrr-accent);
    color: #fff;
    font-size: 10px;
    line-height: 16px;
}

.layout-toggle {
    flex: none;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 14px;
    cursor: pointer;
    border-bottom: 2px solid transparent;

    &:hover {
        color: var(--uxrr-accent);
    }
}

.tab-content {
    flex: 1;
    min-height: 0;
}
</style>
