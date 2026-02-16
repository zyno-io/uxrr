import type { ScopedLogger } from '@deepkit/logger';

import { RateLimiter } from '../../util/rate-limiter';
import type { IngestLogEntry } from '../ingest.service';
import type { ISessionTransport, IBufferPersistence } from './interfaces';
import type { AgentPublicInfo, IChatMessage, LiveMessage } from './types';
import { CHAT_PERSIST_DELAY_MS, FLUSH_EVENT_THRESHOLD, FLUSH_LOG_THRESHOLD } from './types';

// ── Per-session state (no WebSocket references, no Redis, no network) ──

interface AgentInfo {
    email: string;
    name?: string;
    userId?: string;
}

interface StreamSessionState {
    appId?: string;
    clientConnected: boolean;
    clientConnectedNotified: boolean;

    // Local agents on this pod
    localAgents: Map<string, AgentInfo>;

    // Remote agents reported by other pods (podId → agent list)
    remoteAgents: Map<string, AgentPublicInfo[]>;

    // Controller election
    controllerId?: string;
    controllerEmail?: string;
    controllerIsLocal: boolean;

    // Buffered data awaiting persistence
    pendingEvents: unknown[];
    pendingLogs: IngestLogEntry[];

    // Chat
    chatMessages: IChatMessage[];
    chatPersisted: boolean;
    chatDirty: boolean;
    chatPersistTimer?: ReturnType<typeof setTimeout>;
}

function createStreamSession(): StreamSessionState {
    return {
        clientConnected: false,
        clientConnectedNotified: false,
        localAgents: new Map(),
        remoteAgents: new Map(),
        controllerIsLocal: false,
        pendingEvents: [],
        pendingLogs: [],
        chatMessages: [],
        chatPersisted: false,
        chatDirty: false
    };
}

// ── LiveSessionStream ──

const wsRateLimiter = new RateLimiter(100, 1_000);

export class LiveSessionStream {
    private readonly sessions = new Map<string, StreamSessionState>();

    constructor(
        private readonly transport: ISessionTransport,
        private readonly persistence: IBufferPersistence,
        private readonly logger: ScopedLogger
    ) {}

    // ── Session access ──────────────────────────────────────────────────

    getOrCreate(sessionId: string): StreamSessionState {
        let state = this.sessions.get(sessionId);
        if (!state) {
            state = createStreamSession();
            this.sessions.set(sessionId, state);
        }
        return state;
    }

    has(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    isEmpty(sessionId: string): boolean {
        const state = this.sessions.get(sessionId);
        if (!state) return true;
        return !state.clientConnected && state.localAgents.size === 0;
    }

    delete(sessionId: string): void {
        const state = this.sessions.get(sessionId);
        if (state?.chatPersistTimer) {
            clearTimeout(state.chatPersistTimer);
        }
        this.sessions.delete(sessionId);
    }

    /** Check if any agents (local or remote) are connected for this session. */
    isAgentConnected(sessionId: string): boolean {
        const state = this.sessions.get(sessionId);
        if (!state) return false;
        if (state.localAgents.size > 0) return true;
        return this.totalRemoteAgents(state) > 0;
    }

    // ── Client lifecycle ────────────────────────────────────────────────

    onClientConnected(sessionId: string, appId: string): void {
        const state = this.getOrCreate(sessionId);
        state.appId = appId;
        state.clientConnected = true;

        const hasAgents = state.localAgents.size > 0 || this.totalRemoteAgents(state) > 0;
        if (hasAgents) {
            state.clientConnectedNotified = true;
            this.transport.broadcastToAgents(sessionId, { type: 'client_connected' });
        }
    }

    onClientDisconnected(sessionId: string): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;

        state.clientConnected = false;
        state.clientConnectedNotified = false;

        // Flush remaining buffered data
        this.flushBuffers(sessionId);

        this.transport.broadcastToAgents(sessionId, { type: 'client_disconnected' });
    }

    onClientMessage(sessionId: string, msg: LiveMessage): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;
        if (!wsRateLimiter.isAllowed(sessionId)) return;

        // Buffer events for persistence
        if (msg.type === 'events' && Array.isArray(msg.data)) {
            const events = msg.data as unknown[];
            state.pendingEvents.push(...events);

            if (state.pendingEvents.length >= FLUSH_EVENT_THRESHOLD) {
                this.flushEvents(sessionId, state);
            }
        }

        // Buffer logs for persistence
        if (msg.type === 'logs' && Array.isArray(msg.data)) {
            state.pendingLogs.push(...(msg.data as IngestLogEntry[]));
            if (state.pendingLogs.length >= FLUSH_LOG_THRESHOLD) {
                this.flushLogs(sessionId, state);
            }
        }

