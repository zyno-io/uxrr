import { ScopedLogger } from '@deepkit/logger';
import type WebSocket from 'ws';

import { SessionEntity } from '../database/entities/session.entity';
import { PodPresenceService } from './pod-presence.service';
import { RedisService } from './redis.service';

const LIVE_THRESHOLD_MS = 30_000;
const STALE_CHECK_INTERVAL_MS = 10_000;
const CHANNEL_SESSION_NOTIFY = 'uxrr:session:notify';

interface RedisNotifyMessage {
    sourcePod: string;
    type: 'session_created' | 'session_updated';
    session: ISessionPayload;
    allUserIds: string[];
}

interface WatcherFilters {
    appId?: string;
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
}

interface WatcherConnection {
    ws: WebSocket;
    filters: WatcherFilters;
    allowedAppIds?: string[];
}

interface ISessionPayload {
    id: string;
    appId: string;
    deviceId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    allUserIds: string[];
    version?: string;
    environment?: string;
    userAgent?: string;
    ipAddress?: string;
    startedAt: string;
    lastActivityAt: string;
    eventChunkCount: number;
    eventBytesStored: number;
    createdAt: string;
    updatedAt: string;
    isLive: boolean;
}

export class SessionNotifyService {
    private readonly watchers = new Set<WatcherConnection>();
    private readonly liveSessionTimestamps = new Map<
        string,
        { lastActivityAt: number; appId: string; session: SessionEntity; allUserIds: string[] }
    >();
    private staleCheckTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly logger: ScopedLogger,
        private readonly redis: RedisService,
        private readonly presence: PodPresenceService
    ) {
        if (redis.enabled) {
            redis.subscribe(CHANNEL_SESSION_NOTIFY, this.handleRedisNotification.bind(this));
        }
    }

    startStaleChecker(): void {
        if (this.staleCheckTimer) return;
        this.staleCheckTimer = setInterval(() => this.checkStale(), STALE_CHECK_INTERVAL_MS);
    }

    stopStaleChecker(): void {
        if (this.staleCheckTimer) {
            clearInterval(this.staleCheckTimer);
            this.staleCheckTimer = undefined;
        }
    }

    addWatcher(ws: WebSocket, initialFilters: WatcherFilters, allowedAppIds?: string[]): void {
        const watcher: WatcherConnection = { ws, filters: initialFilters, allowedAppIds };
        this.watchers.add(watcher);
        this.logger.debug(`Session watcher connected (total: ${this.watchers.size})`);

        ws.on('message', (raw: Buffer) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'set_filters') {
                    const newFilters = msg.filters ?? {};

                    // Enforce app scoping from embed token
                    if (watcher.allowedAppIds && watcher.allowedAppIds.length > 0) {
                        if (newFilters.appId && !watcher.allowedAppIds.includes(newFilters.appId)) {
                            return;
                        }
                        if (!newFilters.appId && watcher.allowedAppIds.length === 1) {
                            newFilters.appId = watcher.allowedAppIds[0];
                        }
                    }

                    watcher.filters = newFilters;
                    this.logger.debug('Watcher filters updated');
                }
            } catch {
                // ignore parse errors
            }
        });

        ws.on('close', () => {
            this.watchers.delete(watcher);
            this.logger.debug(`Session watcher disconnected (total: ${this.watchers.size})`);
        });
    }

    notifySessionCreated(session: SessionEntity, allUserIds: string[]): void {
        const payload = this.toPayload(session, true, allUserIds);
        this.liveSessionTimestamps.set(session.id, {
            lastActivityAt: session.lastActivityAt.getTime(),
            appId: session.appId,
            session,
            allUserIds
        });

        this.sendToLocalWatchers('session_created', payload, session, allUserIds);

        if (this.redis.enabled) {
            const msg: RedisNotifyMessage = {
                sourcePod: this.presence.podId,
                type: 'session_created',
                session: payload,
                allUserIds
            };
            this.redis.publish(CHANNEL_SESSION_NOTIFY, msg);
        }
    }

    notifySessionUpdated(session: SessionEntity, allUserIds: string[]): void {
        const payload = this.toPayload(session, true, allUserIds);
        this.liveSessionTimestamps.set(session.id, {
            lastActivityAt: session.lastActivityAt.getTime(),
            appId: session.appId,
            session,
            allUserIds
        });

        this.sendToLocalWatchers('session_updated', payload, session, allUserIds);

        if (this.redis.enabled) {
            const msg: RedisNotifyMessage = {
                sourcePod: this.presence.podId,
                type: 'session_updated',
                session: payload,
                allUserIds
            };
            this.redis.publish(CHANNEL_SESSION_NOTIFY, msg);
        }
    }

    private checkStale(): void {
        const now = Date.now();
        for (const [sessionId, entry] of this.liveSessionTimestamps) {
            if (now - entry.lastActivityAt >= LIVE_THRESHOLD_MS) {
                this.liveSessionTimestamps.delete(sessionId);
                const msg = JSON.stringify({
                    type: 'session_live_status',
                    sessionId,
                    isLive: false,
                    lastActivityAt: new Date(entry.lastActivityAt).toISOString()
                });
                for (const watcher of this.watchers) {
                    if (watcher.ws.readyState !== 1) continue;
                    if (watcher.allowedAppIds && !watcher.allowedAppIds.includes(entry.appId)) continue;
                    watcher.ws.send(msg);
                }
            }
        }
    }

    private sendToLocalWatchers(
        type: string,
        payload: ISessionPayload,
        session: SessionEntity,
        allUserIds: string[]
    ): void {
        for (const watcher of this.watchers) {
            if (watcher.ws.readyState !== 1) continue;
            if (watcher.allowedAppIds && !watcher.allowedAppIds.includes(session.appId)) continue;
            if (!this.matchesFilters(session, allUserIds, watcher.filters)) continue;
            watcher.ws.send(JSON.stringify({ type, session: payload }));
        }
    }

    private handleRedisNotification(_channel: string, raw: string): void {
        try {
            const msg = JSON.parse(raw) as RedisNotifyMessage;
            if (msg.sourcePod === this.presence.podId) return;

            this.liveSessionTimestamps.set(msg.session.id, {
                lastActivityAt: new Date(msg.session.lastActivityAt).getTime(),
                appId: msg.session.appId,
                session: undefined as unknown as SessionEntity,
                allUserIds: msg.allUserIds
            });

            for (const watcher of this.watchers) {
                if (watcher.ws.readyState !== 1) continue;
                if (watcher.allowedAppIds && !watcher.allowedAppIds.includes(msg.session.appId)) continue;
                if (!this.matchesPayloadFilters(msg.session, msg.allUserIds, watcher.filters)) continue;
                watcher.ws.send(JSON.stringify({ type: msg.type, session: msg.session }));
            }
        } catch (err) {
            this.logger.error('Failed to process Redis session notification', err);
        }
    }

    private matchesFilters(session: SessionEntity, allUserIds: string[], filters: WatcherFilters): boolean {
        if (filters.appId && session.appId !== filters.appId) return false;
        if (filters.userId && !allUserIds.includes(filters.userId)) return false;
        if (filters.deviceId && session.deviceId !== filters.deviceId) return false;
        if (filters.from && session.lastActivityAt < new Date(filters.from)) return false;
        if (filters.to && session.startedAt > new Date(filters.to)) return false;
        return true;
    }

    private matchesPayloadFilters(payload: ISessionPayload, allUserIds: string[], filters: WatcherFilters): boolean {
        if (filters.appId && payload.appId !== filters.appId) return false;
        if (filters.userId && !allUserIds.includes(filters.userId)) return false;
        if (filters.deviceId && payload.deviceId !== filters.deviceId) return false;
        if (filters.from && payload.lastActivityAt < filters.from) return false;
        if (filters.to && payload.startedAt > filters.to) return false;
        return true;
    }

    private toPayload(session: SessionEntity, isLive: boolean, allUserIds: string[]): ISessionPayload {
        return {
            id: session.id,
            appId: session.appId,
            deviceId: session.deviceId,
            userId: session.userId,
            userName: session.userName,
            userEmail: session.userEmail,
            allUserIds,
            version: session.version,
            environment: session.environment,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
            startedAt: session.startedAt.toISOString(),
            lastActivityAt: session.lastActivityAt.toISOString(),
            eventChunkCount: session.eventChunkCount,
            eventBytesStored: session.eventBytesStored,
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            isLive
        };
    }
}
