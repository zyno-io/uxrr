import { getAccessToken } from './auth';

export async function fetchWsToken(): Promise<string> {
    const accessToken = getAccessToken();
    const headers: Record<string, string> = {};
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch('/v1/auth/ws-token', {
        method: 'POST',
        headers
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch WS token: ${response.status}`);
    }

    const body: { token: string } = await response.json();
    return body.token;
}

/** The embed token was refused (401): the caller decides whether it is dead (see handleEmbedUnauthorized). */
export class EmbedTokenRejectedError extends Error {
    constructor(status: number) {
        super(`Embed token rejected: ${status}`);
        this.name = 'EmbedTokenRejectedError';
    }
}

/**
 * Exchange the embed token (sent as a header, never in a URL) for a short-lived WebSocket ticket.
 * Resolves null when the server can't mint one (an older API, or UXRR_SHARE_SECRET not configured):
 * the caller then connects with `?embed_token=` as before. Rejects with EmbedTokenRejectedError on a
 * 401, and with a plain error on a network failure or a transient status such
 * as 502/503 (retry later rather than put the token in a URL).
 */
export async function fetchEmbedWsTicket(embedToken: string): Promise<string | null> {
    const response = await fetch('/v1/auth/ws-token', {
        method: 'POST',
        headers: { 'X-Embed-Token': embedToken }
    });

    if (response.status === 401) {
        throw new EmbedTokenRejectedError(response.status);
    }
    // 404/405: no such endpoint; 500: an older API without UXRR_SHARE_SECRET; 501: this API without it
    // or with claims it cannot carry; 403: never sent by the API here (a proxy or WAF), so not a dead token
    if ([403, 404, 405, 500, 501].includes(response.status)) return null;
    if (!response.ok) throw new Error(`Failed to fetch embed WS ticket: ${response.status}`);

    const body: { token?: unknown; kind?: unknown } | null = await response.json().catch(() => null);
    // An older API answers with a plain user ws token that carries none of the embed restrictions
    if (body?.kind !== 'embed' || typeof body.token !== 'string') return null;
    return body.token;
}
