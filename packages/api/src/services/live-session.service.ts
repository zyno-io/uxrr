import { randomUUID } from 'crypto';

import { eventDispatcher } from '@deepkit/event';
import { ScopedLogger } from '@deepkit/logger';
import type WebSocket from 'ws';
import { onServerShutdownRequested } from '@zyno-io/dk-server-foundation';

import { UxrrDatabase } from '../database/database';
import { LokiService } from './loki.service';
import { PodPresenceService } from './pod-presence.service';
import { RedisService } from './redis.service';
import { S3Service } from './s3.service';
import { SessionNotifyService } from './session-notify.service';

import { LiveBufferPersistence } from './live/live-buffer-persistence';
import { LiveSessionStream } from './live/live-session-stream';
import { PodAwareTransport } from './live/pod-aware-transport';
import { createSessionConnections, FLUSH_INTERVAL_MS, PING_INTERVAL_MS, PONG_TIMEOUT_MS } from './live/types';
import type { AgentConnection, LiveMessage, SessionConnections } from './live/types';

export type { LiveMessage, IChatMessage } from './live/types';

export class LiveSessionService {
    private readonly sessions = new Map<string, SessionConnections>();
    private readonly transport: PodAwareTransport;
    private readonly stream: LiveSessionStream;
    private readonly boundRedisHandler: (channel: string, raw: string) => void;

    constructor(
        private readonly logger: ScopedLogger,
        s3: S3Service,
        db: UxrrDatabase,
        notify: SessionNotifyService,
        loki: LokiService,
        redis: RedisService,
        private readonly presence: PodPresenceService
    ) {
        this.transport = new PodAwareTransport(logger, redis, presence);
        this.transport.bindSessions(this.sessions);

        const persistence = new LiveBufferPersistence(logger, s3, db, loki, notify);
        this.stream = new LiveSessionStream(this.transport, persistence, logger);

        this.boundRedisHandler = this.transport.createRedisHandler({
            onRemoteRelay: (sessionId, target, msg) => this.stream.onRemoteRelay(sessionId, target, msg),
            onRemoteAgentsSync: (sessionId, podId, agents) => this.stream.onRemoteAgentsSync(sessionId, podId, agents),
            onRemoteControllerUpdate: (sessionId, agentId, podId, email) =>
                this.stream.onRemoteControllerUpdate(sessionId, agentId, podId, email)
        });
    }

    // ── Public API ──────────────────────────────────────────────────────

    async connectAgent(
        sessionId: string,
        ws: WebSocket,
        agentEmail?: string,
        agentName?: string,
        agentUserId?: string
    ): Promise<void> {
        const conn = this.getOrCreate(sessionId);
        const agentId = randomUUID();
        const email = agentEmail ?? 'agent';

        const agent: AgentConnection = { ws, email, name: agentName, userId: agentUserId, lastPong: Date.now() };
        conn.agents.set(agentId, agent);

        this.logger.debug(`Agent ${email} (${agentId}) connected to session ${sessionId} (local: ${conn.agents.size})`);

        // Subscribe to Redis before the stream broadcasts
        await this.transport.subscribe(sessionId, conn, this.boundRedisHandler);

        // Delegate all routing/state to the stream
        this.stream.onAgentConnected(sessionId, agentId, { email, name: agentName, userId: agentUserId });

        // Ensure health checks
        this.ensurePingTimer(sessionId, conn);

        ws.on('pong', () => {
            agent.lastPong = Date.now();
        });

        ws.on('message', (raw: Buffer) => {
            try {
                this.stream.onAgentMessage(sessionId, agentId, JSON.parse(raw.toString()) as LiveMessage);
            } catch {
                this.logger.warn(`Invalid message from agent on session ${sessionId}`);
            }
        });

        ws.on('close', () => {
            const c = this.sessions.get(sessionId);
            if (c) {
                c.agents.delete(agentId);
                this.stream.onAgentDisconnected(sessionId, agentId);
                this.transport.unsubscribe(sessionId, c, this.boundRedisHandler);
                this.cleanupIfEmpty(sessionId);
            }
            this.logger.debug(`Agent ${email} (${agentId}) disconnected from session ${sessionId}`);
        });
    }

