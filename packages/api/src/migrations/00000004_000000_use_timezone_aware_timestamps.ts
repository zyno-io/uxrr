import { createMigration } from '@zyno-io/ts-server-foundation';

export default createMigration(async db => {
    // Existing timestamp values were written by the UTC API process. Make that
    // assumption explicit while converting them to absolute instants.
    await db.rawExecute(`
        ALTER TABLE "sessions"
            ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ USING "startedAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "lastActivityAt" TYPE TIMESTAMPTZ USING "lastActivityAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ USING "updatedAt" AT TIME ZONE 'UTC'
    `);
    await db.rawExecute(`
        ALTER TABLE "apps"
            ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ USING "updatedAt" AT TIME ZONE 'UTC'
    `);
    await db.rawExecute(`
        ALTER TABLE "share_links"
            ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ USING "expiresAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "revokedAt" TYPE TIMESTAMPTZ USING "revokedAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC'
    `);
    await db.rawExecute(`
        ALTER TABLE "api_keys"
            ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ USING "updatedAt" AT TIME ZONE 'UTC'
    `);
    await db.rawExecute(`
        ALTER TABLE "users"
            ALTER COLUMN "lastLoginAt" TYPE TIMESTAMPTZ USING "lastLoginAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
            ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ USING "updatedAt" AT TIME ZONE 'UTC'
    `);
});
