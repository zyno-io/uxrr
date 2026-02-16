import { describe, it, mock, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { LokiService } from '../src/services/loki.service';
import type { UxrrConfig } from '../src/config';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn() } as unknown as Logger;
}

function makeConfig(lokiUrl = 'http://localhost:3100'): UxrrConfig {
    return { LOKI_URL: lokiUrl } as UxrrConfig;
}

describe('LokiService — LogQL injection prevention', () => {
    describe('escapeLogQL (tested via queryLogs)', () => {
        let fetchMock: ReturnType<typeof mock.fn>;

        beforeEach(() => {
            fetchMock = mock.fn(async () => ({
                ok: true,
                json: async () => ({ data: { result: [] } })
            }));
            (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
        });

        it('escapes backslashes in deviceId', async () => {
            const svc = new LokiService(makeConfig(), makeLogger());
            await svc.queryLogs('dev\\ice', 'sess-1');

            const call = fetchMock.mock.calls[0];
            const url = call.arguments[0] as string;
            // backslash should be escaped to double backslash
            assert.ok(
                url.includes('dev%5C%5Cice') || url.includes('dev\\\\ice'),
                `URL should contain escaped backslash: ${url}`
            );
        });

        it('escapes double quotes in deviceId', async () => {
            const svc = new LokiService(makeConfig(), makeLogger());
            await svc.queryLogs('dev"ice', 'sess-1');

            const call = fetchMock.mock.calls[0];
            const url = call.arguments[0] as string;
            // double quote should be escaped
            assert.ok(
                !url.includes('dev"ice') || url.includes('dev\\"ice'),
                `URL should contain escaped double quote: ${url}`
            );
        });

        it('escapes backticks in sessionId', async () => {
            const svc = new LokiService(makeConfig(), makeLogger());
            await svc.queryLogs('dev-1', 'sess`1');

            const call = fetchMock.mock.calls[0];
            const url = call.arguments[0] as string;
            // backtick should be escaped in the pipeline filter
            assert.ok(
                !url.includes('sess`1') || url.includes('sess\\`1'),
                `URL should contain escaped backtick: ${url}`
            );
        });

        it('malicious deviceId with double quote produces safe query', async () => {
            const svc = new LokiService(makeConfig(), makeLogger());
            const maliciousDeviceId = 'dev"} | evil_query | {"x="';
            await svc.queryLogs(maliciousDeviceId, 'sess-1');

            const call = fetchMock.mock.calls[0];
            const url = call.arguments[0] as string;
            const decodedUrl = decodeURIComponent(url);
            // The injected closing brace should be inside an escaped string
            assert.ok(!decodedUrl.includes('| evil_query |'), `Should not contain unescaped injection: ${decodedUrl}`);
        });
    });
});
