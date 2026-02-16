import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HttpTransport } from '../transport/http';

describe('HttpTransport', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('postJSON sends correct URL, headers, body', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        await transport.postJSON('data', { events: [] });

        expect(fetchSpy).toHaveBeenCalledWith(
            'http://localhost:3100/v1/ng/app-1/sess-1/data',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: [] })
            })
        );
    });

    it('postJSON includes AbortSignal.timeout(10000)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        await transport.postJSON('data', {});

        const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const init = call[1] as RequestInit;
        expect(init.signal).toBeDefined();
    });

    it('postJSON handles non-2xx responses', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', { status: 500 }));

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        const result = await transport.postJSON('data', {});

        expect(result.ok).toBe(false);
    });

    it('postJSON handles fetch errors', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        const result = await transport.postJSON('data', {});

        expect(result.ok).toBe(false);
    });

    it('postJSON returns ok:true when response has no JSON body', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        const result = await transport.postJSON('data', {});

        expect(result.ok).toBe(true);
    });

    it('sendBeacon calls navigator.sendBeacon with correct args', () => {
        const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

        const transport = new HttpTransport('http://localhost:3100', 'app-1', 'sess-1');
        const result = transport.sendBeacon('data', { events: [1] });

        expect(result).toBe(true);
        expect(beaconSpy).toHaveBeenCalledWith('http://localhost:3100/v1/ng/app-1/sess-1/data', expect.any(Blob));
    });

    it('getIngestUrl constructs correct path', () => {
        const transport = new HttpTransport('http://localhost:3100/', 'app-1', 'sess-1');

        expect(transport.getIngestUrl('data')).toBe('http://localhost:3100/v1/ng/app-1/sess-1/data');
    });

    it('strips trailing slash from endpoint', () => {
        const transport = new HttpTransport('http://localhost:3100/', 'app-1', 'sess-1');

        expect(transport.getIngestUrl('data')).toBe('http://localhost:3100/v1/ng/app-1/sess-1/data');
    });

    it('encodes appId with special characters in URL', () => {
        const transport = new HttpTransport('http://localhost:3100', '@zyno-io/zynosuite-spa', 'sess-1');

        expect(transport.getIngestUrl('data')).toBe(
            'http://localhost:3100/v1/ng/%40zyno-io%2Fzynosuite-spa/sess-1/data'
        );
    });
});