        // Record client chat messages
        if (msg.type === 'chat') {
            const timestamp = typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)
                ? msg.timestamp
                : Date.now();
            msg.timestamp = timestamp;
            this.recordChatMessage(sessionId, state, {
                message: msg.message as string,
                from: 'user',
                timestamp
            });
        }

        // Relay to all agents
        const relayTypes = ['events', 'logs', 'chat', 'focus', 'typing'];
        if (relayTypes.includes(msg.type)) {
            this.transport.broadcastToAgents(sessionId, msg);
        }
    }

    // ── Agent lifecycle ─────────────────────────────────────────────────

    onAgentConnected(sessionId: string, agentId: string, info: AgentInfo): {
        isController: boolean;
        isFirstAgentAnywhere: boolean;
    } {
        const state = this.getOrCreate(sessionId);
        state.localAgents.set(agentId, info);

        const isFirstAgentAnywhere = state.localAgents.size === 1 && this.totalRemoteAgents(state) === 0;

        // Claim controller if none exists
        let isController = false;
        if (!state.controllerId) {
            this.setController(sessionId, state, agentId, info.email);
            isController = true;
        } else {
            isController = this.isController(state, agentId);
        }

        // Notify client if first agent anywhere
        if (isFirstAgentAnywhere) {
            this.transport.sendToClient(sessionId, { type: 'agent_connected' });
        }

        // Tell the new agent about control state
        if (isController) {
            this.transport.sendToAgent(sessionId, agentId, { type: 'control_granted' });
        } else {
            this.transport.sendToAgent(sessionId, agentId, {
                type: 'control_revoked',
                controller: state.controllerEmail
            });
        }

        // Tell the new agent about client status + request fresh snapshot
        if (state.clientConnected) {
            state.clientConnectedNotified = true;
            this.transport.sendToAgent(sessionId, agentId, { type: 'client_connected' });

            // Always request a fresh snapshot from the client. The cached
            // snapshot becomes stale as incremental events accumulate —
            // mounting a viewer on a stale snapshot produces wrong output.
            // The response arrives via onClientMessage → broadcastToAgents,
            // so the new agent receives it through the normal event flow.
            this.transport.sendToClient(sessionId, { type: 'request_snapshot' });
        } else if (this.totalRemoteAgents(state) > 0) {
            // Client is on a remote pod
            state.clientConnectedNotified = true;
            this.transport.sendToAgent(sessionId, agentId, { type: 'client_connected' });
        }

        // Broadcast updated agent list and sync to remote pods
        this.broadcastAgentList(sessionId, state);
        this.transport.publishAgentSync(sessionId, this.localAgentPublicInfo(sessionId, state));

        return { isController, isFirstAgentAnywhere };
    }

    onAgentDisconnected(sessionId: string, agentId: string): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;

        state.localAgents.delete(agentId);
        this.flushBuffers(sessionId);

        // Transfer controller if this agent had control
        if (this.isController(state, agentId)) {
            const nextId = state.localAgents.keys().next().value as string | undefined;
            if (nextId) {
                const next = state.localAgents.get(nextId)!;
                this.setController(sessionId, state, nextId, next.email);
                this.transport.sendToAgent(sessionId, nextId, { type: 'control_granted' });
            } else {
                this.setController(sessionId, state, undefined, undefined);
            }
        }

        // Notify client if no agents remain anywhere
        if (state.localAgents.size === 0 && this.totalRemoteAgents(state) === 0) {
            this.transport.sendToClient(sessionId, { type: 'agent_disconnected' });
        }

        // Broadcast updated agent list and sync to remote pods
        this.broadcastAgentList(sessionId, state);
        this.transport.publishAgentSync(sessionId, this.localAgentPublicInfo(sessionId, state));
    }

    onAgentMessage(sessionId: string, agentId: string, msg: LiveMessage): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;
        if (!wsRateLimiter.isAllowed(sessionId)) return;

        // Handle take_control from any agent
        if (msg.type === 'take_control') {
            const prevControllerId = state.controllerId;
            const prevControllerIsLocal = state.controllerIsLocal;

            const agent = state.localAgents.get(agentId);
            this.setController(sessionId, state, agentId, agent?.email);

            // Notify previous local controller they lost control
            if (prevControllerId && prevControllerId !== agentId && prevControllerIsLocal) {
                this.transport.sendToAgent(sessionId, prevControllerId, { type: 'control_revoked' });
            }

            // Notify new controller
            this.transport.sendToAgent(sessionId, agentId, { type: 'control_granted' });
            this.broadcastAgentList(sessionId, state);
            return;
        }

        // Only the controller can send interactive messages
        if (!this.isController(state, agentId)) return;

        // Tag agent chat messages with identity and persist
        if (msg.type === 'chat') {
            const agent = state.localAgents.get(agentId);
            const timestamp = typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)
                ? msg.timestamp
                : Date.now();
            msg.from = agent?.name ?? agent?.email ?? 'agent';
            msg.timestamp = timestamp;
            this.recordChatMessage(sessionId, state, {
                message: msg.message as string,
                from: msg.from as string,
                timestamp,
                userId: agent?.userId
            });
        }

        // Forward to client
        const forwardTypes = [
            'highlight', 'cursor', 'cursor_hide', 'remote_click',
            'pen_start', 'pen_move', 'pen_end',
            'chat', 'start_chat', 'end_chat', 'typing',
            'request_snapshot'
        ];
        if (forwardTypes.includes(msg.type)) {
            this.transport.sendToClient(sessionId, msg);

            // Broadcast shared messages to other agents too
            if (['chat', 'start_chat', 'end_chat', 'pen_start', 'pen_move', 'pen_end'].includes(msg.type)) {
                this.transport.broadcastToAgents(sessionId, msg, agentId);
            }
        }
    }

    // ── HTTP ingest relay (non-WS path) ─────────────────────────────────

    relayFromIngest(sessionId: string, msg: LiveMessage): void {
        this.transport.broadcastToAgents(sessionId, msg);
    }

    // ── Remote state updates (called by transport on Redis messages) ────

    onRemoteAgentsSync(sessionId: string, podId: string, agents: AgentPublicInfo[]): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;

        const previousCount = state.remoteAgents.get(podId)?.length ?? 0;
        state.remoteAgents.set(podId, agents);
        const newCount = agents.length;
        const remoteCountIncreased = newCount > previousCount;

        this.broadcastAgentList(sessionId, state);

        // If a new remote agent joined and client is local, request fresh snapshot
        if (state.clientConnected && remoteCountIncreased) {
            this.transport.sendToClient(sessionId, { type: 'request_snapshot' });
            this.transport.broadcastToAgents(sessionId, { type: 'client_connected' });
        }
    }

    onRemoteControllerUpdate(
        sessionId: string,
        agentId: string | undefined,
        podId: string | undefined,
        email: string | undefined
    ): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;

        const prevControllerId = state.controllerId;
        const prevControllerIsLocal = state.controllerIsLocal;

        state.controllerId = agentId;
        state.controllerEmail = email;
        state.controllerIsLocal = false; // came from remote

        // Revoke the previous local controller if it was local
        if (prevControllerId && prevControllerIsLocal) {
            this.transport.sendToAgent(sessionId, prevControllerId, { type: 'control_revoked' });
        }

        this.broadcastAgentList(sessionId, state);
    }

    onRemoteRelay(sessionId: string, target: 'agents' | 'client', msg: LiveMessage): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;

        if (target === 'agents') {
            // Track client connected state from remote
            if (msg.type === 'client_connected') {
                state.clientConnectedNotified = true;
            } else if (msg.type === 'client_disconnected') {
                state.clientConnectedNotified = false;
            }

            // Record remote chat messages
            if (msg.type === 'chat') {
                const message = msg.message;
                const from = msg.from;
                const timestamp = msg.timestamp;
                if (
                    typeof message === 'string' &&
                    typeof from === 'string' &&
                    typeof timestamp === 'number' &&
                    Number.isFinite(timestamp)
                ) {
                    this.recordChatMessage(sessionId, state, { message, from, timestamp });
                }
            }

            // Infer client_connected from data messages if not yet notified
            if (!state.clientConnectedNotified && state.localAgents.size > 0) {
                if (msg.type === 'events' || msg.type === 'logs') {
                    state.clientConnectedNotified = true;
                    this.transport.broadcastToAgents(sessionId, { type: 'client_connected' });
                }
            }

            // Forward to local agents
            this.transport.broadcastToAgents(sessionId, msg);
        } else if (target === 'client') {
            // Record remote chat messages
            if (msg.type === 'chat') {
                const message = msg.message;
                const from = msg.from;
                const timestamp = msg.timestamp;
                if (
                    typeof message === 'string' &&
                    typeof from === 'string' &&
                    typeof timestamp === 'number' &&
                    Number.isFinite(timestamp)
                ) {
                    this.recordChatMessage(sessionId, state, { message, from, timestamp });
                }
            }

            this.transport.sendToClient(sessionId, msg);
        }
    }

    removeRemotePod(sessionId: string, podId: string): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;
        state.remoteAgents.delete(podId);
        this.broadcastAgentList(sessionId, state);
    }

    // ── Buffer management ───────────────────────────────────────────────

    flushBuffers(sessionId: string): void {
        const state = this.sessions.get(sessionId);
        if (!state) return;
        this.flushEvents(sessionId, state);
        this.flushLogs(sessionId, state);
    }

    async flushChat(sessionId: string): Promise<void> {
        const state = this.sessions.get(sessionId);
        if (!state) return;
        if (state.chatPersistTimer) {
            clearTimeout(state.chatPersistTimer);
            state.chatPersistTimer = undefined;
        }
        if (!state.chatDirty) return;
        await this.doPersistChat(sessionId, state);
    }

    flushAll(sessionId: string): Promise<void> {
        this.flushBuffers(sessionId);
        return this.flushChat(sessionId);
    }

    /** Flush all sessions (for shutdown). */
    async flushAllSessions(): Promise<void> {
        const flushes: Promise<void>[] = [];
        for (const [sessionId, state] of this.sessions) {
            this.flushEvents(sessionId, state);
            this.flushLogs(sessionId, state);
            flushes.push(
                this.doPersistChat(sessionId, state).catch(err => {
                    this.logger.error(`Failed to flush chat for session ${sessionId} during shutdown`, err);
                })
            );
        }
        await Promise.allSettled(flushes);
    }

    // ── Controller election ─────────────────────────────────────────────

    private isController(state: StreamSessionState, agentId: string): boolean {
        return agentId === state.controllerId && state.controllerIsLocal;
    }

    private setController(
        sessionId: string,
        state: StreamSessionState,
        agentId: string | undefined,
        email: string | undefined
    ): void {
        state.controllerId = agentId;
        state.controllerEmail = email;
        state.controllerIsLocal = agentId !== undefined;
        this.transport.publishControllerUpdate(sessionId, agentId, email);
    }

    // ── Agent list helpers ──────────────────────────────────────────────

    private totalRemoteAgents(state: StreamSessionState): number {
        let count = 0;
        for (const [, agents] of state.remoteAgents) {
            count += agents.length;
        }
        return count;
    }

    private localAgentPublicInfo(sessionId: string, state: StreamSessionState): AgentPublicInfo[] {
        return Array.from(state.localAgents.entries()).map(([id, info]) => ({
            id,
            email: info.email,
            name: info.name,
            isController: this.isController(state, id)
        }));
    }

    private broadcastAgentList(sessionId: string, state: StreamSessionState): void {
        const agents: AgentPublicInfo[] = this.localAgentPublicInfo(sessionId, state);
        for (const [, remoteList] of state.remoteAgents) {
            agents.push(...remoteList);
        }
        this.transport.broadcastAgentList(sessionId, agents);
    }

    // ── Buffer persistence helpers ──────────────────────────────────────

    private flushEvents(sessionId: string, state: StreamSessionState): void {
        if (state.pendingEvents.length === 0) return;
        const batch = state.pendingEvents.splice(0);
        this.persistence.persistEvents(sessionId, batch).catch(err => {
            this.logger.error(`Failed to persist live events for session ${sessionId}`, err);
        });
    }

    private flushLogs(sessionId: string, state: StreamSessionState): void {
        if (state.pendingLogs.length === 0) return;
        const batch = state.pendingLogs.splice(0);
        this.persistence.persistLogs(sessionId, batch).catch(err => {
            this.logger.error(`Failed to persist live logs for session ${sessionId}`, err);
        });
    }

    private recordChatMessage(sessionId: string, state: StreamSessionState, chat: IChatMessage): void {
        const last = state.chatMessages[state.chatMessages.length - 1];
        if (last && last.message === chat.message && last.from === chat.from && last.timestamp === chat.timestamp) {
            return; // Deduplicate
        }
        state.chatMessages.push(chat);
        state.chatDirty = true;
        this.scheduleChatPersist(sessionId, state);
    }

    private scheduleChatPersist(sessionId: string, state: StreamSessionState): void {
        if (state.chatPersistTimer) {
            clearTimeout(state.chatPersistTimer);
        }
        state.chatPersistTimer = setTimeout(() => {
            state.chatPersistTimer = undefined;
            if (!state.chatDirty) return;
            this.doPersistChat(sessionId, state).catch(err => {
                this.logger.error(`Failed to persist chat for session ${sessionId}`, err);
            });
        }, CHAT_PERSIST_DELAY_MS);
        state.chatPersistTimer.unref?.();
    }

    private async doPersistChat(sessionId: string, state: StreamSessionState): Promise<void> {
        if (!state.chatDirty) return;
        const markHasChat = !state.chatPersisted;
        await this.persistence.persistChat(sessionId, state.chatMessages, markHasChat);
        state.chatPersisted = true;
        state.chatDirty = false;
    }
}
