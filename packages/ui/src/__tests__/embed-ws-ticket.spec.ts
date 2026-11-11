// Embed WebSockets authenticate with a short-lived ticket (ws_token) fetched with the embed token in a
// header; they fall back to the old ?embed_token= form only when the server cannot mint tickets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({ createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }) }));

import { captureEmbedToken, embedState } from '../embed';
import { connectEmbedLiveSession, type LiveStreamCallbacks } from '../live-stream';
import { connectEmbedSessionListStream } from '../session-list-stream';

const tokenWith = (claims: Record<string, unknown>) =>
    `${btoa(JSON.stringify({ scope: 'interactive', apps: ['app-1'], ...claims })).replace(/=+$/, '')}.long-lived-signature`;
const TOKEN = tokenWith({ exp: Math.floor(Date.now() / 1000) + 3600 });
const EXPIRED_TOKEN = tokenWith({ exp: Math.floor(Date.now() / 1000) - 5 });

class FakeWebSocket {
    static OPEN = 1;
    static urls: string[] = [];
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: ((e: { code: number; reason: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(public url: string) {
        FakeWebSocket.urls.push(url);
        FakeWebSocket.instances.push(this);
    }
    send() {}
    close() {}
}

const noop = () => {};
const liveCallbacks = new Proxy({}, { get: () => noop }) as unknown as LiveStreamCallbacks;
const listCallbacks = { onSessionCreated: noop, onSessionUpdated: noop, onSessionLiveStatus: noop };

function mockFetch(respond: () => Response | Promise<Response>) {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => respond());
    vi.stubGlobal('fetch', fn);
    return fn;
}

async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
}

function connectBoth() {
    const live = connectEmbedLiveSession('sess-1', TOKEN, 'interactive', liveCallbacks);
    const list = connectEmbedSessionListStream({ appKey: 'app-1' }, listCallbacks);
    return () => {
        live.disconnect();
        list.disconnect();
    };
}

describe('embed WebSocket authentication', () => {
    beforeEach(() => {
        FakeWebSocket.urls = [];
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        window.history.replaceState(null, '', '/embed');
        captureEmbedToken(TOKEN);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fetches a ticket with the token in a header and connects with ws_token, never the embed token', async () => {
        const fetchFn = mockFetch(() => Response.json({ token: 'short.ticket', kind: 'embed' }));
        const disconnect = connectBoth();
        await settle();

        expect(fetchFn).toHaveBeenCalledTimes(2);
        for (const [url, init] of fetchFn.mock.calls) {
            expect(url).toBe('/v1/auth/ws-token');
            expect(url).not.toContain('signature');
            expect((init!.headers as Record<string, string>)['X-Embed-Token']).toBe(TOKEN);
        }
        expect(FakeWebSocket.urls).toHaveLength(2);
        for (const url of FakeWebSocket.urls) {
            expect(url).toContain('ws_token=short.ticket');
            expect(url).not.toContain('embed_token');
            expect(url).not.toContain('signature');
        }
        expect(FakeWebSocket.urls[0]).toContain('/v1/sessions/sess-1/live?');
        expect(FakeWebSocket.urls[1]).toContain('/v1/sessions/watch?');
        disconnect();
    });

    it.each([
        ['404 (an API without ticket support)', () => new Response('Not found', { status: 404 })],
        ['501 (UXRR_SHARE_SECRET not configured)', () => new Response('{}', { status: 501 })],
        ['500 (an older API without UXRR_SHARE_SECRET)', () => new Response('{}', { status: 500 })],
        ['403 (never sent by the API here: a proxy or WAF)', () => new Response('Forbidden', { status: 403 })],
        ['an older API answering with a plain user ws token', () => Response.json({ token: 'user.ws.token' })]
    ])('falls back to ?embed_token= on %s', async (_label, respond) => {
        mockFetch(respond);
        const disconnect = connectBoth();
        await settle();

        expect(FakeWebSocket.urls).toHaveLength(2);
        for (const url of FakeWebSocket.urls) {
            expect(url).toContain(`embed_token=${encodeURIComponent(TOKEN)}`);
            expect(url).not.toContain('ws_token');
        }
        disconnect();
    });

    it('a transient 503 from a proxy retries later instead of putting the token in a URL', async () => {
        const fetchFn = mockFetch(() => new Response('', { status: 503 }));
        const disconnect = connectBoth();
        await settle();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(FakeWebSocket.urls).toHaveLength(0);
        expect(embedState.token).toBe(TOKEN);
        disconnect();
    });

    it('requests a fresh ticket on every reconnect', async () => {
        let n = 0;
        const fetchFn = mockFetch(() => Response.json({ token: `ticket-${++n}`, kind: 'embed' }));
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const live = connectEmbedLiveSession('sess-1', TOKEN, 'interactive', liveCallbacks);
        await settle();
        expect(FakeWebSocket.urls).toHaveLength(1);
        expect(FakeWebSocket.urls[0]).toContain('ws_token=ticket-1');

        // the socket drops: the reconnect (after a 1s backoff) fetches a new ticket
        FakeWebSocket.instances[0]!.onclose?.({ code: 1006, reason: '' });
        await new Promise(r => setTimeout(r, 1100));
        await settle();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(FakeWebSocket.urls).toHaveLength(2);
        expect(FakeWebSocket.urls[1]).toContain('ws_token=ticket-2');
        live.disconnect();
    });

    it('a 401 for an expired token discards it and opens no socket', async () => {
        captureEmbedToken(EXPIRED_TOKEN);
        mockFetch(() => new Response('{"message":"Authentication required"}', { status: 401 }));
        const live = connectEmbedLiveSession('sess-1', EXPIRED_TOKEN, 'interactive', liveCallbacks);
        const list = connectEmbedSessionListStream({ appKey: 'app-1' }, listCallbacks);
        await settle();
        expect(FakeWebSocket.urls).toHaveLength(0);
        expect(embedState.token).toBeNull();
        live.disconnect();
        list.disconnect();
    });

    it('a 401 before the token’s expiry keeps it and retries with backoff (transient, e.g. per-pod key cache)', async () => {
        let calls = 0;
        const fetchFn = mockFetch(() =>
            ++calls === 1
                ? new Response('{"message":"Authentication required"}', { status: 401 })
                : Response.json({ token: 'ticket-2', kind: 'embed' })
        );
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const live = connectEmbedLiveSession('sess-1', TOKEN, 'interactive', liveCallbacks);
        await settle();
        expect(FakeWebSocket.urls).toHaveLength(0);
        expect(embedState.token).toBe(TOKEN);

        await new Promise(r => setTimeout(r, 1100));
        await settle();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(FakeWebSocket.urls).toEqual([expect.stringContaining('ws_token=ticket-2')]);
        live.disconnect();
    });
});
