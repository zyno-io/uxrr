<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import type {
    ISession,
    ILogEntry,
    IChatMessage,
    GetSessionGetShareLinkResponse,
    PostSessionCreateShareLinkResponse
} from '@/openapi-client-generated';
import { SessionApi } from '@/openapi-client-generated';
import ReplayPlayer from '@/components/ReplayPlayer.vue';
import ConsolePanel from '@/components/ConsolePanel.vue';
import NetworkPanel from '@/components/NetworkPanel.vue';
import ChatPanel from '@/components/ChatPanel.vue';
import UserInfoPopover from '@/components/UserInfoPopover.vue';
import type { ChatMessage } from '@/components/ChatPanel.vue';
import { connectLiveSession, type AgentInfo } from '@/live-stream';
import { showToast } from '@zyno-io/vue-foundation';
import { authState, grafanaConfig } from '@/auth';
import { useSessionDetail } from '@/composables/useSessionDetail';
import { createLogger } from '@/logger';

const log = createLogger('session-detail');

const route = useRoute();
const router = useRouter();
const sessionId = route.params.id as string;

// ── Session-specific state ───────────────────────────────────────
const interactionMode = ref<'view' | 'pointer' | 'highlight' | 'pen'>('view');
const connectedAgents = ref<AgentInfo[]>([]);
const localAgentName = computed(() => authState.me?.userName || authState.me?.userEmail || 'Agent');

// ── Click highlight rendering ────────────────────────────────────
const highlightContainerRef = ref<HTMLDivElement>();

function showLocalHighlight(lx: number, ly: number): void {
    const container = highlightContainerRef.value;
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'click-ring';
    el.style.left = `${lx}px`;
    el.style.top = `${ly}px`;
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

// ── Pen rendering ────────────────────────────────────────────────
const penSvgRef = ref<SVGSVGElement>();
let currentPenPath: SVGPolylineElement | null = null;
let penPoints: string[] = [];

function penRenderStart(lx: number, ly: number): void {
    const svg = penSvgRef.value;
    if (!svg) return;
    penPoints = [`${lx},${ly}`];
    currentPenPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    currentPenPath.setAttribute('points', penPoints.join(' '));
    currentPenPath.setAttribute('fill', 'none');
    currentPenPath.setAttribute('stroke', 'rgba(239, 68, 68, 0.8)');
    currentPenPath.setAttribute('stroke-width', '3');
    currentPenPath.setAttribute('stroke-linecap', 'round');
    currentPenPath.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(currentPenPath);
}

function penRenderMove(lx: number, ly: number): void {
    if (!currentPenPath) return;
    penPoints.push(`${lx},${ly}`);
    currentPenPath.setAttribute('points', penPoints.join(' '));
}

function penRenderEnd(): void {
    const path = currentPenPath;
    currentPenPath = null;
    penPoints = [];
    if (path) {
        path.style.transition = 'opacity 1s ease-out';
        path.style.transitionDelay = '2s';
        path.style.opacity = '0';
        setTimeout(() => path.remove(), 3000);
    }
}

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
    livePlayerReady,
    clientEverConnected,
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
    loggerScope: 'session-detail',
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
    connectLive: callbacks => connectLiveSession(sessionId, callbacks),
    interactive: true,
    onAgentsUpdated: agents => {
        connectedAgents.value = agents;
    },
    onPenStart: (lx, ly) => penRenderStart(lx, ly),
    onPenMove: (lx, ly) => penRenderMove(lx, ly),
    onPenEnd: () => penRenderEnd()
});

const chatReadonly = computed(() => !isLive.value);

// ── Interaction handling ─────────────────────────────────────────
let lastCursorSend = 0;
let isPenDown = false;

function onInteract(type: string, vx: number, vy: number, lx: number, ly: number) {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;

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
                showLocalHighlight(lx, ly);
            }
            break;

        case 'highlight':
            if (type === 'click') {
                liveStream.send({ type: 'highlight', x: vx, y: vy });
                showLocalHighlight(lx, ly);
            }
            break;

        case 'pen':
            if (type === 'mousedown') {
                isPenDown = true;
                liveStream.send({ type: 'pen_start', x: vx, y: vy });
                penRenderStart(lx, ly);
            } else if (type === 'mousemove' && isPenDown) {
                liveStream.send({ type: 'pen_move', x: vx, y: vy });
                penRenderMove(lx, ly);
            } else if (type === 'mouseup' && isPenDown) {
                isPenDown = false;
                liveStream.send({ type: 'pen_end' });
                penRenderEnd();
            }
            break;
    }
}

function onInteractEnd() {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;
    if (interactionMode.value === 'pointer') {
        liveStream.send({ type: 'cursor_hide' });
    }
    if (isPenDown) {
        isPenDown = false;
        liveStream.send({ type: 'pen_end' });
        penRenderEnd();
    }
}

function takeControl() {
    getLiveStream()?.send({ type: 'take_control' });
}

