import { ScopedLogger } from '@deepkit/logger';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { SessionUserIdEntity } from '../../database/entities/session-user-id.entity';
import { SessionEntity } from '../../database/entities/session.entity';
import { UxrrDatabase } from '../../database/database';
import { LokiService } from '../loki.service';
import { S3Service } from '../s3.service';
import { SessionNotifyService } from '../session-notify.service';
import type { IngestLogEntry, StoredLogEntry } from '../ingest.service';
import type { IBufferPersistence } from './interfaces';
import type { IChatMessage } from './types';

const gzipAsync = promisify(gzip);

export class LiveBufferPersistence implements IBufferPersistence {
    constructor(
        private readonly logger: ScopedLogger,
        private readonly s3: S3Service,
        private readonly db: UxrrDatabase,
        private readonly loki: LokiService,
        private readonly notify: SessionNotifyService
    ) {}

    // ── IBufferPersistence implementation ────────────────────────────────

    async persistEvents(sessionId: string, events: unknown[]): Promise<void> {
        const compressedEvents = await gzipAsync(JSON.stringify(events));
        const eventBytesStored = compressedEvents.byteLength;
        const now = new Date();
        const result = await this.db.rawFindUnsafe<{ chunkIndex: number }>(
            `UPDATE "sessions" SET "eventChunkCount" = "eventChunkCount" + 1, "eventBytesStored" = "eventBytesStored" + ?, "lastActivityAt" = ?, "updatedAt" = ? WHERE "id" = ? RETURNING "eventChunkCount" - 1 AS "chunkIndex"`,
            [eventBytesStored, now, now, sessionId]
        );
        if (result.length === 0) return;

        const chunkIndex = result[0].chunkIndex;
        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOne();
        const allUserIds = (await this.db.query(SessionUserIdEntity).filter({ sessionId }).find()).map(r => r.userId);
        this.notify.notifySessionUpdated(session, allUserIds);

        await this.s3.putEventsCompressed(session.appId, sessionId, chunkIndex, compressedEvents);
    }

    async persistLogs(sessionId: string, logs: IngestLogEntry[]): Promise<void> {
        if (logs.length === 0) return;

        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();
        if (!session) return;

        const decorated: StoredLogEntry[] = logs.map(entry => ({
            ...entry,
            appId: session.appId,
            deviceId: session.deviceId,
            userId: session.userId,
            sessionId
        }));

        await this.loki.pushLogs(decorated);
    }

    async persistChat(sessionId: string, messages: IChatMessage[], markHasChat: boolean): Promise<void> {
        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();
        if (!session) return;

        if (markHasChat) {
            session.hasChatMessages = true;
            session.updatedAt = new Date();
            await this.db.persist(session);
            const allUserIds = (await this.db.query(SessionUserIdEntity).filter({ sessionId }).find()).map(
                r => r.userId
            );
            this.notify.notifySessionUpdated(session, allUserIds);
        }

        await this.s3.putChat(session.appId, sessionId, messages);
    }
}
