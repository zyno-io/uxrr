import type { Tracer } from '@opentelemetry/api';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

import type { IdentityManager } from '../identity';
import type { IngestBuffer } from '../transport/ingest-buffer';
import type { HttpTransport } from '../transport/http';
import type { UxrrConfig } from '../types';
import { NetworkLogger } from './network-logger';
import { IdentitySpanProcessor } from './span-processor';

export class TracingProvider {
    private provider: WebTracerProvider;
    private networkLogger?: NetworkLogger;
    readonly tracer: Tracer;

    constructor(
        transport: HttpTransport,
        identity: IdentityManager,
        sessionId: string,
        config: UxrrConfig,
        ingestBuffer?: IngestBuffer
    ) {
        const resource = resourceFromAttributes({
            'service.name': config.appId,
            'service.version': config.version ?? 'unknown',
            'deployment.environment': config.environment ?? 'unknown'
        });

        const exporter = new OTLPTraceExporter({
            url: transport.getIngestUrl('t'),
            headers: {}
        });

        const isDev = config.environment === 'development';
        const baseProcessor = new BatchSpanProcessor(exporter, isDev ? { scheduledDelayMillis: 2000 } : undefined);
        const processor = new IdentitySpanProcessor(baseProcessor, identity, sessionId, config.tracing?.spanAttributes);

        this.provider = new WebTracerProvider({
            resource,
            spanProcessors: [processor]
        });

        this.provider.register({
            contextManager: new ZoneContextManager()
        });

        const ignoreUrls = [...(config.tracing?.ignoreUrls ?? []), new RegExp(escapeRegex(config.endpoint))];
        const propagateTraceHeaderCorsUrls = config.tracing?.propagateToOrigins ?? [];

        // Install NetworkLogger before OTel so OTel wraps our wrapped fetch
        if (config.tracing?.logRequests !== false && ingestBuffer) {
            this.networkLogger = new NetworkLogger(ingestBuffer, config);
        }

        registerInstrumentations({
            tracerProvider: this.provider,
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

        this.tracer = this.provider.getTracer('uxrr');
    }

    async shutdown(): Promise<void> {
        this.networkLogger?.restore();
        await this.provider.shutdown();
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