function onStartChat() {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;
    if (chatStarted.value) {
        // Restarting after a previous end — add separator
        chatMessages.value.push({ message: '', from: '__separator', timestamp: Date.now() });
    }
    chatStarted.value = true;
    chatActive.value = true;
    liveStream.send({ type: 'start_chat' });
}

function onChatSend(message: string) {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;
    liveStream.send({ type: 'chat', message });
    chatMessages.value.push({ message, from: localAgentName.value, timestamp: Date.now() });
}

function onEndChat() {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;
    liveStream.send({ type: 'end_chat' });
    chatActive.value = false;
}

let lastAgentTypingSent = 0;

function onAgentTyping() {
    const liveStream = getLiveStream();
    if (!liveStream || !hasControl.value) return;
    const now = Date.now();
    if (now - lastAgentTypingSent < 1000) return;
    lastAgentTypingSent = now;
    liveStream.send({ type: 'typing' });
}

// ── Share link ───────────────────────────────────────────────────
const showShareDialog = ref(false);
const shareToken = ref<string | null>(null);
const shareExpiresAt = ref<string | null>(null);
const shareLoading = ref(false);
const shareLinkHasActive = ref(false);

const shareUrl = computed(() => {
    if (!shareToken.value) return '';
    return `${window.location.origin}/share/${shareToken.value}`;
});

const shareWrapperRef = ref<HTMLElement>();

function onDocumentClick(e: MouseEvent) {
    if (shareWrapperRef.value && !shareWrapperRef.value.contains(e.target as Node)) {
        showShareDialog.value = false;
    }
}

watch(showShareDialog, open => {
    if (open) {
        document.addEventListener('click', onDocumentClick);
    } else {
        document.removeEventListener('click', onDocumentClick);
    }
});

async function openShareDialog() {
    if (showShareDialog.value) {
        showShareDialog.value = false;
        return;
    }
    showShareDialog.value = true;
    shareToken.value = null;
    shareLoading.value = true;
    try {
        log.log('fetching share link status');
        const status = await SessionApi.getSessionGetShareLink({ path: { id: sessionId } });
        const data = dataFrom(status) as unknown as GetSessionGetShareLinkResponse;
        shareLinkHasActive.value = data.active;
        if (data.active) {
            shareToken.value = data.token ?? null;
            shareExpiresAt.value = data.expiresAt ?? null;
            log.log('share link active, expires:', data.expiresAt);
        } else {
            log.log('no active share link');
        }
    } catch (err) {
        log.warn('failed to fetch share link status:', err);
        shareLinkHasActive.value = false;
    } finally {
        shareLoading.value = false;
    }
}

async function createShare() {
    log.log('creating share link');
    shareLoading.value = true;
    try {
        const result = await SessionApi.postSessionCreateShareLink({ path: { id: sessionId } });
        const data = dataFrom(result) as unknown as PostSessionCreateShareLinkResponse;
        shareToken.value = data.token;
        shareExpiresAt.value = data.expiresAt;
        shareLinkHasActive.value = true;
        log.log('share link created, expires:', data.expiresAt);
    } catch (err) {
        log.error('failed to create share link:', err);
    } finally {
        shareLoading.value = false;
    }
}

async function revokeShare() {
    log.log('revoking share link');
    shareLoading.value = true;
    try {
        await SessionApi.deleteSessionRevokeShareLink({ path: { id: sessionId } });
        shareToken.value = null;
        shareExpiresAt.value = null;
        shareLinkHasActive.value = false;
        log.log('share link revoked');
    } catch (err) {
        log.error('failed to revoke share link:', err);
    } finally {
        shareLoading.value = false;
    }
}

function formatTimeRemaining(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'expired';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return remainMins > 0 ? `in ${hrs}h ${remainMins}m` : `in ${hrs}h`;
}

async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl.value);
    showToast({ message: 'Copied to clipboard', durationSecs: 2 });
}

function filterByUser(userId: string) {
    router.push({ path: '/', query: { userId } });
}
</script>

