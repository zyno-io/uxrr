import { randomUUID } from 'crypto';

import { ScopedLogger } from '@deepkit/logger';

import { RedisService } from './redis.service';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_S = 30;
const SWEEP_INTERVAL_MS = 15_000;

const KEY_POD_ALIVE = 'uxrr:pod:alive:';
const KEY_SESSION_PODS = 'uxrr:live:pods:';
const CHANNEL_PRESENCE = 'uxrr:live:presence';

interface PresenceEvent {
    podId: string;
    sessionId: string;
    action: 'joined' | 'left';
}

export class PodPresenceService {
    readonly podId = randomUUID();

    /** sessionId → Set<podId> (all pods, including this one) */
    private readonly sessionPods = new Map<string, Set<string>>();

    /** All known-alive pods (including this pod) */
    private readonly alivePods = new Set<string>();

    /** Sessions this pod has local connections for */
    private readonly localSessions = new Set<string>();

    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private sweepTimer?: ReturnType<typeof setInterval>;
    private shuttingDown = false;

    constructor(
        private readonly redis: RedisService,
        private readonly logger: ScopedLogger
    ) {
        if (!redis.enabled) return;

        this.alivePods.add(this.podId);
        this.startHeartbeat();
        this.startSweep();
        this.subscribePresence();

        const onShutdown = () => this.shutdown();
        process.on('SIGTERM', onShutdown);
        process.on('SIGINT', onShutdown);

        this.logger.info(`Pod presence initialized: ${this.podId}`);
    }

    // ── Public API ─────────────────────────────────────────────────────

    async register(sessionId: string): Promise<void> {
        if (!this.redis.enabled) return;

        this.localSessions.add(sessionId);

        await this.redis.sadd(KEY_SESSION_PODS + sessionId, this.podId);

        let pods = this.sessionPods.get(sessionId);
        if (!pods) {
            pods = new Set();
            this.sessionPods.set(sessionId, pods);
        }
        pods.add(this.podId);

        const event: PresenceEvent = { podId: this.podId, sessionId, action: 'joined' };
        await this.redis.publish(CHANNEL_PRESENCE, event);
    }

    async deregister(sessionId: string): Promise<void> {
        if (!this.redis.enabled) return;

        this.localSessions.delete(sessionId);

        await this.redis.srem(KEY_SESSION_PODS + sessionId, this.podId);

        const pods = this.sessionPods.get(sessionId);
        if (pods) {
            pods.delete(this.podId);
            if (pods.size === 0) {
                this.sessionPods.delete(sessionId);
            }
        }

        const event: PresenceEvent = { podId: this.podId, sessionId, action: 'left' };
        await this.redis.publish(CHANNEL_PRESENCE, event);
    }

    /** True if at least one OTHER alive pod has connections for this session. */
    hasRemoteInterest(sessionId: string): boolean {
        if (!this.redis.enabled) return false;
        const pods = this.sessionPods.get(sessionId);
        if (!pods) return false;
        for (const podId of pods) {
            if (podId !== this.podId && this.alivePods.has(podId)) return true;
        }
        return false;
    }

    /** True if any alive pod (including this one) has connections for this session. */
    hasAnyInterest(sessionId: string): boolean {
        if (!this.redis.enabled) return false;
        const pods = this.sessionPods.get(sessionId);
        if (!pods) return false;
        for (const podId of pods) {
            if (this.alivePods.has(podId)) return true;
        }
        return false;
    }

    // ── Heartbeat ──────────────────────────────────────────────────────

    private startHeartbeat(): void {
        this.sendHeartbeat();
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    }

    private sendHeartbeat(): void {
        this.redis.setex(KEY_POD_ALIVE + this.podId, HEARTBEAT_TTL_S, Date.now().toString()).catch(err => {
            this.logger.error('Failed to send heartbeat', err);
        });
    }

    // ── Sweep (evict dead pods) ────────────────────────────────────────

    private startSweep(): void {
        this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    }

    private async sweep(): Promise<void> {
        const toEvict: string[] = [];
        for (const podId of this.alivePods) {
            if (podId === this.podId) continue;
            const alive = await this.redis.exists(KEY_POD_ALIVE + podId);
            if (!alive) {
                toEvict.push(podId);
            }
        }

        for (const podId of toEvict) {
            this.alivePods.delete(podId);
            this.logger.warn(`Evicting dead pod: ${podId}`);

            for (const [sessionId, pods] of this.sessionPods) {
                if (pods.delete(podId)) {
                    await this.redis.srem(KEY_SESSION_PODS + sessionId, podId);
                }
                if (pods.size === 0) {
                    this.sessionPods.delete(sessionId);
                }
            }
        }
    }

    // ── Presence channel subscription ──────────────────────────────────

    private subscribePresence(): void {
        this.redis.subscribe(CHANNEL_PRESENCE, (_channel, raw) => {
            try {
                const event = JSON.parse(raw) as PresenceEvent;
                if (event.podId === this.podId) return;

                if (event.action === 'joined') {
                    this.alivePods.add(event.podId);
                    let pods = this.sessionPods.get(event.sessionId);
                    if (!pods) {
                        pods = new Set();
                        this.sessionPods.set(event.sessionId, pods);
                    }
                    pods.add(event.podId);
                } else if (event.action === 'left') {
                    const pods = this.sessionPods.get(event.sessionId);
                    if (pods) {
                        pods.delete(event.podId);
                        if (pods.size === 0) {
                            this.sessionPods.delete(event.sessionId);
                        }
                    }
                }
            } catch (err) {
                this.logger.error('Failed to process presence event', err);
            }
        });
    }

    // ── Shutdown ───────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        if (!this.redis.enabled || this.shuttingDown) return;
        this.shuttingDown = true;

        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.sweepTimer) clearInterval(this.sweepTimer);

        const promises = Array.from(this.localSessions).map(sessionId => this.deregister(sessionId));
        await Promise.allSettled(promises);

        await this.redis.del(KEY_POD_ALIVE + this.podId);

        this.logger.info(`Pod ${this.podId} presence shutdown complete`);
    }
}
