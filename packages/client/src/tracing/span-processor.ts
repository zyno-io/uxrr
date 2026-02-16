import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

import type { IdentityManager } from '../identity';

export class IdentitySpanProcessor implements SpanProcessor {
    constructor(
        private readonly delegate: SpanProcessor,
        private readonly identity: IdentityManager,
        private readonly sessionId: string,
        private readonly customAttributes?: () => Record<string, string>
    ) {}

    onStart(span: Span, parentContext: Context): void {
        const attrs = this.identity.toSpanAttributes();
        for (const [key, value] of Object.entries(attrs)) {
            span.setAttribute(key, value);
        }
        span.setAttribute('uxrr.sid', this.sessionId);
        if (this.customAttributes) {
            for (const [key, value] of Object.entries(this.customAttributes())) {
                span.setAttribute(key, value);
            }
        }
        this.delegate.onStart(span, parentContext);
    }

    onEnd(span: ReadableSpan): void {
        this.delegate.onEnd(span);
    }

    shutdown(): Promise<void> {
        return this.delegate.shutdown();
    }

    forceFlush(): Promise<void> {
        return this.delegate.forceFlush();
    }
}
