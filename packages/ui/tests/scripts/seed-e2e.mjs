import pg from 'pg';

const client = new pg.Client({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || 'uxrr',
    password: process.env.PG_PASSWORD_SECRET || 'test',
    database: process.env.PG_DATABASE || 'uxrr_test'
});

async function seed() {
    await client.connect();

    await client.query(`
        INSERT INTO apps (id, name, origins, "isActive", "createdAt", "updatedAt")
        VALUES ('e2e-app', 'E2E Test App', '["http://localhost"]'::jsonb, true, now(), now())
        ON CONFLICT DO NOTHING
    `);

    // The live-session-reconnect test uses appId 'test-app' from sdk-client.html
    // and the SDK fixture page runs on port 9876
    await client.query(`
        INSERT INTO apps (id, name, origins, "isActive", "createdAt", "updatedAt")
        VALUES ('test-app', 'SDK Test App', '["http://localhost:9876"]'::jsonb, true, now(), now())
        ON CONFLICT DO NOTHING
    `);

    await client.query(`
        INSERT INTO sessions (id, "appId", "deviceId", "startedAt", "lastActivityAt", "eventChunkCount", "eventBytesStored", "hasChatMessages", "createdAt", "updatedAt")
        VALUES ('e2e-session-1', 'e2e-app', 'e2e-device', now(), now(), 0, 0, false, now(), now())
        ON CONFLICT DO NOTHING
    `);

    await client.end();
    console.log('E2E seed complete.');
}

seed().catch(e => {
    console.error(e);
    process.exit(1);
});
