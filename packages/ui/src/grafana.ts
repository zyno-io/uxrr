export function buildGrafanaTraceUrl(baseUrl: string, datasource: string, traceId: string): string {
    const panes = JSON.stringify({
        main: {
            datasource,
            queries: [{ refId: 'A', queryType: 'traceql', query: traceId }]
        }
    });
    return `${baseUrl}/explore?schemaVersion=1&panes=${encodeURIComponent(panes)}&orgId=1`;
}
