import type { Logger } from '@zyno-io/ts-server-foundation';

import { strict as assert } from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';

import type { UxrrConfig } from '../src/config';

import { LokiService } from '../src/services/loki.service';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn() } as unknown as Logger;
}

function makeConfig(lokiUrl = 'http://localhost:3100'): UxrrConfig {
    return { LOKI_URL: lokiUrl } as UxrrConfig;
}

describe('LokiService', () => {
    describe('structured metadata', () => {
        it('stores sessionId as structured metadata instead of in the log line or stream labels', async () => {
            const fetchMock = mock.fn(async (_url: string, _options?: RequestInit) => ({ ok: true }));
            (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;

            const svc = new LokiService(makeConfig(), makeLogger());
            await svc.pushLogs([
                {
                    t: 1_700_000_000_000,
                    v: 1,
                    c: 'checkout',
                    m: 'Payment processed',
                    d: { orderId: '123' },
                    appKey: 'storefront',
                    deviceId: 'device-1',
                    userId: 'user-1',
                    sessionId: 'session-1'
                }
            ]);

            const request = fetchMock.mock.calls[0];
            const options = request.arguments[1] as RequestInit;
            const payload = JSON.parse(options.body as string);
            const stream = payload.streams[0];
            const [timestamp, line, metadata] = stream.values[0];

            assert.deepEqual(stream.stream, {
                job: 'uxrr',
                appKey: 'storefront',
                deviceId: 'device-1',
                userId: 'user-1'
            });
            assert.equal(timestamp, '1700000000000000000');
            assert.deepEqual(JSON.parse(line), {
                level: 'info',
                scope: 'checkout',
                message: 'Payment processed',
                data: { orderId: '123' }
            });
            assert.deepEqual(metadata, { sessionId: 'session-1' });
        });

        it('queries structured metadata and the legacy JSON field', async () => {
            const fetchMock = mock.fn(async (url: string) => {
                const query = new URL(url).searchParams.get('query');
                if (query?.includes('| sessionId=')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: {
                                result: [
                                    {
                                        stream: {
                                            job: 'uxrr',
                                            appKey: 'storefront',
                                            deviceId: 'device-1',
                                            sessionId: 'session-1'
                                        },
                                        values: [['1700000000000000000', '{"level":"info","scope":"new","message":"new log"}']]
                                    }
                                ]
                            }
                        })
                    };
                }

                return {
                    ok: true,
                    json: async () => ({
                        data: {
                            result: [
                                {
                                    stream: { job: 'uxrr', appKey: 'storefront', deviceId: 'device-1' },
                                    values: [['1699999999000000000', '{"level":"warn","scope":"legacy","message":"old log","sessionId":"session-1"}']]
                                }
                            ]
                        }
                    })
                };
            });
            (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;

            const svc = new LokiService(makeConfig(), makeLogger());
            const logs = await svc.queryLogs('device-1', 'session-1');

            assert.equal(fetchMock.mock.callCount(), 2);
            assert.deepEqual(
                logs.map(log => ({ t: log.t, c: log.c, sessionId: log.sessionId })),
                [
                    { t: 1_699_999_999_000, c: 'legacy', sessionId: 'session-1' },
                    { t: 1_700_000_000_000, c: 'new', sessionId: 'session-1' }
                ]
            );
        });
    });

    describe('LogQL injection prevention', () => {
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
                assert.ok(url.includes('dev%5C%5Cice') || url.includes('dev\\\\ice'), `URL should contain escaped backslash: ${url}`);
            });

            it('escapes double quotes in deviceId', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                await svc.queryLogs('dev"ice', 'sess-1');

                const call = fetchMock.mock.calls[0];
                const url = call.arguments[0] as string;
                // double quote should be escaped
                assert.ok(!url.includes('dev"ice') || url.includes('dev\\"ice'), `URL should contain escaped double quote: ${url}`);
            });

            it('keeps backticks in sessionId inside a quoted label filter', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                await svc.queryLogs('dev-1', 'sess`1');

                const call = fetchMock.mock.calls[0];
                const url = call.arguments[0] as string;
                const query = new URL(url).searchParams.get('query');
                assert.equal(query, '{job="uxrr", deviceId="dev-1"} | sessionId="sess`1"');
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
});
