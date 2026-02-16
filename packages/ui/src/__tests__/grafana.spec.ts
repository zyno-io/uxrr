import { describe, it, expect } from 'vitest';

import { buildGrafanaTraceUrl } from '@/grafana';

describe('buildGrafanaTraceUrl', () => {
    it('constructs URL with correct base', () => {
        const url = buildGrafanaTraceUrl('https://grafana.example.com', 'tempo', 'abc123');
        expect(url).toContain('https://grafana.example.com/explore');
    });

    it('includes schemaVersion and orgId', () => {
        const url = buildGrafanaTraceUrl('https://grafana.example.com', 'tempo', 'abc123');
        expect(url).toContain('schemaVersion=1');
        expect(url).toContain('orgId=1');
    });

    it('includes datasource in encoded panes parameter', () => {
        const url = buildGrafanaTraceUrl('https://grafana.example.com', 'my-tempo', 'trace-id-1');
        const panesParam = new URL(url).searchParams.get('panes');
        expect(panesParam).toBeTruthy();
        const panes = JSON.parse(panesParam!);
        expect(panes.main.datasource).toBe('my-tempo');
    });

    it('includes traceId as query in panes', () => {
        const url = buildGrafanaTraceUrl('https://grafana.example.com', 'tempo', 'abcdef1234567890');
        const panesParam = new URL(url).searchParams.get('panes');
        const panes = JSON.parse(panesParam!);
        expect(panes.main.queries[0].query).toBe('abcdef1234567890');
        expect(panes.main.queries[0].queryType).toBe('traceql');
    });

    it('handles base URL without trailing slash', () => {
        const url = buildGrafanaTraceUrl('https://grafana.example.com', 'tempo', 'abc');
        expect(url).toMatch(/^https:\/\/grafana\.example\.com\/explore\?/);
    });
});
