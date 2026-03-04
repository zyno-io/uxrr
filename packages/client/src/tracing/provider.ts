import type { Tracer } from '@opentelemetry/api';
import type { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

import type { IdentityManager } from '../identity';
import type { IngestBuffer } from '../transport/ingest-buffer';
import type { HttpTransport } from '../transport/http';
import type { UxrrConfig } from '../types';
import type { NetworkLogger } from './network-logger';

export class TracingProvider {
    private provider: WebTracerProvider;
    private networkLogger?: NetworkLogger;
    readonly tracer: Tracer;

    constructor(provider: WebTracerProvider, tracer: Tracer, networkLogger?: NetworkLogger) {
        this.provider = provider;
        this.tracer = tracer;
        this.networkLogger = networkLogger;
    }

    async shutdown(): Promise<void> {
        this.networkLogger?.restore();
        await this.provider.shutdown();
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function createTracingProvider(
    transport: HttpTransport,
    identity: IdentityManager,
    sessionId: string,
    config: UxrrConfig,
    ingestBuffer?: IngestBuffer
): Promise<TracingProvider> {
    const [
        { ZoneContextManager },
        { OTLPTraceExporter },
        { registerInstrumentations },
        { FetchInstrumentation },
        { XMLHttpRequestInstrumentation },
        { resourceFromAttributes },
        { BatchSpanProcessor },
        { WebTracerProvider },
        { NetworkLogger },
        { IdentitySpanProcessor }
    ] = await Promise.all([
        import('@opentelemetry/context-zone'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/instrumentation'),
        import('@opentelemetry/instrumentation-fetch'),
        import('@opentelemetry/instrumentation-xml-http-request'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/sdk-trace-base'),
        import('@opentelemetry/sdk-trace-web'),
        import('./network-logger'),
        import('./span-processor')
    ]);

    const resource = resourceFromAttributes({
        'service.name': config.appKey,
        'service.version': config.version ?? 'unknown',
        'deployment.environment': config.environment ?? 'unknown'
    });

    const exporter = new OTLPTraceExporter({
        url: transport.getIngestUrl('t'),
        headers: {}
    });

    const isDev = config.environment === 'development';
    const baseProcessor = new BatchSpanProcessor(exporter, isDev ? { scheduledDelayMillis: 2000 } : undefined);
    const processor = new IdentitySpanProcessor(
        baseProcessor,
        identity,
        sessionId,
        config.tracing?.spanAttributes,
        config.tracing?.includeIdentityAttributes
    );

    const provider = new WebTracerProvider({
        resource,
        spanProcessors: [processor]
    });

    provider.register({
        contextManager: new ZoneContextManager()
    });

    const ignoreUrls = [...(config.tracing?.ignoreUrls ?? []), new RegExp(escapeRegex(config.endpoint))];
    const propagateTraceHeaderCorsUrls = config.tracing?.propagateToOrigins ?? [];

    // Install NetworkLogger before OTel so OTel wraps our wrapped fetch
    let networkLogger: NetworkLogger | undefined;
    if (config.tracing?.logRequests !== false && ingestBuffer) {
        networkLogger = new NetworkLogger(ingestBuffer, config);
    }

    registerInstrumentations({
        tracerProvider: provider,
        instrumentations: [
            new FetchInstrumentation({
                ignoreUrls,
                propagateTraceHeaderCorsUrls,
                clearTimingResources: true
            }),
            new XMLHttpRequestInstrumentation({
                ignoreUrls,
                propagateTraceHeaderCorsUrls
            })
        ]
    });

    const tracer = provider.getTracer('uxrr');

    return new TracingProvider(provider, tracer, networkLogger);
}
