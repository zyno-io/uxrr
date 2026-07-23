import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

import type { LokiService } from '../src/services/loki.service';
import type { S3Service } from '../src/services/s3.service';
import type { SessionService } from '../src/services/session.service';
import type { ShareService } from '../src/services/share.service';

import { ShareController } from '../src/controllers/share.controller';

describe('ShareController log queries', () => {
    it('uses the canonical app UUID and refreshed legacy app key', async () => {
        const now = new Date();
        const session = {
            id: 'sess-1',
            appId: 'app-uuid-1',
            deviceId: 'device-1',
            startedAt: now,
            lastActivityAt: now
        };
        const queryLogsFn = mock.fn(async () => []);
        const controller = new ShareController(
            { validateShareAccess: mock.fn(async () => 'sess-1') } as unknown as ShareService,
            { getOrThrow: mock.fn(async () => session) } as unknown as SessionService,
            {} as S3Service,
            { queryLogs: queryLogsFn } as unknown as LokiService,
            {
                resolveAppKey: mock.fn(() => 'legacy-app-key'),
                resolveAppKeyFresh: mock.fn(async () => 'legacy-app-key')
            } as any
        );

        await controller.getSessionLogs('share-token', {});

        const args = [...queryLogsFn.mock.calls[0].arguments] as unknown[];
        assert.deepEqual(args.slice(0, 3), ['app-uuid-1', 'device-1', 'sess-1']);
        assert.ok(args[3] instanceof Date);
        assert.ok(args[4] instanceof Date);
        assert.equal(args[5], 'legacy-app-key');
    });
});
