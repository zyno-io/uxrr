import { ScopedLogger } from '@zyno-io/ts-server-foundation';

import type { StoredLogEntry } from './ingest.service';

import { UxrrConfig } from '../config';

const LOG_LEVEL_MAP: Record<number, string> = {
    0: 'debug',
    1: 'info',
    2: 'warn',
    3: 'error'
};

const LEVEL_REVERSE: Record<string, number> = Object.fromEntries(Object.entries(LOG_LEVEL_MAP).map(([k, v]) => [v, Number(k)]));
// Keep writes distributed without placing raw session identities in labels.
const STREAM_SHARD_COUNT = 16;

type LokiPushValue = [string, string, Record<string, string>];

interface LokiQueryStream {
    stream: Record<string, string>;
    values: [string, string][];
}

/** Escape a value for use inside a LogQL double-quoted string. */
function escapeLogQL(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Return a stable, bounded shard for a session without exposing its ID as a label. */
function getSessionShard(sessionId: string): string {
    let hash = 2_166_136_261; // FNV-1a
    for (let i = 0; i < sessionId.length; i++) {
        hash = Math.imul(hash ^ sessionId.charCodeAt(i), 16_777_619);
    }
    return String((hash >>> 0) % STREAM_SHARD_COUNT);
}

export class LokiService {
    private readonly url?: string;
    private readonly authHeader?: string;

    constructor(
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger
    ) {
        if (config.LOKI_URL) {
            this.url = `${config.LOKI_URL}/loki/api/v1/push`;
            if (config.LOKI_AUTH_USER) {
                this.authHeader = 'Basic ' + Buffer.from(`${config.LOKI_AUTH_USER}:${config.LOKI_AUTH_PASSWORD_SECRET ?? ''}`).toString('base64');
            }
        }
    }

    async pushLogs(entries: StoredLogEntry[]): Promise<void> {
        if (!this.url || entries.length === 0) return;

        // Group by indexed, low-cardinality labels. The bounded session shard
        // distributes writes without exposing session IDs, while per-session and
        // per-user/device values remain structured metadata.
        const streams = new Map<string, { labels: Record<string, string>; values: LokiPushValue[] }>();

        for (const entry of entries) {
            const labels: Record<string, string> = {
                job: 'uxrr',
                appId: entry.appId,
                appKey: entry.appKey,
                shard: getSessionShard(entry.sessionId)
            };

            const labelKey = JSON.stringify(labels);
            if (!streams.has(labelKey)) {
                streams.set(labelKey, { labels, values: [] });
            }

            const tsNano = String(entry.t * 1_000_000); // ms → ns
            const level = LOG_LEVEL_MAP[entry.v] ?? 'info';
            const line = JSON.stringify({
                level,
                scope: entry.c,
                message: entry.m,
                ...(entry.d ? { data: entry.d } : {})
            });

            streams.get(labelKey)!.values.push([
                tsNano,
                line,
                {
                    sessionId: entry.sessionId,
                    deviceId: entry.deviceId,
                    ...(entry.userId ? { userId: entry.userId } : {})
                }
            ]);
        }

        const payload = {
            streams: [...streams.values()].map(({ labels, values }) => ({
                stream: labels,
                values
            }))
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.authHeader) {
            headers['Authorization'] = this.authHeader;
        }

        const response = await fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Loki push failed (${response.status}): ${body}`);
        }
    }

    async queryLogs(appId: string, deviceId: string, sessionId: string, from?: Date, to?: Date, legacyAppKey?: string): Promise<StoredLogEntry[]> {
        if (!this.config.LOKI_URL) return [];

        const metadataFilter = `| deviceId="${escapeLogQL(deviceId)}" | sessionId="${escapeLogQL(sessionId)}"`;
        const metadataQuery = `{job="uxrr", appId="${escapeLogQL(appId)}"} ${metadataFilter}`;

        // Keep historical logs readable. Before sessionId, deviceId, and userId
        // became structured metadata, the identity values were stream labels and
        // the session ID was serialized into the JSON log line.
        // Earlier live persistence used the UUID as appKey; direct ingest used
        // the human app key. Query both representations while new writes use appId.
        const legacyAppValues = [...new Set([appId, legacyAppKey].filter((value): value is string => Boolean(value)))];
        const legacyNeedle = `"sessionId":${JSON.stringify(sessionId)}`;
        // `appId=""` matches streams without the new appId label, preventing
        // current streams (which also retain appKey) from being read twice.
        const legacyMetadataQueries = legacyAppValues.map(appKey => {
            return `{job="uxrr", appKey="${escapeLogQL(appKey)}", appId=""} ${metadataFilter}`;
        });
        const legacyJsonQueries = legacyAppValues.map(appKey => {
            const selector = `{job="uxrr", appKey="${escapeLogQL(appKey)}", deviceId="${escapeLogQL(deviceId)}", appId=""}`;
            return `${selector} |= "${escapeLogQL(legacyNeedle)}"`;
        });

        const streams = (
            await Promise.all([metadataQuery, ...legacyMetadataQueries, ...legacyJsonQueries].map(query => this.queryRange(query, from, to)))
        ).flat();
        const entries: StoredLogEntry[] = [];

        for (const stream of streams) {
            const labels = stream.stream;
            for (const [tsNano, line] of stream.values) {
                try {
                    const parsed = JSON.parse(line);
                    entries.push({
                        t: Math.floor(Number(tsNano) / 1_000_000), // ns → ms
                        v: LEVEL_REVERSE[parsed.level] ?? 1,
                        c: parsed.scope ?? '',
                        m: parsed.message ?? '',
                        d: parsed.data,
                        appId,
                        appKey: legacyAppKey ?? labels.appKey ?? appId,
                        deviceId: labels.deviceId,
                        userId: labels.userId,
                        sessionId: labels.sessionId ?? parsed.sessionId ?? sessionId
                    });
                } catch (err) {
                    this.logger.warn('Failed to parse Loki log line', { err });
                }
            }
        }

        return entries.sort((a, b) => a.t - b.t);
    }

    private async queryRange(query: string, from?: Date, to?: Date): Promise<LokiQueryStream[]> {
        const params = new URLSearchParams({ query, direction: 'forward', limit: '5000' });
        if (from) params.set('start', String(from.getTime() * 1_000_000));
        if (to) params.set('end', String(to.getTime() * 1_000_000));

        const url = `${this.config.LOKI_URL}/loki/api/v1/query_range?${params}`;

        try {
            const headers: Record<string, string> = {};
            if (this.authHeader) {
                headers['Authorization'] = this.authHeader;
            }

            const response = await fetch(url, { headers });
            if (!response.ok) {
                this.logger.warn('Loki query failed', { status: response.status });
                return [];
            }

            const result = (await response.json()) as {
                data?: { result?: LokiQueryStream[] };
            };
            return result.data?.result ?? [];
        } catch (err) {
            this.logger.error('Failed to query Loki', err);
            return [];
        }
    }

    async deleteLogsBefore(cutoff: Date): Promise<void> {
        if (!this.config.LOKI_URL) return;

        const params = new URLSearchParams({
            query: '{job="uxrr"}',
            end: String(cutoff.getTime() * 1_000_000) // ms → ns
        });
        const url = `${this.config.LOKI_URL}/loki/api/v1/delete?${params}`;

        const headers: Record<string, string> = {};
        if (this.authHeader) {
            headers['Authorization'] = this.authHeader;
        }

        try {
            const response = await fetch(url, { method: 'POST', headers });
            if (!response.ok) {
                const body = await response.text();
                this.logger.warn(`Loki bulk delete failed (${response.status}): ${body}`);
            }
        } catch (err) {
            this.logger.error('Failed to delete Loki logs', err);
        }
    }
}
