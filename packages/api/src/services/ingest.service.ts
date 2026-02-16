import { ScopedLogger } from '@deepkit/logger';
import { eventDispatcher } from '@deepkit/event';
import { onServerShutdownRequested } from '@zyno-io/dk-server-foundation';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { UxrrConfig } from '../config';
import { SessionUserIdEntity } from '../database/entities/session-user-id.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { UxrrDatabase } from '../database/database';
import { LiveSessionService } from './live-session.service';
import { LokiService } from './loki.service';
import { S3Service } from './s3.service';
import { SessionNotifyService } from './session-notify.service';

export interface RrwebEvent {
    type: number; // EventType enum (0=DomContentLoaded, 1=Load, 2=FullSnapshot, 3=IncrementalSnapshot, 4=Meta, 5=Custom, 6=Plugin)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deepkit serializer drops `unknown` fields
    data: any;
    timestamp: number;
    delay?: number;
}

export interface IngestLogEntry {
    t: number; // timestamp
    v: number; // level (0=debug, 1=info, 2=warn, 3=error)
    c: string; // scope
    m: string; // message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deepkit serializer drops `unknown` fields
    d?: any; // data
}

export interface IngestDataPayload {
    identity: { deviceId?: string; userId?: string; userName?: string; userEmail?: string };
    meta: { version?: string; environment?: string; userAgent?: string };
    launchTs: number;
    events?: RrwebEvent[];
    logs?: IngestLogEntry[];
}

export interface StoredLogEntry extends IngestLogEntry {
    appId: string;
    deviceId: string;
    userId?: string;
    sessionId: string;
}

interface IngestEventBuffer {
    appId: string;
    events: RrwebEvent[];
    approxBytes: number;
    flushTimer?: ReturnType<typeof setTimeout>;
    flushPromise?: Promise<void>;
    flushRequested: boolean;
}

const gzipAsync = promisify(gzip);

export class IngestService {
    private readonly eventBuffers = new Map<string, IngestEventBuffer>();
    private readonly ingestEventFlushDelayMs: number;
    private readonly ingestEventFlushMaxEvents: number;
    private readonly ingestEventFlushMaxBytes: number;

    constructor(
        private readonly config: UxrrConfig,
        private readonly db: UxrrDatabase,
        private readonly s3: S3Service,
        private readonly loki: LokiService,
        private readonly live: LiveSessionService,
        private readonly notify: SessionNotifyService,
        private readonly logger: ScopedLogger
    ) {
        this.ingestEventFlushDelayMs = Math.max(1000, config.UXRR_INGEST_EVENT_FLUSH_DELAY_MS ?? 30000);
        this.ingestEventFlushMaxEvents = Math.max(1, config.UXRR_INGEST_EVENT_FLUSH_MAX_EVENTS ?? 200);
        this.ingestEventFlushMaxBytes = Math.max(1024, config.UXRR_INGEST_EVENT_FLUSH_MAX_BYTES ?? 262144);
    }

