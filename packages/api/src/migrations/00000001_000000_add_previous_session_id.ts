import { createMigration } from '@zyno-io/dk-server-foundation';

export default createMigration(async db => {
    await db.rawExecute(`ALTER TABLE "sessions" ADD COLUMN "previousSessionId" UUID`);
    await db.rawExecute(`CREATE INDEX "idx_sessions_previousSessionId" ON "sessions" ("previousSessionId")`);
});
