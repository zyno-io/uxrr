import { createHmac, timingSafeEqual } from 'crypto';

export interface WsTokenPayload {
    exp: number;
    scope: 'admin' | 'readonly';
    userId?: string;
}

export function signWsToken(secret: string, payload: WsTokenPayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', Buffer.from(secret, 'utf-8')).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

export function verifyWsToken(secret: string, token: string): WsTokenPayload | null {
    const dotIdx = token.indexOf('.');
    if (dotIdx < 0) return null;

    const payloadB64 = token.slice(0, dotIdx);
    const sigB64 = token.slice(dotIdx + 1);

    const expectedSig = createHmac('sha256', Buffer.from(secret, 'utf-8')).update(payloadB64).digest('base64url');

    if (sigB64.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
        return null;
    }

    let payload: WsTokenPayload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    } catch {
        return null;
    }

    if (payload.exp * 1000 < Date.now()) {
        return null;
    }

    return payload;
}