    async connectClient(sessionId: string, appId: string, ws: WebSocket): Promise<void> {
        const conn = this.getOrCreate(sessionId);
        const previousClientWs = conn.clientWs;
        if (previousClientWs && previousClientWs !== ws && previousClientWs.readyState !== 3) {
            previousClientWs.terminate();
        }
        conn.appId = appId;
        conn.clientWs = ws;
        conn.clientLastPong = Date.now();
        this.logger.debug(`Client connected to session ${sessionId}`);

        // Subscribe to Redis before broadcasting
        await this.transport.subscribe(sessionId, conn, this.boundRedisHandler);

        // Delegate to stream
        this.stream.onClientConnected(sessionId, appId);

        // Start flush timer for batched persistence
        if (!conn.flushTimer) {
            conn.flushTimer = setInterval(() => this.stream.flushBuffers(sessionId), FLUSH_INTERVAL_MS);
        }

        this.ensurePingTimer(sessionId, conn);

        ws.on('pong', () => {
            conn.clientLastPong = Date.now();
        });

        ws.on('message', (raw: Buffer) => {
            try {
                this.stream.onClientMessage(sessionId, JSON.parse(raw.toString()) as LiveMessage);
            } catch {
                this.logger.warn(`Invalid message from client on session ${sessionId}`);
            }
        });

        ws.on('close', () => {
            const c = this.sessions.get(sessionId);
            if (c) {
                if (c.clientWs !== ws) return;
                c.clientWs = undefined;
                this.stream.onClientDisconnected(sessionId);
                this.transport.unsubscribe(sessionId, c, this.boundRedisHandler);
                this.cleanupIfEmpty(sessionId);
            }
            this.logger.debug(`Client disconnected from session ${sessionId}`);
        });
    }

    async connectSharedViewer(sessionId: string, ws: WebSocket): Promise<void> {
        const conn = this.getOrCreate(sessionId);
        const agentId = randomUUID();

        // Shared viewers are registered as agents but never get controller
        const agent: AgentConnection = { ws, email: 'shared-viewer', name: 'Shared Viewer', lastPong: Date.now() };
        conn.agents.set(agentId, agent);

        this.logger.debug(`Shared viewer (${agentId}) connected to session ${sessionId}`);

        // Subscribe to Redis
        await this.transport.subscribe(sessionId, conn, this.boundRedisHandler);

        // Delegate to stream — shared viewers connect like agents
        this.stream.onAgentConnected(sessionId, agentId, { email: 'shared-viewer', name: 'Shared Viewer' });

        this.ensurePingTimer(sessionId, conn);

        ws.on('pong', () => {
            agent.lastPong = Date.now();
        });

        // Shared viewers cannot send messages
        ws.on('message', () => {});

        ws.on('close', () => {
            const c = this.sessions.get(sessionId);
            if (c) {
                c.agents.delete(agentId);
                this.stream.onAgentDisconnected(sessionId, agentId);
                this.transport.unsubscribe(sessionId, c, this.boundRedisHandler);
                this.cleanupIfEmpty(sessionId);
            }
            this.logger.debug(`Shared viewer (${agentId}) disconnected from session ${sessionId}`);
        });
    }

    isAgentConnected(sessionId: string): boolean {
        if (this.stream.isAgentConnected(sessionId)) return true;
        return this.presence.hasAnyInterest(sessionId);
    }

    relayToAgent(sessionId: string, message: LiveMessage): void {
        this.stream.relayFromIngest(sessionId, message);
    }

    // ── Internal helpers ────────────────────────────────────────────────

    @eventDispatcher.listen(onServerShutdownRequested)
    async onServerShutdownRequested(): Promise<void> {
        this.logger.info('Shutdown requested; flushing pending live buffers');
        await this.stream.flushAllSessions();
    }

    private ensurePingTimer(sessionId: string, conn: SessionConnections): void {
        if (conn.pingTimer) return;

        conn.pingTimer = setInterval(() => {
            const now = Date.now();
            const timeout = PING_INTERVAL_MS + PONG_TIMEOUT_MS;

            if (conn.clientWs?.readyState === 1) {
                if (conn.clientLastPong && now - conn.clientLastPong > timeout) {
                    this.logger.warn(`Client pong timeout for session ${sessionId}, terminating`);
                    conn.clientWs.terminate();
                } else {
                    conn.clientWs.ping();
                }
            }

            for (const [agentId, agent] of conn.agents) {
                if (agent.ws.readyState === 1) {
                    if (now - agent.lastPong > timeout) {
                        this.logger.warn(`Agent ${agentId} pong timeout for session ${sessionId}, terminating`);
                        agent.ws.terminate();
                    } else {
                        agent.ws.ping();
                    }
                }
            }
        }, PING_INTERVAL_MS);
    }

    private getOrCreate(sessionId: string): SessionConnections {
        let conn = this.sessions.get(sessionId);
        if (!conn) {
            conn = createSessionConnections();
            this.sessions.set(sessionId, conn);
        }
        return conn;
    }

    private cleanupIfEmpty(sessionId: string): void {
        const conn = this.sessions.get(sessionId);
        if (conn && !conn.clientWs && conn.agents.size === 0) {
            this.stream.flushAll(sessionId).catch(err => {
                this.logger.error(`Failed to flush during cleanup for session ${sessionId}`, err);
            });
            this.stream.delete(sessionId);
            if (conn.flushTimer) clearInterval(conn.flushTimer);
            if (conn.pingTimer) clearInterval(conn.pingTimer);
            this.sessions.delete(sessionId);
        }
    }
}