    async ingestData(appId: string, sessionId: string, payload: IngestDataPayload, ipAddress?: string): Promise<void> {
        const hasEvents = payload.events && payload.events.length > 0;
        const hasLogs = payload.logs && payload.logs.length > 0;

        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();

        if (session) {
            const now = new Date();
            const sets: string[] = ['"lastActivityAt" = ?', '"updatedAt" = ?'];
            const params: unknown[] = [now, now];

            if (payload.identity.userId) {
                sets.push('"userId" = ?');
                params.push(payload.identity.userId);
            }
            if (payload.identity.userName !== undefined) {
                sets.push('"userName" = ?');
                params.push(payload.identity.userName);
            }
            if (payload.identity.userEmail !== undefined) {
                sets.push('"userEmail" = ?');
                params.push(payload.identity.userEmail);
            }

            params.push(sessionId);
            const whereClause = 'WHERE "id" = ?';

            await this.db.rawFindUnsafe(`UPDATE "sessions" SET ${sets.join(', ')} ${whereClause}`, params);
        } else {
            const now = new Date();
            const newSession = new SessionEntity();
            newSession.id = sessionId;
            newSession.appId = appId;
            newSession.deviceId = payload.identity.deviceId ?? 'unknown';
            newSession.userId = payload.identity.userId;
            newSession.userName = payload.identity.userName;
            newSession.userEmail = payload.identity.userEmail;
            newSession.version = payload.meta.version;
            newSession.environment = payload.meta.environment;
            newSession.userAgent = payload.meta.userAgent;
            newSession.ipAddress = ipAddress;
            newSession.startedAt = now;
            newSession.lastActivityAt = now;
            newSession.eventChunkCount = 0;
            newSession.eventBytesStored = 0;
            newSession.createdAt = now;
            newSession.updatedAt = now;
            await this.db.persist(newSession);
        }

        // maintain join table for multi-identity tracking
        if (payload.identity.userId) {
            const exists = await this.db
                .query(SessionUserIdEntity)
                .filter({ sessionId, userId: payload.identity.userId })
                .has();
            if (!exists) {
                const entry = new SessionUserIdEntity();
                entry.sessionId = sessionId;
                entry.userId = payload.identity.userId;
                await this.db.persist(entry);
            }
        }

        // load all associated userIds for notifications
        const allUserIds = await this.db
            .query(SessionUserIdEntity)
            .filter({ sessionId })
            .find()
            .then(rows => rows.map(r => r.userId));

        const effectiveSession = await this.db.query(SessionEntity).filter({ id: sessionId }).findOne();
        if (session) {
            this.notify.notifySessionUpdated(effectiveSession, allUserIds);
        } else {
            this.notify.notifySessionCreated(effectiveSession, allUserIds);
        }

        if (hasEvents) {
            await this.enqueueEvents(appId, sessionId, payload.events!);
            this.live.relayToAgent(sessionId, { type: 'events', data: payload.events! });
        }

        if (hasLogs) {
            const deviceId = payload.identity.deviceId ?? session?.deviceId ?? 'unknown';
            const decorated: StoredLogEntry[] = payload.logs!.map(entry => ({
                ...entry,
                appId,
                deviceId,
                userId: payload.identity.userId,
                sessionId
            }));
            await this.loki.pushLogs(decorated).catch(e => {
                console.warn(`Failed to push logs to Loki for session ${sessionId}:`, e.message);
            });
            this.live.relayToAgent(sessionId, { type: 'logs', data: decorated });
        }
    }

