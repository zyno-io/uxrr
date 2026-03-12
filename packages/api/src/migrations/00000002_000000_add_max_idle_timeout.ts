import { createMigration } from '@zyno-io/dk-server-foundation';

export default createMigration(async db => {
    await db.rawExecute(`ALTER TABLE "apps" ADD COLUMN "maxIdleTimeout" INTEGER`);
});
