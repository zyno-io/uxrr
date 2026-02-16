import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { SecurityHeadersListener } from '../src/middleware/security-headers.listener';

function makeEvent(headersSent = false) {
    const headers = new Map<string, string>();
    return {
        response: {
            headersSent,
            setHeader: mock.fn((key: string, value: string) => headers.set(key, value))
        },
        headers // expose for assertions
    };
}

describe('SecurityHeadersListener', () => {
    const listener = new SecurityHeadersListener();

    it('sets X-Content-Type-Options', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('X-Content-Type-Options'), 'nosniff');
    });

    it('sets X-Frame-Options', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('X-Frame-Options'), 'SAMEORIGIN');
    });

    it('sets Strict-Transport-Security', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
    });

    it('sets X-XSS-Protection to 0', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('X-XSS-Protection'), '0');
    });

    it('sets Referrer-Policy', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    });

    it('sets Content-Security-Policy', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('Content-Security-Policy'), "default-src 'none'");
    });

    it('sets Permissions-Policy', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
    });

    it('sets Cross-Origin-Opener-Policy', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    });

    it('does not set headers when headersSent is true', () => {
        const event = makeEvent(true);
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.size, 0);
    });

    it('sets all 8 expected headers', () => {
        const event = makeEvent();
        listener.onResponse(event as unknown as Parameters<typeof listener.onResponse>[0]);
        assert.equal(event.headers.size, 8);
    });
});