    async forwardOtlp(
        path: string,
        body: Buffer,
        contentType: string,
        appId?: string
    ): Promise<{ status: number; contentType: string; body: string }> {
        if (path !== 'traces') return { status: 400, contentType: 'text/plain', body: 'unsupported OTLP path' };

        const ALLOWED_OTLP_CONTENT_TYPES = ['application/x-protobuf', 'application/json'];
        if (!ALLOWED_OTLP_CONTENT_TYPES.includes(contentType)) {
            return { status: 400, contentType: 'text/plain', body: 'unsupported content type' };
        }

        if (!body.includes('"uxrr.sid"')) {
            return { status: 400, contentType: 'text/plain', body: 'missing uxrr session' };
        }

        if (appId && !body.includes(`{"key":"service.name","value":{"stringValue":"${appId}"}}`)) {
            return { status: 403, contentType: 'text/plain', body: 'service.name does not match appId' };
        }

        const url = this.config.OTLP_TRACES_URL;
        if (!url) {
            this.logger.warn('OTLP_TRACES_URL not configured, dropping payload');
            return { status: 502, contentType: 'text/plain', body: 'OTLP_TRACES_URL not configured' };
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body
            });
            const responseBody = await response.text();
            if (!response.ok) {
                this.logger.error(`Tempo returned ${response.status}: ${responseBody}`);
            }
            return {
                status: response.status,
                contentType: response.headers.get('content-type') ?? 'application/json',
                body: responseBody
            };
        } catch (err) {
            this.logger.error('Failed to forward OTLP traces', err);
            return { status: 502, contentType: 'text/plain', body: 'failed to forward to Tempo' };
        }
    }

    @eventDispatcher.listen(onServerShutdownRequested)
    async onServerShutdownRequested(): Promise<void> {
        this.logger.info('Shutdown requested; flushing pending ingest event buffers');
        const flushes = [...this.eventBuffers.keys()].map(sessionId =>
            this.flushEventsBuffer(sessionId, 'shutdown').catch(err => {
                this.logger.error(`Failed to flush ingest events for session ${sessionId} during shutdown`, err);
            })
        );
        await Promise.allSettled(flushes);
    }

    private async enqueueEvents(appId: string, sessionId: string, events: RrwebEvent[]): Promise<void> {
        let buffer = this.eventBuffers.get(sessionId);
        if (!buffer) {
            buffer = { appId, events: [], approxBytes: 0, flushRequested: false };
            this.eventBuffers.set(sessionId, buffer);
        }

        buffer.appId = appId;
        buffer.events.push(...events);
        buffer.approxBytes += Buffer.byteLength(JSON.stringify(events), 'utf-8');

        if (
            buffer.events.length >= this.ingestEventFlushMaxEvents ||
            buffer.approxBytes >= this.ingestEventFlushMaxBytes
        ) {
            await this.flushEventsBuffer(sessionId, 'threshold');
            return;
        }

        this.ensureEventFlushTimer(sessionId, buffer);
    }

    private ensureEventFlushTimer(sessionId: string, buffer: IngestEventBuffer): void {
        if (buffer.flushTimer) return;
        buffer.flushTimer = setTimeout(() => {
            this.flushEventsBuffer(sessionId, 'timer').catch(err => {
                this.logger.error(`Failed to flush ingest event buffer for session ${sessionId} on timer`, err);
            });
        }, this.ingestEventFlushDelayMs);
    }

    private async flushEventsBuffer(sessionId: string, reason: string): Promise<void> {
        const buffer = this.eventBuffers.get(sessionId);
        if (!buffer) return;

        if (buffer.flushPromise) {
            buffer.flushRequested = true;
            await buffer.flushPromise;
            return;
        }

        if (buffer.flushTimer) {
            clearTimeout(buffer.flushTimer);
            buffer.flushTimer = undefined;
        }

        if (buffer.events.length === 0) {
            this.eventBuffers.delete(sessionId);
            return;
        }

        const appId = buffer.appId;
        const batch = buffer.events.splice(0);
        const batchApproxBytes = buffer.approxBytes;
        buffer.approxBytes = 0;

        const flushPromise = (async () => {
            const compressedBatch = await gzipAsync(JSON.stringify(batch));
            const batchBytesStored = compressedBatch.byteLength;
            const chunkIndex = await this.reserveChunkIndex(sessionId, batchBytesStored);
            if (chunkIndex === undefined) return;

            await this.s3.putEventsCompressed(appId, sessionId, chunkIndex, compressedBatch);
            await this.notifySessionUpdated(sessionId);
        })();

        buffer.flushPromise = flushPromise;

        try {
            await flushPromise;
        } catch (err) {
            const latest = this.eventBuffers.get(sessionId);
            if (latest) {
                latest.events.unshift(...batch);
                latest.approxBytes += batchApproxBytes;
                this.ensureEventFlushTimer(sessionId, latest);
            }
            throw err;
        } finally {
            const latest = this.eventBuffers.get(sessionId);
            if (!latest) return;

            latest.flushPromise = undefined;
            if (latest.flushRequested) {
                latest.flushRequested = false;
                if (latest.events.length > 0) {
                    this.flushEventsBuffer(sessionId, 'queued').catch(err => {
                        this.logger.error(`Failed follow-up ingest event flush for session ${sessionId}`, err);
                    });
                }
                return;
            }

            if (latest.events.length === 0) {
                this.eventBuffers.delete(sessionId);
            } else {
                this.ensureEventFlushTimer(sessionId, latest);
            }
        }

        if (reason === 'shutdown') {
            this.logger.debug(`Flushed ingest events for session ${sessionId} during ${reason}`);
        }
    }

    private async reserveChunkIndex(sessionId: string, eventBytesStored: number): Promise<number | undefined> {
        const now = new Date();
        const result = await this.db.rawFindUnsafe<{ chunkIndex: number }>(
            `UPDATE "sessions" SET "eventChunkCount" = "eventChunkCount" + 1, "eventBytesStored" = "eventBytesStored" + ?, "lastActivityAt" = ?, "updatedAt" = ? WHERE "id" = ? RETURNING "eventChunkCount" - 1 AS "chunkIndex"`,
            [eventBytesStored, now, now, sessionId]
        );
        if (result.length === 0) {
            this.logger.warn(`No session found while flushing ingest events for session ${sessionId}; dropping buffered batch`);
            return undefined;
        }
        return result[0].chunkIndex;
    }

    private async notifySessionUpdated(sessionId: string): Promise<void> {
        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();
        if (!session) return;
        const allUserIds = await this.db
            .query(SessionUserIdEntity)
            .filter({ sessionId })
            .find()
            .then(rows => rows.map(r => r.userId));
        this.notify.notifySessionUpdated(session, allUserIds);
    }
}
