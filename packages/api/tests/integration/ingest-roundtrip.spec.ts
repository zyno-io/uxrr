import { createHash } from 'crypto';

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TestingHelpers } from '@zyno-io/dk-server-foundation/testing/index.js';

import { UxrrConfig } from '../../src/config.js';
import { UxrrDatabase } from '../../src/database/database.js';
import { AppEntity } from '../../src/database/entities/app.entity.js';
import { SessionEntity } from '../../src/database/entities/session.entity.js';
import { IngestController } from '../../src/controllers/ingest.controller.js';
import { SessionController } from '../../src/controllers/session.controller.js';
import { AppGuard } from '../../src/middleware/origin.guard.js';
import { SessionAuthMiddleware } from '../../src/middleware/session-auth.middleware.js';
import { SecurityHeadersListener } from '../../src/middleware/security-headers.listener.js';
import { AppResolverService } from '../../src/services/app-resolver.service.js';
import { IngestService } from '../../src/services/ingest.service.js';
import { LiveSessionService } from '../../src/services/live-session.service.js';
import { LokiService } from '../../src/services/loki.service.js';
import { OidcService } from '../../src/services/oidc.service.js';
import { OidcAuthMiddleware } from '../../src/middleware/oidc-auth.middleware.js';
import { PodPresenceService } from '../../src/services/pod-presence.service.js';
import { RedisService } from '../../src/services/redis.service.js';
import { RetentionService } from '../../src/services/retention.service.js';
import { S3Service } from '../../src/services/s3.service.js';
import { ApiKeyService } from '../../src/services/api-key.service.js';
import { SessionNotifyService } from '../../src/services/session-notify.service.js';
import { SessionService } from '../../src/services/session.service.js';
import { ShareService } from '../../src/services/share.service.js';
import { UserService } from '../../src/services/user.service.js';
import { WebSocketService } from '../../src/services/websocket.service.js';

const TEST_APP_ID = 'test-app-int';
const TEST_ORIGIN = 'http://test-integration.example.com';
const TEST_API_KEY_RAW = 'test-ingest-key-12345';
const TEST_SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const tf = TestingHelpers.createTestingFacade(
    {
        config: UxrrConfig,
        db: UxrrDatabase,
        controllers: [IngestController, SessionController],
        providers: [
            RedisService,
            PodPresenceService,
            ApiKeyService,
            AppResolverService,
            IngestService,
            LiveSessionService,
            LokiService,
            OidcAuthMiddleware,
            OidcService,
            RetentionService,
            S3Service,
            SessionAuthMiddleware,
            SessionNotifyService,
            SessionService,
            ShareService,
            UserService,
            WebSocketService
        ],
        listeners: [AppGuard, SecurityHeadersListener]
    },
    {
        enableDatabase: true,
        dbAdapter: 'postgres',
        seedData: async () => {
            const db = tf.app.get(UxrrDatabase);
            const hashedKey = createHash('sha256').update(TEST_API_KEY_RAW).digest('hex');
            await db.persist(
                Object.assign(new AppEntity(), {
                    id: TEST_APP_ID,
                    name: 'Integration Test App',
                    origins: [TEST_ORIGIN],
                    apiKey: hashedKey,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                })
            );
        },
        autoSeedData: true
    }
);

const { makeMockRequest, installStandardHooks } = TestingHelpers;

installStandardHooks(tf as unknown as Parameters<typeof installStandardHooks>[0]);

