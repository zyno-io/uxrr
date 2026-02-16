import { describe, it, mock, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { RetentionService } from '../src/services/retention.service';
import type { SessionEntity } from '../src/database/entities/session.entity';
import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';
import type { SessionService } from '../src/services/session.service';
import type { S3Service } from '../src/services/s3.service';
import type { LokiService } from '../src/services/loki.service';
import type { Logger } from '@deepkit/logger';

function makeSession(overrides: Partial<SessionEntity> = {}): SessionEntity {
    return {
        id: 'sess-1',
        appId: 'app-1',
        deviceId: 'dev-1',
        startedAt: new Date('2024-01-01'),
        lastActivityAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        eventChunkCount: 0,
        hasChatMessages: false,
        ...overrides
    } as SessionEntity;
}

function makeLogger(): Logger {
    return {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn()
    } as unknown as Logger;
}

function makeConfig(days: number): UxrrConfig {
    return { DATA_RETENTION_DAYS: days } as UxrrConfig;
}

describe('RetentionService', () => {
    describe('deleteSessionData', () => {
        let s3: { deleteSessionEvents: ReturnType<typeof mock.fn>; deleteSessionChat: ReturnType<typeof mock.fn> };
        let loki: { deleteLogsBefore: ReturnType<typeof mock.fn> };
        let sessionSvc: { deleteSession: ReturnType<typeof mock.fn> };
        let logger: Logger;

        beforeEach(() => {
            s3 = {
                deleteSessionEvents: mock.fn(async () => {}),
                deleteSessionChat: mock.fn(async () => {})
            };
            loki = {
                deleteLogsBefore: mock.fn(async () => {})
            };
            sessionSvc = {
                deleteSession: mock.fn(async () => {})
            };
            logger = makeLogger();
        });

        it('cascades deletes to S3 and DB', async () => {
            const svc = new RetentionService(
                makeConfig(0), // 0 = disabled, but we call deleteSessionData directly
                logger,
                {} as UxrrDatabase,
                sessionSvc as unknown as SessionService,
                s3 as unknown as S3Service,
                loki as unknown as LokiService
            );

            const session = makeSession({ id: 'sess-42', appId: 'my-app', deviceId: 'dev-7' });
            await svc.deleteSessionData(session);

            assert.equal(s3.deleteSessionEvents.mock.callCount(), 1);
            assert.deepEqual(s3.deleteSessionEvents.mock.calls[0].arguments, ['my-app', 'sess-42']);

            assert.equal(s3.deleteSessionChat.mock.callCount(), 1);
            assert.deepEqual(s3.deleteSessionChat.mock.calls[0].arguments, ['my-app', 'sess-42']);

            assert.equal(sessionSvc.deleteSession.mock.callCount(), 1);
            assert.deepEqual(sessionSvc.deleteSession.mock.calls[0].arguments, ['sess-42']);
        });
    });

    describe('cleanup', () => {
        it('deletes sessions older than retention cutoff', async () => {
            const oldSession = makeSession({
                id: 'old-sess',
                lastActivityAt: new Date('2023-01-01')
            });

            const deletedSessions: string[] = [];
            const s3 = {
                deleteSessionEvents: mock.fn(async () => {}),
                deleteSessionChat: mock.fn(async () => {})
            };
            const loki = { deleteLogsBefore: mock.fn(async () => {}) };
            const sessionSvc = {
                deleteSession: mock.fn(async (id: string) => {
                    deletedSessions.push(id);
                })
            };
            const logger = makeLogger();

            // Mock the db.query chain for RetentionService.cleanup()
            let findCallCount = 0;
            const mockQueryChain = {
                filter: mock.fn(() => mockQueryChain),
                sort: mock.fn(() => mockQueryChain),
                limit: mock.fn(() => mockQueryChain),
                find: mock.fn(async () => {
                    findCallCount++;
                    return findCallCount === 1 ? [oldSession] : [];
                })
            };

            const db = {
                query: mock.fn(() => mockQueryChain)
            } as unknown as UxrrDatabase;

            const svc = new RetentionService(
                makeConfig(30), // 30 days retention
                logger,
                db,
                sessionSvc as unknown as SessionService,
                s3 as unknown as S3Service,
                loki as unknown as LokiService
            );

            const count = await svc.cleanup();

            assert.equal(count, 1);
            assert.deepEqual(deletedSessions, ['old-sess']);
        });

        it('returns 0 when no sessions to clean up', async () => {
            const s3 = {
                deleteSessionEvents: mock.fn(async () => {}),
                deleteSessionChat: mock.fn(async () => {})
            };
            const loki = { deleteLogsBefore: mock.fn(async () => {}) };
            const sessionSvc = { deleteSession: mock.fn(async () => {}) };
            const logger = makeLogger();

            const mockQueryChain = {
                filter: mock.fn(() => mockQueryChain),
                sort: mock.fn(() => mockQueryChain),
                limit: mock.fn(() => mockQueryChain),
                find: mock.fn(async () => [])
            };

            const db = {
                query: mock.fn(() => mockQueryChain)
            } as unknown as UxrrDatabase;

            const svc = new RetentionService(
                makeConfig(30),
                logger,
                db,
                sessionSvc as unknown as SessionService,
                s3 as unknown as S3Service,
                loki as unknown as LokiService
            );

            const count = await svc.cleanup();
            assert.equal(count, 0);
        });

        it('continues batch on per-session errors', async () => {
            const sess1 = makeSession({ id: 'sess-1', appId: 'app-1', deviceId: 'dev-1' });
            const sess2 = makeSession({ id: 'sess-2', appId: 'app-2', deviceId: 'dev-2' });

            let s3CallCount = 0;
            const s3 = {
                deleteSessionEvents: mock.fn(async () => {
                    s3CallCount++;
                    if (s3CallCount === 1) throw new Error('S3 failure');
                }),
                deleteSessionChat: mock.fn(async () => {})
            };
            const loki = { deleteLogsBefore: mock.fn(async () => {}) };
            const sessionSvc = { deleteSession: mock.fn(async () => {}) };
            const logger = makeLogger();

            let findCallCount2 = 0;
            const mockQueryChain = {
                filter: mock.fn(() => mockQueryChain),
                sort: mock.fn(() => mockQueryChain),
                limit: mock.fn(() => mockQueryChain),
                find: mock.fn(async () => {
                    findCallCount2++;
                    return findCallCount2 === 1 ? [sess1, sess2] : [];
                })
            };

            const db = {
                query: mock.fn(() => mockQueryChain)
            } as unknown as UxrrDatabase;

            const svc = new RetentionService(
                makeConfig(30),
                logger,
                db,
                sessionSvc as unknown as SessionService,
                s3 as unknown as S3Service,
                loki as unknown as LokiService
            );

            const count = await svc.cleanup();

            // sess-1 failed, sess-2 succeeded
            assert.equal(count, 1);
            // Error was logged for sess-1
            assert.equal((logger.error as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 1);
        });
    });
});
