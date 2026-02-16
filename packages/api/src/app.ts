import { createApp } from '@zyno-io/dk-server-foundation';
import type { HttpCorsOptions } from '@zyno-io/dk-server-foundation/http/cors.js';

import { UxrrConfig } from './config';
import { UxrrDatabase } from './database/database';
import { AdminController } from './controllers/admin.controller';
import { ApiKeyController } from './controllers/api-key.controller';
import { AuthController } from './controllers/auth.controller';
import { IngestController } from './controllers/ingest.controller';
import { SessionController } from './controllers/session.controller';
import { ShareController } from './controllers/share.controller';
import { StaticContentListener } from './listener';
import { AppGuard } from './middleware/origin.guard';
import { SecurityHeadersListener } from './middleware/security-headers.listener';
import { OidcAuthMiddleware } from './middleware/oidc-auth.middleware';
import { SessionAuthMiddleware } from './middleware/session-auth.middleware';
import { ApiKeyService } from './services/api-key.service';
import { AppResolverService } from './services/app-resolver.service';
import { IngestService } from './services/ingest.service';
import { LiveSessionService } from './services/live-session.service';
import { LokiService } from './services/loki.service';
import { OidcService } from './services/oidc.service';
import { PodPresenceService } from './services/pod-presence.service';
import { RedisService } from './services/redis.service';
import { S3Service } from './services/s3.service';
import { RetentionService } from './services/retention.service';
import { SessionNotifyService } from './services/session-notify.service';
import { SessionService } from './services/session.service';
import { ShareService } from './services/share.service';
import { UserService } from './services/user.service';
import { WebSocketService } from './services/websocket.service';

const app = createApp({
    config: UxrrConfig,
    frameworkConfig: { port: 8977 },
    db: UxrrDatabase,
    controllers: [
        AdminController,
        AuthController,
        IngestController,
        SessionController,
        ShareController,
        ApiKeyController
    ],
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
    listeners: [AppGuard, SecurityHeadersListener, StaticContentListener],
    cors: (): HttpCorsOptions => ({
        hosts: ['*'],
        paths: [/^\/v1\/ingest/, /^\/v1\/ng\//],
        methods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-API-Key', 'X-Embed-Token']
    })
});

app.run().then(() => {
    // Deepkit doesn't call process.exit(0) after successful CLI commands, relying on
    // event loop drain. But the DB connection pool stays open because DatabaseRegistry
    // is only initialized during server:start. Force exit for non-server commands.
    if (process.argv[2] !== 'server:start') process.exit(0);
});