describe('Ingest roundtrip (integration)', () => {
    it('creates a session on first ingest', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'POST',
            `/v1/ng/${TEST_APP_ID}/${TEST_SESSION_ID}/data`,
            {
                origin: TEST_ORIGIN
            },
            {
                identity: { deviceId: 'dev-int-1', userId: 'user-int', userName: 'Int User' },
                meta: { version: '1.0.0', environment: 'test' },
                launchTs: Date.now(),
                events: [
                    { type: 4, data: { width: 1920, height: 1080 }, timestamp: Date.now() },
                    { type: 2, data: { node: {} }, timestamp: Date.now() }
                ],
                logs: [{ t: Date.now(), v: 1, c: 'test', m: 'Hello from integration test' }]
            }
        );

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body.toString());
        assert.equal(body.ok, true);

        // Flush the ingest buffer to persist events to S3/database
        const ingestService = tf.app.get(IngestService);
        await (ingestService as any).flushEventsBuffer(TEST_SESSION_ID, 'test');

        // Verify session was created in DB
        const db = tf.app.get(UxrrDatabase);
        const session = await db.query(SessionEntity).filter({ id: TEST_SESSION_ID }).findOneOrUndefined();
        assert.ok(session, 'Session should exist in DB');
        assert.equal(session!.appId, TEST_APP_ID);
        assert.equal(session!.deviceId, 'dev-int-1');
        assert.equal(session!.userId, 'user-int');
        assert.equal(session!.userName, 'Int User');
        assert.ok(session!.eventBytesStored > 0, 'eventBytesStored should be > 0');
    });

    it('updates session on subsequent ingest', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'POST',
            `/v1/ng/${TEST_APP_ID}/${TEST_SESSION_ID}/data`,
            {
                origin: TEST_ORIGIN
            },
            {
                identity: { deviceId: 'dev-int-1', userId: 'user-int' },
                meta: {},
                launchTs: Date.now(),
                events: [{ type: 3, data: { source: 1 }, timestamp: Date.now() }]
            }
        );

        assert.equal(res.statusCode, 200);

        // Flush the ingest buffer to persist events to S3/database
        const ingestService = tf.app.get(IngestService);
        await (ingestService as any).flushEventsBuffer(TEST_SESSION_ID, 'test');

        const db = tf.app.get(UxrrDatabase);
        const session = await db.query(SessionEntity).filter({ id: TEST_SESSION_ID }).findOneOrUndefined();
        assert.ok(session);
        // eventChunkCount should have incremented
        assert.ok(session!.eventChunkCount > 0, 'eventChunkCount should be > 0');
        assert.ok(session!.eventBytesStored > 0, 'eventBytesStored should be > 0');
    });

    it('rejects ingest with unknown origin', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'POST',
            `/v1/ng/${TEST_APP_ID}/${TEST_SESSION_ID}/data`,
            {
                origin: 'http://evil.example.com'
            },
            {
                identity: { deviceId: 'dev-1' },
                meta: {},
                launchTs: Date.now()
            }
        );

        assert.equal(res.statusCode, 403);
    });

    it('rejects ingest with invalid session ID', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'POST',
            `/v1/ng/${TEST_APP_ID}/not-a-valid-uuid/data`,
            {
                origin: TEST_ORIGIN
            },
            {
                identity: { deviceId: 'dev-1' },
                meta: {},
                launchTs: Date.now()
            }
        );

        assert.equal(res.statusCode, 400);
    });
});

describe('Session list (integration)', () => {
    it('returns sessions via dev mode auth', async () => {
        // SessionAuthMiddleware falls through to dev mode when OIDC disabled + UXRR_DEV_MODE
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'GET',
            '/v1/sessions',
            {}
        );
        assert.equal(res.statusCode, 200);
        const sessions = JSON.parse(res.body.toString());
        assert.ok(Array.isArray(sessions));
    });

    it('returns session detail by ID', async () => {
        // First ensure we have a session by ingesting
        await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'POST',
            `/v1/ng/${TEST_APP_ID}/bbbbbbbb-cccc-dddd-eeee-ffffffffffff/data`,
            {
                origin: TEST_ORIGIN
            },
            {
                identity: { deviceId: 'dev-detail' },
                meta: {},
                launchTs: Date.now(),
                events: [{ type: 4, data: { width: 800, height: 600 }, timestamp: Date.now() }]
            }
        );

        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'GET',
            '/v1/sessions/bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
            {}
        );
        assert.equal(res.statusCode, 200);
        const session = JSON.parse(res.body.toString());
        assert.equal(session.id, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
        assert.equal(session.appId, TEST_APP_ID);
    });

    it('returns 404 for unknown session', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'GET',
            '/v1/sessions/00000000-0000-0000-0000-000000000000',
            {}
        );
        assert.equal(res.statusCode, 404);
    });

    it('filters sessions by appId', async () => {
        const res = await makeMockRequest(
            tf as unknown as Parameters<typeof makeMockRequest>[0],
            'GET',
            `/v1/sessions?appId=${TEST_APP_ID}`,
            {}
        );
        assert.equal(res.statusCode, 200);
        const sessions = JSON.parse(res.body.toString());
        for (const s of sessions) {
            assert.equal(s.appId, TEST_APP_ID);
        }
    });
});
