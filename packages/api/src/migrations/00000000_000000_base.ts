import { createMigration } from '@zyno-io/dk-server-foundation';

export default createMigration(async db => {
    await db.rawExecute(`
        CREATE TABLE "sessions" (
            "id" VARCHAR(255) NOT NULL,
            "appId" VARCHAR(255) NOT NULL,
            "deviceId" VARCHAR(255) NOT NULL,
            "userId" VARCHAR(255),
            "userName" VARCHAR(255),
            "userEmail" VARCHAR(255),
            "version" VARCHAR(255),
            "environment" VARCHAR(255),
            "userAgent" VARCHAR(255),
            "ipAddress" VARCHAR(255),
            "startedAt" TIMESTAMP NOT NULL,
            "lastActivityAt" TIMESTAMP NOT NULL,
            "eventChunkCount" DOUBLE PRECISION NOT NULL,
            "eventBytesStored" DOUBLE PRECISION NOT NULL,
            "hasChatMessages" BOOLEAN NOT NULL,
            "createdAt" TIMESTAMP NOT NULL,
            "updatedAt" TIMESTAMP NOT NULL,
            PRIMARY KEY ("id")
        )
    `);
    await db.rawExecute(`CREATE INDEX "idx_sessions_appId" ON "sessions" ("appId")`);
    await db.rawExecute(`CREATE INDEX "idx_sessions_deviceId" ON "sessions" ("deviceId")`);
    await db.rawExecute(`CREATE INDEX "idx_sessions_userId" ON "sessions" ("userId")`);
    await db.rawExecute(`
        CREATE TABLE "session_user_ids" (
            "sessionId" VARCHAR(255) NOT NULL,
            "userId" VARCHAR(255) NOT NULL,
            PRIMARY KEY ("sessionId", "userId")
        )
    `);
    await db.rawExecute(`CREATE INDEX "idx_session_user_ids_userId" ON "session_user_ids" ("userId")`);
    await db.rawExecute(`
        CREATE TABLE "apps" (
            "id" VARCHAR(255) NOT NULL,
            "name" VARCHAR(255) NOT NULL,
            "origins" JSONB NOT NULL,
            "apiKey" VARCHAR(255),
            "isActive" BOOLEAN NOT NULL,
            "createdAt" TIMESTAMP NOT NULL,
            "updatedAt" TIMESTAMP NOT NULL,
            PRIMARY KEY ("id")
        )
    `);
    await db.rawExecute(`CREATE UNIQUE INDEX "idx_apps_apiKey" ON "apps" ("apiKey")`);
    await db.rawExecute(`
        CREATE TABLE "share_links" (
            "id" VARCHAR(255) NOT NULL,
            "sessionId" VARCHAR(255) NOT NULL,
            "expiresAt" TIMESTAMP NOT NULL,
            "revokedAt" TIMESTAMP,
            "createdAt" TIMESTAMP NOT NULL,
            PRIMARY KEY ("id")
        )
    `);
    await db.rawExecute(`CREATE INDEX "idx_share_links_sessionId" ON "share_links" ("sessionId")`);
    await db.rawExecute(`
        CREATE TABLE "api_keys" (
            "id" VARCHAR(255) NOT NULL,
            "name" VARCHAR(255) NOT NULL,
            "keyPrefix" VARCHAR(255) NOT NULL,
            "keySecret" VARCHAR(255) NOT NULL,
            "scope" VARCHAR(255) NOT NULL,
            "appIds" JSONB NOT NULL,
            "isActive" BOOLEAN NOT NULL,
            "createdAt" TIMESTAMP NOT NULL,
            "updatedAt" TIMESTAMP NOT NULL,
            PRIMARY KEY ("id")
        )
    `);
    await db.rawExecute(`CREATE UNIQUE INDEX "idx_api_keys_keyPrefix" ON "api_keys" ("keyPrefix")`);
    await db.rawExecute(`
        CREATE TABLE "users" (
            "id" VARCHAR(255) NOT NULL,
            "oidcSub" VARCHAR(255) NOT NULL,
            "email" VARCHAR(255) NOT NULL,
            "name" VARCHAR(255),
            "isAdmin" BOOLEAN NOT NULL,
            "lastLoginAt" TIMESTAMP NOT NULL,
            "createdAt" TIMESTAMP NOT NULL,
            "updatedAt" TIMESTAMP NOT NULL,
            PRIMARY KEY ("id")
        )
    `);
    await db.rawExecute(`CREATE UNIQUE INDEX "idx_users_oidcSub" ON "users" ("oidcSub")`);
    await db.rawExecute(`CREATE INDEX "idx_users_email" ON "users" ("email")`);
});
