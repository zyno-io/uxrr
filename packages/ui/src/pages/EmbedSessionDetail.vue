<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import type { ISession, ILogEntry, IChatMessage } from '@/openapi-client-generated';
import { SessionApi } from '@/openapi-client-generated';
import ReplayPlayer from '@/components/ReplayPlayer.vue';
import ConsolePanel from '@/components/ConsolePanel.vue';
import NetworkPanel from '@/components/NetworkPanel.vue';
import ChatPanel from '@/components/ChatPanel.vue';
import type { ChatMessage } from '@/components/ChatPanel.vue';
import { connectEmbedLiveSession } from '@/live-stream';
import { embedState, getEmbedToken } from '@/embed';
import { useSessionDetail } from '@/composables/useSessionDetail';
import { createLogger } from '@/logger';

const log = createLogger('embed-session-detail');

const route = useRoute();
const router = useRouter();
const sessionId = route.params.id as string;
const isInteractive = computed(() => embedState.scope === 'interactive');
const isSessionSpecific = computed(() => !!embedState.sessionId);

// ── Session-specific state ───────────────────────────────────────
const interactionMode = ref<'view' | 'pointer' | 'highlight' | 'pen'>('view');
const localAgentName = computed(() => (isInteractive.value ? 'Embed User' : 'Agent'));

// ── Use composable for shared logic ──────────────────────────────
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
    toggleLayout,
    startResize,
    skipLive,
    onTimeUpdate,
    seekTo,
    formatLocal,
    formatUtc,
    formatMeta,
    getLiveStream
} = useSessionDetail({
    loggerScope: 'embed-session-detail',
    loadSession: () => SessionApi.getSessionGetSession({ path: { id: sessionId } }).then(r => dataFrom(r) as unknown as ISession),
    loadEvents: () => SessionApi.getSessionGetSessionEvents({ path: { id: sessionId } }).then(r => dataFrom(r)),
    loadLogs: (since?: number) => SessionApi.getSessionGetSessionLogs({ path: { id: sessionId }, query: { since } }).then(r => dataFrom(r) as ILogEntry[]),
    loadChat: async () => {
        const c = await SessionApi.getSessionGetSessionChat({ path: { id: sessionId } });
        const messages = dataFrom(c) as IChatMessage[];
        return messages.map(m => ({
            message: m.message,
            from: m.from,
            timestamp: m.timestamp
        }));
    },
    connectLive: callbacks => {
        const token = getEmbedToken();
        if (!token) {
            log.warn('cannot start live mode — no embed token');
            throw new Error('No embed token');
        }
        return connectEmbedLiveSession(sessionId, token, embedState.scope ?? 'readonly', callbacks);
    },
    interactive: isInteractive.value
});

const chatReadonly = computed(() => !isInteractive.value || !isLive.value);

// ── Interaction handling ─────────────────────────────────────────
let lastCursorSend = 0;
let isPenDown = false;

function onInteract(type: string, vx: number, vy: number, _lx: number, _ly: number) {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;

    switch (interactionMode.value) {
        case 'view':
            break;

        case 'pointer':
            if (type === 'mousemove') {
                const now = Date.now();
                if (now - lastCursorSend < 30) return;
                lastCursorSend = now;
                liveStream.send({ type: 'cursor', x: vx, y: vy });
            } else if (type === 'click') {
                liveStream.send({ type: 'remote_click', x: vx, y: vy });
            }
            break;

        case 'highlight':
            if (type === 'click') {
                liveStream.send({ type: 'highlight', x: vx, y: vy });
            }
            break;

        case 'pen':
            if (type === 'mousedown') {
                isPenDown = true;
                liveStream.send({ type: 'pen_start', x: vx, y: vy });
            } else if (type === 'mousemove' && isPenDown) {
                liveStream.send({ type: 'pen_move', x: vx, y: vy });
            } else if (type === 'mouseup' && isPenDown) {
                isPenDown = false;
                liveStream.send({ type: 'pen_end' });
            }
            break;
    }
}

function onInteractEnd() {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;
    if (interactionMode.value === 'pointer') {
        liveStream.send({ type: 'cursor_hide' });
    }
    if (isPenDown) {
        isPenDown = false;
        liveStream.send({ type: 'pen_end' });
    }
}

function takeControl() {
    getLiveStream()?.send({ type: 'take_control' });
}

function onStartChat() {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;
    if (chatStarted.value) {
        chatMessages.value.push({ message: '', from: '__separator', timestamp: Date.now() });
    }
    chatStarted.value = true;
    chatActive.value = true;
    liveStream.send({ type: 'start_chat' });
}

function onChatSend(message: string) {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;
    liveStream.send({ type: 'chat', message });
    chatMessages.value.push({ message, from: localAgentName.value, timestamp: Date.now() });
}

function onEndChat() {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;
    liveStream.send({ type: 'end_chat' });
    chatActive.value = false;
}

let lastAgentTypingSent = 0;

function onAgentTyping() {
    const liveStream = getLiveStream();
    if (!liveStream || !isInteractive.value || !hasControl.value) return;
    const now = Date.now();
    if (now - lastAgentTypingSent < 1000) return;
    lastAgentTypingSent = now;
    liveStream.send({ type: 'typing' });
}

function goBack() {
    const token = getEmbedToken();
    router.push({ name: 'embed-sessions', query: { token: token ?? undefined } });
}
</script>

<template>
    <div class="session-detail">
        <div class="detail-header">
            <button v-if="!isSessionSpecific" class="back-btn" @click="goBack">&larr; Sessions</button>
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
                    <div v-if="isInteractive && liveStatus === 'live' && hasControl" class="interaction-toolbar">
                        <button
                            :class="['tool-btn', { active: interactionMode === 'view' }]"
                            @click="interactionMode = 'view'"
                            title="View only"
                        >
                            V
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'pointer' }]"
                            @click="interactionMode = 'pointer'"
                            title="Cursor"
                        >
                            &#9654;
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'highlight' }]"
                            @click="interactionMode = 'highlight'"
                            title="Highlight"
                        >
                            &#9673;
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'pen' }]"
                            @click="interactionMode = 'pen'"
                            title="Pen"
                        >
                            &#9998;
                        </button>
                    </div>
                    <button
                        v-if="isInteractive && liveStatus === 'live' && !hasControl"
                        class="take-control-btn"
                        @click="takeControl"
                    >
                        Take Control
                    </button>
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
                    @interact="onInteract"
                    @interact-end="onInteractEnd"
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
                        :chat-active="chatActive"
                        :client-connected="clientConnected"
                        :user-typing="userTyping"
                        :readonly="chatReadonly || !hasControl"
                        @send="onChatSend"
                        @start-chat="onStartChat"
                        @end-chat="onEndChat"
                        @typing="onAgentTyping"
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

.back-btn {
    padding: 4px 10px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-text);
    font-size: 13px;
    cursor: pointer;

    &:hover {
        border-color: var(--uxrr-accent);
        color: var(--uxrr-accent);
    }
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

.take-control-btn {
    padding: 4px 12px;
    border: 1px solid var(--uxrr-accent);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        background: var(--uxrr-accent);
        color: #fff;
    }
}

.interaction-toolbar {
    display: flex;
    gap: 2px;
}

.tool-btn {
    padding: 3px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 3px;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 14px;
    cursor: pointer;

    &.active {
        background: var(--uxrr-accent);
        color: #fff;
        border-color: var(--uxrr-accent);
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
