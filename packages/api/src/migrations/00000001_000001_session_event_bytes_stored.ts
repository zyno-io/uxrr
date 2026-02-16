import { createMigration } from '@zyno-io/dk-server-foundation';

export default createMigration(async db => {
    await db.rawExecute(
        `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "eventBytesStored" DOUBLE PRECISION NOT NULL DEFAULT 0`
    );
});
