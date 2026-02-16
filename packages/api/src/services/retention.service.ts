import { ScopedLogger } from '@deepkit/logger';

import { SessionEntity } from '../database/entities/session.entity';
import { UxrrDatabase } from '../database/database';
import { UxrrConfig } from '../config';
import { LokiService } from './loki.service';
import { S3Service } from './s3.service';
import { SessionService } from './session.service';

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours
const INITIAL_DELAY_MS = 30_000; // 30 seconds
const BATCH_SIZE = 100;

export class RetentionService {
    private timer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger,
        private readonly db: UxrrDatabase,
        private readonly sessionSvc: SessionService,
        private readonly s3: S3Service,
        private readonly loki: LokiService
    ) {
        if (config.DATA_RETENTION_DAYS > 0) {
            setTimeout(() => {
                this.cleanup().catch(err => {
                    this.logger.error('Initial retention cleanup failed', err);
                });
                this.timer = setInterval(() => {
                    this.cleanup().catch(err => {
                        this.logger.error('Scheduled retention cleanup failed', err);
                    });
                }, CLEANUP_INTERVAL_MS);
            }, INITIAL_DELAY_MS);
        }
    }

    async cleanup(): Promise<number> {
        const cutoff = new Date(Date.now() - this.config.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
        this.logger.info(`Retention cleanup: removing sessions with lastActivityAt < ${cutoff.toISOString()}`);

        await this.loki.deleteLogsBefore(cutoff);

        let totalDeleted = 0;
        let batch: SessionEntity[];

        do {
            batch = await this.db
                .query(SessionEntity)
                .filter({ lastActivityAt: { $lt: cutoff } })
                .sort({ lastActivityAt: 'asc' })
                .limit(BATCH_SIZE)
                .find();

            for (const session of batch) {
                try {
                    await this.deleteSessionData(session);
                    totalDeleted++;
                } catch (err) {
                    this.logger.error(`Failed to delete session ${session.id}`, err);
                }
            }
        } while (batch.length === BATCH_SIZE);

        if (totalDeleted > 0) {
            this.logger.info(`Retention cleanup: deleted ${totalDeleted} sessions`);
        }

        return totalDeleted;
    }

    async deleteSessionData(session: SessionEntity): Promise<void> {
        // Delete S3 data (events + chat)
        await this.s3.deleteSessionEvents(session.appId, session.id);
        await this.s3.deleteSessionChat(session.appId, session.id);

        // Delete from database (session_user_ids + sessions)
        await this.sessionSvc.deleteSession(session.id);
    }
}
