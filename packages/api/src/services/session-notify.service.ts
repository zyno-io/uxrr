import { ScopedLogger } from '@deepkit/logger';
import type WebSocket from 'ws';

import { SessionEntity } from '../database/entities/session.entity';
import { AppResolverService } from './app-resolver.service';
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
    appKey?: string;
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
}

interface WatcherConnection {
    ws: WebSocket;
    filters: WatcherFilters;
    allowedAppKeys?: string[];
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
        { lastActivityAt: number; appKey: string; session: SessionEntity; allUserIds: string[] }
    >();
    private staleCheckTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly logger: ScopedLogger,
        private readonly redis: RedisService,
        private readonly presence: PodPresenceService,
        private readonly appResolver: AppResolverService
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

    addWatcher(ws: WebSocket, initialFilters: WatcherFilters, allowedAppKeys?: string[]): void {
        const watcher: WatcherConnection = { ws, filters: initialFilters, allowedAppKeys };
        this.watchers.add(watcher);
        this.logger.debug(`Session watcher connected (total: ${this.watchers.size})`);

        ws.on('message', (raw: Buffer) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'set_filters') {
                    const newFilters = msg.filters ?? {};

                    // Enforce app scoping from embed token
                    if (watcher.allowedAppKeys && watcher.allowedAppKeys.length > 0) {
                        if (newFilters.appKey && !watcher.allowedAppKeys.includes(newFilters.appKey)) {
                            return;
                        }
                        if (!newFilters.appKey && watcher.allowedAppKeys.length === 1) {
                            newFilters.appKey = watcher.allowedAppKeys[0];
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
        const appKey = this.appResolver.resolveAppKey(session.appId) ?? session.appId;
        const payload = this.toPayload(session, true, allUserIds, appKey);
        this.liveSessionTimestamps.set(session.id, {
            lastActivityAt: session.lastActivityAt.getTime(),
            appKey,
            session,
            allUserIds
        });

        this.sendToLocalWatchers('session_created', payload, appKey, allUserIds);

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
        const appKey = this.appResolver.resolveAppKey(session.appId) ?? session.appId;
        const payload = this.toPayload(session, true, allUserIds, appKey);
        this.liveSessionTimestamps.set(session.id, {
            lastActivityAt: session.lastActivityAt.getTime(),
            appKey,
            session,
            allUserIds
        });

        this.sendToLocalWatchers('session_updated', payload, appKey, allUserIds);

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
                    if (watcher.allowedAppKeys && !watcher.allowedAppKeys.includes(entry.appKey)) continue;
                    watcher.ws.send(msg);
                }
            }
        }
    }

    private sendToLocalWatchers(type: string, payload: ISessionPayload, appKey: string, allUserIds: string[]): void {
        for (const watcher of this.watchers) {
            if (watcher.ws.readyState !== 1) continue;
            if (watcher.allowedAppKeys && !watcher.allowedAppKeys.includes(appKey)) continue;
            if (!this.matchesPayloadFilters(payload, allUserIds, watcher.filters)) continue;
            watcher.ws.send(JSON.stringify({ type, session: payload }));
        }
    }

    private handleRedisNotification(_channel: string, raw: string): void {
        try {
            const msg = JSON.parse(raw) as RedisNotifyMessage;
            if (msg.sourcePod === this.presence.podId) return;

            this.liveSessionTimestamps.set(msg.session.id, {
                lastActivityAt: new Date(msg.session.lastActivityAt).getTime(),
                appKey: msg.session.appId,
                session: undefined as unknown as SessionEntity,
                allUserIds: msg.allUserIds
            });

            for (const watcher of this.watchers) {
                if (watcher.ws.readyState !== 1) continue;
                if (watcher.allowedAppKeys && !watcher.allowedAppKeys.includes(msg.session.appId)) continue;
                if (!this.matchesPayloadFilters(msg.session, msg.allUserIds, watcher.filters)) continue;
                watcher.ws.send(JSON.stringify({ type: msg.type, session: msg.session }));
            }
        } catch (err) {
            this.logger.error('Failed to process Redis session notification', err);
        }
    }

    private matchesPayloadFilters(payload: ISessionPayload, allUserIds: string[], filters: WatcherFilters): boolean {
        if (filters.appKey && payload.appId !== filters.appKey) return false;
        if (filters.userId && !allUserIds.includes(filters.userId)) return false;
        if (filters.deviceId && payload.deviceId !== filters.deviceId) return false;
        if (filters.from && payload.lastActivityAt < filters.from) return false;
        if (filters.to && payload.startedAt > filters.to) return false;
        return true;
    }

    private toPayload(session: SessionEntity, isLive: boolean, allUserIds: string[], appKey: string): ISessionPayload {
        return {
            id: session.id,
            appId: appKey,
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