<template>
    <div class="session-detail">
        <div class="detail-header">
            <button class="back-btn" @click="router.push('/')">&larr; Sessions</button>
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
                    <span v-if="session.userId" class="meta-sep">/</span>
                    <UserInfoPopover
                        v-if="session.userId"
                        :user-id="session.userId"
                        :user-name="session.userName"
                        :user-email="session.userEmail"
                        @filter="filterByUser"
                    >
                        <span class="detail-user"
                            >User: {{ session.userName || session.userEmail || session.userId }}</span
                        >
                    </UserInfoPopover>
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
                    <span v-if="liveStatus === 'live' && connectedAgents.length > 1" class="agents-count">
                        {{ connectedAgents.length }} viewing
                    </span>
                    <div v-if="liveStatus === 'live' && hasControl" class="interaction-toolbar">
                        <button
                            :class="['tool-btn', { active: interactionMode === 'view' }]"
                            @click="interactionMode = 'view'"
                            v-tooltip="'View only'"
                        >
                            &#8857;
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'pointer' }]"
                            @click="interactionMode = 'pointer'"
                            v-tooltip="'Cursor'"
                        >
                            &#9654;
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'highlight' }]"
                            @click="interactionMode = 'highlight'"
                            v-tooltip="'Highlight'"
                        >
                            &#9673;
                        </button>
                        <button
                            :class="['tool-btn', { active: interactionMode === 'pen' }]"
                            @click="interactionMode = 'pen'"
                            v-tooltip="'Pen'"
                        >
                            &#9998;
                        </button>
                    </div>
                    <button v-if="liveStatus === 'live' && !hasControl" class="take-control-btn" @click="takeControl">
                        Take Control
                    </button>
                    <div ref="shareWrapperRef" class="share-wrapper" @click.stop>
                        <button class="share-btn" @click="openShareDialog">Share</button>
                        <div v-if="showShareDialog" class="share-dialog">
                            <div v-if="shareLoading" class="share-dialog-loading">Loading...</div>
                            <template v-else-if="shareToken">
                                <input
                                    readonly
                                    :value="shareUrl"
                                    class="share-url-input"
                                    @focus="($event.target as HTMLInputElement).select()"
                                />
                                <div class="share-dialog-actions">
                                    <button class="share-copy-btn" @click="copyShareUrl">Copy</button>
                                    <button
                                        class="share-rotate-btn"
                                        @click="createShare"
                                        title="Generate a new link and revoke the current one"
                                    >
                                        Rotate
                                    </button>
                                    <button class="share-revoke-btn" @click="revokeShare">Disable</button>
                                </div>
                                <div v-if="shareExpiresAt" class="share-expiry">
                                    Expires {{ formatTimeRemaining(shareExpiresAt) }}
                                </div>
                            </template>
                            <template v-else>
                                <button class="share-generate-btn" @click="createShare">Generate Share Link</button>
                            </template>
                        </div>
                    </div>
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
                <div v-if="isLive" ref="highlightContainerRef" class="click-overlay" />
                <svg v-if="isLive" ref="penSvgRef" class="pen-overlay" width="100%" height="100%" />
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
                        {{ layout === 'right' ? '⬓' : '⬔' }}
                    </button>
                </div>
                <div class="tab-content">
                    <ConsolePanel
                        v-show="activeTab === 'console'"
                        :logs="consoleLogs"
                        :current-time-ms="currentTimeMs"
                        :session-start-ms="sessionStartMs"
                        :grafana="grafanaConfig"
                        @seek="seekTo"
                    />
                    <NetworkPanel
                        v-show="activeTab === 'network'"
                        :entries="networkLogs"
                        :current-time-ms="currentTimeMs"
                        :session-start-ms="sessionStartMs"
                        :grafana="grafanaConfig"
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

.agents-count {
    font-size: 11px;
    color: var(--uxrr-text-muted);
    padding: 2px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 3px;
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
    min-width: 28px;
    text-align: center;

    &.active {
        background: var(--uxrr-accent);
        color: #fff;
        border-color: var(--uxrr-accent);
    }
}

.share-wrapper {
    position: relative;
}

.share-btn {
    padding: 4px 12px;
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

.share-dialog {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 360px;
    padding: 12px;
    background: var(--uxrr-surface);
    border: 1px solid var(--uxrr-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.share-dialog-loading {
    font-size: 12px;
    color: var(--uxrr-text-muted);
    text-align: center;
    padding: 8px;
}

.share-url-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font-family: var(--uxrr-mono);
    font-size: 11px;
}

.share-dialog-actions {
    display: flex;
    gap: 8px;
}

.share-copy-btn {
    flex: 1;
    padding: 6px 12px;
    border: 1px solid var(--uxrr-accent);
    border-radius: 4px;
    background: var(--uxrr-accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        background: var(--uxrr-accent-hover);
    }
}

.share-rotate-btn {
    padding: 6px 12px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-text);
    font-size: 12px;
    cursor: pointer;

    &:hover {
        border-color: var(--uxrr-accent);
        color: var(--uxrr-accent);
    }
}

.share-revoke-btn {
    padding: 6px 12px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-danger);
    font-size: 12px;
    cursor: pointer;

    &:hover {
        border-color: var(--uxrr-danger);
    }
}

.share-generate-btn {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--uxrr-accent);
    border-radius: 4px;
    background: var(--uxrr-accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        background: var(--uxrr-accent-hover);
    }
}

.share-expiry {
    font-size: 10px;
    color: var(--uxrr-text-muted);
}

.detail-user {
    font-size: 12px;
    color: var(--uxrr-text-muted);
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

.click-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;

    :deep(.click-ring) {
        position: absolute;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.5);
        transform: translate(-50%, -50%) scale(0);
        animation: click-pulse 0.6s ease-out forwards;
    }
}

@keyframes click-pulse {
    0% {
        transform: translate(-50%, -50%) scale(0);
        opacity: 1;
    }
    100% {
        transform: translate(-50%, -50%) scale(3);
        opacity: 0;
    }
}

.pen-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
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
