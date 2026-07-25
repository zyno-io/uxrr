import { context, propagation, trace } from '@opentelemetry/api';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IdentityManager } from '../identity';
import { createTracingProvider, type TracingProvider } from '../tracing/provider';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

let provider: TracingProvider | undefined;
let originalFetch: typeof globalThis.fetch;
let seenHeaders: Headers[];

function stubFetch(): void {
    // Installed before the instrumentation so OTel patches *this* — whatever it hands us is exactly
    // what would have gone out on the wire.
    seenHeaders = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        seenHeaders.push(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch;
}

describe('createTracingProvider without a transport', () => {
    beforeEach(() => {
        originalFetch = globalThis.fetch;
        stubFetch();
    });

    afterEach(async () => {
        await provider?.shutdown();
        provider = undefined;
        globalThis.fetch = originalFetch;
        trace.disable();
        context.disable();
        propagation.disable();
    });

    it('still propagates a sampled traceparent to matching origins', async () => {
        provider = await createTracingProvider(undefined, new IdentityManager(), 'session-1', {
            appKey: 'app-1',
            tracing: { logRequests: false, propagateToOrigins: [/example\.com/] }
        });

        await fetch('https://example.com/api/thing');

        expect(seenHeaders).toHaveLength(1);
        // Sampled (`-01`) on purpose: we aren't exporting, but the backend should still record its
        // own side of the trace so the ID is worth something.
        expect(seenHeaders[0]!.get('traceparent')).toMatch(TRACEPARENT);
    });

    it('does not treat a missing endpoint as an ignore-everything pattern', async () => {
        provider = await createTracingProvider(undefined, new IdentityManager(), 'session-1', {
            appKey: 'app-1',
            endpoint: undefined,
            tracing: { logRequests: false, propagateToOrigins: [/example\.com/], ignoreUrls: [/ignored\.example\.com/] }
        });

        await fetch('https://ignored.example.com/skip');
        await fetch('https://example.com/traced');

        expect(seenHeaders[0]!.get('traceparent')).toBeNull();
        expect(seenHeaders[1]!.get('traceparent')).toMatch(TRACEPARENT);
    });
});
