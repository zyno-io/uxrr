import { createHmac, timingSafeEqual } from 'crypto';

export interface WsTokenPayload {
    exp: number;
    scope: 'admin' | 'readonly';
    userId?: string;
}

/**
 * A short-lived WebSocket ticket minted from a verified embed token (or an app-scoped API key). It
 * carries exactly the claims the WebSocket service enforces for `?embed_token=`, so the long-lived
 * embed token never has to travel in a WebSocket URL.
 */
export interface EmbedWsTicketPayload {
    typ: 'embed';
    exp: number;
    scope: 'readonly' | 'interactive';
    apps: string[];
    sid?: string;
}

/**
 * Embed tickets are signed with a key derived from the shared secret, so they can never verify as a
 * user ws_token (which carries no app or session restriction) or as a share token, on this version
 * or an older one.
 */
function embedTicketKey(secret: string): Buffer {
    return createHmac('sha256', Buffer.from(secret, 'utf-8')).update('uxrr:embed-ws-ticket').digest();
}

function sign(key: Buffer, payload: object): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', key).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

function verify(key: Buffer, token: string): Record<string, unknown> | null {
    const dotIdx = token.indexOf('.');
    if (dotIdx < 0) return null;

    const payloadB64 = token.slice(0, dotIdx);
    const sigB64 = token.slice(dotIdx + 1);

    const expectedSig = createHmac('sha256', key).update(payloadB64).digest('base64url');

    if (sigB64.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
        return null;
    }

    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    } catch {
        return null;
    }

    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    if (typeof record.exp !== 'number' || record.exp * 1000 < Date.now()) {
        return null;
    }

    return record;
}

export function signWsToken(secret: string, payload: WsTokenPayload): string {
    return sign(Buffer.from(secret, 'utf-8'), payload);
}

export function verifyWsToken(secret: string, token: string): WsTokenPayload | null {
    const payload = verify(Buffer.from(secret, 'utf-8'), token);
    // Share tokens are signed with the same secret: only accept payloads that are ws tokens
    if (!payload || (payload.scope !== 'admin' && payload.scope !== 'readonly')) return null;
    return payload as unknown as WsTokenPayload;
}

export function signEmbedWsTicket(secret: string, payload: Omit<EmbedWsTicketPayload, 'typ'>): string {
    const full: EmbedWsTicketPayload = { typ: 'embed', ...payload };
    return sign(embedTicketKey(secret), full);
}

export function verifyEmbedWsTicket(secret: string, token: string): EmbedWsTicketPayload | null {
    const payload = verify(embedTicketKey(secret), token);
    if (!payload || payload.typ !== 'embed') return null;
    if (payload.scope !== 'readonly' && payload.scope !== 'interactive') return null;
    if (!Array.isArray(payload.apps) || !payload.apps.every(app => typeof app === 'string')) return null;
    if (payload.sid !== undefined && typeof payload.sid !== 'string') return null;
    return payload as unknown as EmbedWsTicketPayload;
}
