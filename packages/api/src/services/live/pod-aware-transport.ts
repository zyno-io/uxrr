import { ScopedLogger } from '@deepkit/logger';

import type { PodPresenceService } from '../pod-presence.service';
import type { RedisService } from '../redis.service';
import type { ISessionTransport } from './interfaces';
import type { AgentPublicInfo, LiveMessage, RedisSessionMessage, SessionConnections } from './types';
import { CHANNEL_DATA_PREFIX } from './types';

/**
 * Delivery-only transport layer.
 * Sends messages to local WebSockets and/or publishes to Redis for remote pods.
 * Contains zero routing/business logic — that lives in LiveSessionStream.
 */
export class PodAwareTransport implements ISessionTransport {
    /**
     * Map of sessionId → SessionConnections, shared with LiveSessionService.
     * Set via `bindSessions()` after construction.
     */
    private sessions!: Map<string, SessionConnections>;

    constructor(
        private readonly logger: ScopedLogger,
        private readonly redis: RedisService,
        private readonly presence: PodPresenceService
    ) {}

    /** Bind the shared sessions map (called once by LiveSessionService). */
    bindSessions(sessions: Map<string, SessionConnections>): void {
        this.sessions = sessions;
    }

    // ── ISessionTransport implementation ─────────────────────────────────

    sendToClient(sessionId: string, msg: LiveMessage): void {
        const conn = this.sessions.get(sessionId);
        if (conn?.clientWs?.readyState === 1) {
            conn.clientWs.send(JSON.stringify(msg));
        } else if (this.presence.hasRemoteInterest(sessionId)) {
            this.publishToDataChannel(sessionId, { kind: 'relay', target: 'client', message: msg });
        }
    }

    sendToAgent(sessionId: string, agentId: string, msg: LiveMessage): void {
        const conn = this.sessions.get(sessionId);
        if (!conn) return;
        const agent = conn.agents.get(agentId);
        if (agent?.ws.readyState === 1) {
            agent.ws.send(JSON.stringify(msg));
        }
    }

    broadcastToAgents(sessionId: string, msg: LiveMessage, excludeAgentId?: string): void {
        const conn = this.sessions.get(sessionId);
        if (!conn || conn.agents.size === 0) return;
        const raw = JSON.stringify(msg);
        for (const [id, a] of conn.agents) {
            if (excludeAgentId && id === excludeAgentId) continue;
            if (a.ws.readyState === 1) a.ws.send(raw);
        }
        // Also publish to remote pods
        if (this.presence.hasRemoteInterest(sessionId)) {
            this.publishToDataChannel(sessionId, { kind: 'relay', target: 'agents', message: msg });
        }
    }

    broadcastAgentList(sessionId: string, agents: AgentPublicInfo[]): void {
        const conn = this.sessions.get(sessionId);
        if (!conn) return;
        const raw = JSON.stringify({ type: 'agents_updated', agents });
        for (const [, a] of conn.agents) {
            if (a.ws.readyState === 1) a.ws.send(raw);
        }
    }

    publishControllerUpdate(sessionId: string, agentId: string | undefined, email: string | undefined): void {
        if (!this.presence.hasRemoteInterest(sessionId)) return;
        this.publishToDataChannel(sessionId, {
            kind: 'controller_update',
            agentId,
            podId: agentId ? this.presence.podId : undefined,
            email
        });
    }

    publishAgentSync(sessionId: string, localAgents: AgentPublicInfo[]): void {
        if (!this.presence.hasRemoteInterest(sessionId)) return;
        this.publishToDataChannel(sessionId, { kind: 'agents_sync', agents: localAgents });
    }

    // ── Redis data channel ───────────────────────────────────────────────

    private publishToDataChannel(sessionId: string, payload: object): void {
        this.redis.publish(CHANNEL_DATA_PREFIX + sessionId, {
            ...payload,
            sourcePod: this.presence.podId
        });
    }

    /**
     * Create the Redis message handler that delegates to LiveSessionStream callbacks.
     * The returned function is bound to a specific channel subscription.
     */
    createRedisHandler(callbacks: {
        onRemoteRelay: (sessionId: string, target: 'agents' | 'client', msg: LiveMessage) => void;
        onRemoteAgentsSync: (sessionId: string, podId: string, agents: AgentPublicInfo[]) => void;
        onRemoteControllerUpdate: (sessionId: string, agentId: string | undefined, podId: string | undefined, email: string | undefined) => void;
    }): (channel: string, raw: string) => void {
        return (channel: string, raw: string) => {
            try {
                const msg = JSON.parse(raw) as RedisSessionMessage;
                if (msg.sourcePod === this.presence.podId) return;

                const sessionId = channel.slice(CHANNEL_DATA_PREFIX.length);

                switch (msg.kind) {
                    case 'relay':
                        callbacks.onRemoteRelay(sessionId, msg.target, msg.message as LiveMessage);
                        break;
                    case 'agents_sync':
                        callbacks.onRemoteAgentsSync(sessionId, msg.sourcePod, msg.agents);
                        break;
                    case 'controller_update':
                        callbacks.onRemoteControllerUpdate(sessionId, msg.agentId, msg.podId, msg.email);
                        break;
                }
            } catch (err) {
                this.logger.error('Failed to process Redis session message', err);
            }
        };
    }

    // ── Redis subscription lifecycle ─────────────────────────────────────

    async subscribe(sessionId: string, conn: SessionConnections, handler: (channel: string, raw: string) => void): Promise<void> {
        conn.localConnectionCount++;
        if (conn.localConnectionCount === 1) {
            this.presence.register(sessionId);
            await this.redis.subscribe(CHANNEL_DATA_PREFIX + sessionId, handler);
        }
    }

    unsubscribe(sessionId: string, conn: SessionConnections, handler: (channel: string, raw: string) => void): void {
        conn.localConnectionCount = Math.max(0, conn.localConnectionCount - 1);
        if (conn.localConnectionCount === 0) {
            this.presence.deregister(sessionId);
            this.redis.unsubscribe(CHANNEL_DATA_PREFIX + sessionId, handler);
        }
    }
}
