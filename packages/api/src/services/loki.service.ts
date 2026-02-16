import { ScopedLogger } from '@deepkit/logger';

import { UxrrConfig } from '../config';
import type { StoredLogEntry } from './ingest.service';

const LOG_LEVEL_MAP: Record<number, string> = {
    0: 'debug',
    1: 'info',
    2: 'warn',
    3: 'error'
};

const LEVEL_REVERSE: Record<string, number> = Object.fromEntries(
    Object.entries(LOG_LEVEL_MAP).map(([k, v]) => [v, Number(k)])
);

/** Escape a value for use inside LogQL double-quoted label matchers or backtick pipeline filters. */
function escapeLogQL(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`');
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
                this.authHeader =
                    'Basic ' +
                    Buffer.from(`${config.LOKI_AUTH_USER}:${config.LOKI_AUTH_PASSWORD_SECRET ?? ''}`).toString(
                        'base64'
                    );
            }
        }
    }

    async pushLogs(entries: StoredLogEntry[]): Promise<void> {
        if (!this.url || entries.length === 0) return;

        // group by label set (appId + deviceId + userId + sessionId)
        const streams = new Map<string, { labels: Record<string, string>; values: [string, string][] }>();

        for (const entry of entries) {
            const labels: Record<string, string> = {
                job: 'uxrr',
                appId: entry.appId,
                deviceId: entry.deviceId
            };
            if (entry.userId) {
                labels.userId = entry.userId;
            }

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
                sessionId: entry.sessionId,
                ...(entry.d ? { data: entry.d } : {})
            });

            streams.get(labelKey)!.values.push([tsNano, line]);
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

    async queryLogs(deviceId: string, sessionId: string, from?: Date, to?: Date): Promise<StoredLogEntry[]> {
        if (!this.config.LOKI_URL) return [];

        // Use a line filter instead of `| json` to avoid Loki flattening/stripping
        // nested objects (like the `data` field) from the log line content.
        const query = `{job="uxrr", deviceId="${escapeLogQL(deviceId)}"} |= \`"sessionId":"${escapeLogQL(sessionId)}"\``;
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
                data?: { result?: { stream: Record<string, string>; values: [string, string][] }[] };
            };
            const entries: StoredLogEntry[] = [];

            for (const stream of result.data?.result ?? []) {
                const labels = stream.stream;
                for (const [tsNano, line] of stream.values) {
                    const parsed = JSON.parse(line);
                    entries.push({
                        t: Math.floor(Number(tsNano) / 1_000_000), // ns → ms
                        v: LEVEL_REVERSE[parsed.level] ?? 1,
                        c: parsed.scope ?? '',
                        m: parsed.message ?? '',
                        d: parsed.data,
                        appId: labels.appId,
                        deviceId: labels.deviceId,
                        userId: labels.userId,
                        sessionId: parsed.sessionId ?? sessionId
                    });
                }
            }

            return entries.sort((a, b) => a.t - b.t);
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
