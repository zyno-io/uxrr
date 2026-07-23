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
        it('stores sessionId, deviceId, and userId as structured metadata instead of stream labels', async () => {
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
                    appId: 'app-uuid-1',
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

            assert.deepEqual(stream.stream, { job: 'uxrr', appId: 'app-uuid-1', appKey: 'storefront', shard: '13' });
            assert.equal(stream.stream.deviceId, undefined);
            assert.equal(stream.stream.userId, undefined);
            assert.equal(timestamp, '1700000000000000000');
            assert.deepEqual(JSON.parse(line), {
                level: 'info',
                scope: 'checkout',
                message: 'Payment processed',
                data: { orderId: '123' }
            });
            assert.deepEqual(metadata, {
                sessionId: 'session-1',
                deviceId: 'device-1',
                userId: 'user-1'
            });
        });

        it('uses a stable bounded shard to distribute session writes', async () => {
            const fetchMock = mock.fn(async (_url: string, _options?: RequestInit) => ({ ok: true }));
            (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;

            const svc = new LokiService(makeConfig(), makeLogger());
            await svc.pushLogs(
                ['session-1', 'session-1', 'session-2'].map((sessionId, index) => ({
                    t: 1_700_000_000_000 + index,
                    v: 1,
                    c: 'scope',
                    m: 'message',
                    appId: 'app-uuid-1',
                    appKey: 'storefront',
                    deviceId: 'device-1',
                    sessionId
                }))
            );

            const payload = JSON.parse((fetchMock.mock.calls[0].arguments[1] as RequestInit).body as string);
            assert.equal(payload.streams.length, 2);
            const firstSessionStream = payload.streams.find((stream: { values: [string, string, { sessionId: string }][] }) => {
                return stream.values[0][2].sessionId === 'session-1';
            });
            assert.equal(firstSessionStream.values.length, 2);
            assert.match(firstSessionStream.stream.shard, /^(?:[0-9]|1[0-5])$/);
            assert.notEqual(
                firstSessionStream.stream.shard,
                payload.streams.find((stream: { values: [string, string, { sessionId: string }][] }) => {
                    return stream.values[0][2].sessionId === 'session-2';
                }).stream.shard
            );
        });

        it('queries UUID-labeled metadata plus both historical appKey formats', async () => {
            const fetchMock = mock.fn(async (url: string) => {
                const query = new URL(url).searchParams.get('query');
                if (query?.includes('appId="app-uuid-1"')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: {
                                result: [
                                    {
                                        stream: {
                                            job: 'uxrr',
                                            appId: 'app-uuid-1',
                                            deviceId: 'device-1',
                                            userId: 'user-1',
                                            sessionId: 'session-1'
                                        },
                                        values: [['1700000000000000000', '{"level":"info","scope":"new","message":"new log"}']]
                                    }
                                ]
                            }
                        })
                    };
                }

                if (query?.includes('appKey="app-uuid-1"') && query.includes('| sessionId=')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: {
                                result: [
                                    {
                                        stream: {
                                            job: 'uxrr',
                                            appKey: 'app-uuid-1',
                                            deviceId: 'device-1',
                                            sessionId: 'session-1'
                                        },
                                        values: [['1699999999250000000', '{"level":"info","scope":"uuid-history","message":"uuid history"}']]
                                    }
                                ]
                            }
                        })
                    };
                }

                // A missing appId exclusion would match current streams a second
                // time through their retained human appKey label.
                if (query?.includes('appKey="storefront"') && !query.includes('appId=""')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: {
                                result: [
                                    {
                                        stream: {
                                            job: 'uxrr',
                                            appId: 'app-uuid-1',
                                            appKey: 'storefront',
                                            deviceId: 'device-1',
                                            sessionId: 'session-1'
                                        },
                                        values: [['1700000000000000000', '{"level":"info","scope":"duplicate","message":"duplicate log"}']]
                                    }
                                ]
                            }
                        })
                    };
                }

                if (query?.includes('appKey="storefront"') && query.includes('| sessionId=')) {
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
                                            userId: 'previous-user-1',
                                            sessionId: 'session-1'
                                        },
                                        values: [['1699999999500000000', '{"level":"info","scope":"previous","message":"previous log"}']]
                                    }
                                ]
                            }
                        })
                    };
                }

                if (!query?.includes('appKey="storefront"')) return { ok: true, json: async () => ({ data: { result: [] } }) };
                return {
                    ok: true,
                    json: async () => ({
                        data: {
                            result: [
                                {
                                    stream: { job: 'uxrr', appKey: 'storefront', deviceId: 'device-1', userId: 'legacy-user-1' },
                                    values: [['1699999999000000000', '{"level":"warn","scope":"legacy","message":"old log","sessionId":"session-1"}']]
                                }
                            ]
                        }
                    })
                };
            });
            (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;

            const svc = new LokiService(makeConfig(), makeLogger());
            const logs = await svc.queryLogs('app-uuid-1', 'device-1', 'session-1', undefined, undefined, 'storefront');

            assert.equal(fetchMock.mock.callCount(), 5);
            assert.equal(
                new URL(fetchMock.mock.calls[0].arguments[0] as string).searchParams.get('query'),
                '{job="uxrr", appId="app-uuid-1"} | deviceId="device-1" | sessionId="session-1"'
            );
            const legacyQueries = fetchMock.mock.calls.slice(1).map(call => new URL(call.arguments[0] as string).searchParams.get('query'));
            assert.ok(legacyQueries.every(query => query?.includes('appId=""')));
            assert.deepEqual(
                logs.map(log => ({
                    t: log.t,
                    c: log.c,
                    appId: log.appId,
                    appKey: log.appKey,
                    deviceId: log.deviceId,
                    userId: log.userId,
                    sessionId: log.sessionId
                })),
                [
                    {
                        t: 1_699_999_999_000,
                        c: 'legacy',
                        appId: 'app-uuid-1',
                        appKey: 'storefront',
                        deviceId: 'device-1',
                        userId: 'legacy-user-1',
                        sessionId: 'session-1'
                    },
                    {
                        t: 1_699_999_999_249,
                        c: 'uuid-history',
                        appId: 'app-uuid-1',
                        appKey: 'storefront',
                        deviceId: 'device-1',
                        userId: undefined,
                        sessionId: 'session-1'
                    },
                    {
                        t: 1_699_999_999_500,
                        c: 'previous',
                        appId: 'app-uuid-1',
                        appKey: 'storefront',
                        deviceId: 'device-1',
                        userId: 'previous-user-1',
                        sessionId: 'session-1'
                    },
                    {
                        t: 1_700_000_000_000,
                        c: 'new',
                        appId: 'app-uuid-1',
                        appKey: 'storefront',
                        deviceId: 'device-1',
                        userId: 'user-1',
                        sessionId: 'session-1'
                    }
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

            it('escapes backslashes in the legacy deviceId selector', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                await svc.queryLogs('app-uuid-1', 'dev\\ice', 'sess-1');

                const call = fetchMock.mock.calls[1];
                const url = call.arguments[0] as string;
                // backslash should be escaped to double backslash
                assert.ok(url.includes('dev%5C%5Cice') || url.includes('dev\\\\ice'), `URL should contain escaped backslash: ${url}`);
            });

            it('escapes double quotes in the legacy deviceId selector', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                await svc.queryLogs('app-uuid-1', 'dev"ice', 'sess-1');

                const call = fetchMock.mock.calls[1];
                const url = call.arguments[0] as string;
                // double quote should be escaped
                assert.ok(!url.includes('dev"ice') || url.includes('dev\\"ice'), `URL should contain escaped double quote: ${url}`);
            });

            it('keeps backticks in sessionId inside a quoted structured-metadata filter', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                await svc.queryLogs('app-uuid-1', 'dev-1', 'sess`1');

                const call = fetchMock.mock.calls[0];
                const url = call.arguments[0] as string;
                const query = new URL(url).searchParams.get('query');
                assert.equal(query, '{job="uxrr", appId="app-uuid-1"} | deviceId="dev-1" | sessionId="sess`1"');
            });

            it('malicious deviceId with double quote produces safe query', async () => {
                const svc = new LokiService(makeConfig(), makeLogger());
                const maliciousDeviceId = 'dev"} | evil_query | {"x="';
                await svc.queryLogs('app-uuid-1', maliciousDeviceId, 'sess-1');

                const call = fetchMock.mock.calls[1];
                const url = call.arguments[0] as string;
                const decodedUrl = decodeURIComponent(url);
                // The injected closing brace should be inside an escaped string
                assert.ok(!decodedUrl.includes('| evil_query |'), `Should not contain unescaped injection: ${decodedUrl}`);
            });
        });
    });
});
