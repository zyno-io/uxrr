import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span } from '@opentelemetry/sdk-trace-base';
import { IdentitySpanProcessor } from '../tracing/span-processor';
import type { IdentityManager } from '../identity';

function makeIdentity(attrs: Record<string, string> = {}) {
    return {
        toSpanAttributes: vi.fn(() => ({
            'uxrr.device_id': 'dev-1',
            'uxrr.user_id': 'user-1',
            ...attrs
        }))
    } as unknown as IdentityManager;
}

function makeDelegate() {
    return {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(async () => {}),
        forceFlush: vi.fn(async () => {})
    };
}

function makeSpan() {
    const attributes: Record<string, string> = {};
    return {
        setAttribute: vi.fn((key: string, value: string) => {
            attributes[key] = value;
        }),
        _attributes: attributes
    } as unknown as Span;
}

describe('IdentitySpanProcessor', () => {
    it('sets identity attributes on span start', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        const span = makeSpan();
        const ctx = {} as unknown as Context;
        processor.onStart(span, ctx);

        expect(span.setAttribute).toHaveBeenCalledWith('uxrr.device_id', 'dev-1');
        expect(span.setAttribute).toHaveBeenCalledWith('uxrr.user_id', 'user-1');
    });

    it('sets sessionId attribute', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-42');

        const span = makeSpan();
        processor.onStart(span, {} as unknown as Context);

        expect(span.setAttribute).toHaveBeenCalledWith('uxrr.sid', 'sess-42');
    });

    it('applies custom attributes when provided', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const customAttrs = vi.fn(() => ({ 'custom.org': 'acme', 'custom.env': 'prod' }));
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1', customAttrs);

        const span = makeSpan();
        processor.onStart(span, {} as unknown as Context);

        expect(customAttrs).toHaveBeenCalled();
        expect(span.setAttribute).toHaveBeenCalledWith('custom.org', 'acme');
        expect(span.setAttribute).toHaveBeenCalledWith('custom.env', 'prod');
    });

    it('does not call custom attributes when not provided', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        const span = makeSpan();
        // Should not throw
        processor.onStart(span, {} as unknown as Context);
        // 3 calls: device_id, user_id, sid
        expect(span.setAttribute).toHaveBeenCalledTimes(3);
    });

    it('delegates onStart to delegate processor', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        const span = makeSpan();
        const ctx = {} as unknown as Context;
        processor.onStart(span, ctx);

        expect(delegate.onStart).toHaveBeenCalledWith(span, ctx);
    });

    it('delegates onEnd to delegate processor', () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        const readableSpan = {} as unknown as ReadableSpan;
        processor.onEnd(readableSpan);

        expect(delegate.onEnd).toHaveBeenCalledWith(readableSpan);
    });

    it('delegates shutdown to delegate processor', async () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        await processor.shutdown();
        expect(delegate.shutdown).toHaveBeenCalled();
    });

    it('delegates forceFlush to delegate processor', async () => {
        const delegate = makeDelegate();
        const identity = makeIdentity();
        const processor = new IdentitySpanProcessor(delegate, identity, 'sess-1');

        await processor.forceFlush();
        expect(delegate.forceFlush).toHaveBeenCalled();
    });
});
