import { reactive } from 'vue';

import { createLogger } from './logger';

const log = createLogger('embed');

/**
 * The embed bearer token arrives as `?token=` on the iframe URL (still accepted exactly as before).
 * It is then kept in memory (embedState) and, so a reload or Back/Forward inside the iframe keeps
 * working once the URL no longer carries it, in this frame's own history entry (`history.state`).
 * It is never put in sessionStorage/localStorage (shared by every uxrr iframe in the tab, so one
 * embed could pick up another's token) and never stays in the address bar, history URLs or links.
 */
const STATE_KEY = 'uxrrEmbedToken';

export interface EmbedState {
    active: boolean;
    token: string | null;
    scope: 'readonly' | 'interactive' | null;
    appKeys: string[];
    sessionId: string | null;
    /** The token's own expiry (Unix seconds), null when it has none the server would accept. */
    expiresAt: number | null;
    /** The server rejected the token (expired, revoked, invalid). */
    rejected: boolean;
}

export const embedState = reactive<EmbedState>({
    active: false,
    token: null,
    scope: null,
    appKeys: [],
    sessionId: null,
    expiresAt: null,
    rejected: false
});

function readStateToken(): string | null {
    const value = (window.history.state as Record<string, unknown> | null)?.[STATE_KEY];
    return typeof value === 'string' && value ? value : null;
}

/** Copy the token into the current history entry (URL untouched). */
export function stampEmbedToken(): void {
    const token = embedState.token;
    if (!token || readStateToken() === token) return;
    try {
        window.history.replaceState({ ...window.history.state, [STATE_KEY]: token }, '');
    } catch {
        // history may be unavailable; memory still works
    }
}

function clearStateToken(): void {
    const state = window.history.state as Record<string, unknown> | null;
    if (!state || !(STATE_KEY in state)) return;
    const { [STATE_KEY]: _dropped, ...rest } = state;
    try {
        window.history.replaceState(rest, '');
    } catch {
        // ignore
    }
}

/**
 * The server rejected the token: forget it so the embed shows a notice instead of retrying it. This
 * clears memory and the current history entry only; older entries of this frame cannot be rewritten
 * and keep a copy of a token the server already rejects.
 */
export function rejectEmbedToken(): void {
    if (!embedState.token) return;
    log.warn('embed token rejected by the server, discarding it');
    embedState.token = null;
    embedState.rejected = true;
    clearStateToken();
}

/**
 * A 401 for the embed token. Discard it only when it can no longer be valid (expired, or no usable
 * expiry). Otherwise the refusal may be transient (another API pod has not loaded a new or re-scoped
 * key yet, for up to a minute), so keep it and let the caller retry. Returns true when discarded.
 */
export function handleEmbedUnauthorized(): boolean {
    const exp = embedState.expiresAt;
    if (exp === null || exp * 1000 <= Date.now()) {
        rejectEmbedToken();
        return true;
    }
    log.warn('embed token refused before its expiry, keeping it and retrying');
    return false;
}

/** Decode the token's payload (base64url JSON before the dot) into embedState. False when malformed. */
function applyToken(token: string): boolean {
    try {
        const dotIdx = token.indexOf('.');
        if (dotIdx < 0) return false;
        const payloadB64 = token.slice(0, dotIdx);
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload || typeof payload !== 'object') return false;
        embedState.active = true;
        embedState.token = token;
        embedState.rejected = false;
        embedState.scope = payload.scope ?? 'readonly';
        embedState.appKeys = Array.isArray(payload.apps) ? payload.apps : [];
        embedState.sessionId = payload.sid ?? null;
        embedState.expiresAt = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
        log.log('embed initialized, scope:', embedState.scope, 'appKeys:', embedState.appKeys, 'sessionId:', embedState.sessionId);
        return true;
    } catch (err) {
        log.warn('failed to decode embed token payload:', err instanceof Error ? err.message : 'invalid token');
        return false;
    }
}

/** Take a token that arrived in the URL. Returns false (and keeps nothing new) when it does not decode. */
export function captureEmbedToken(token: string): boolean {
    if (!applyToken(token)) return false;
    stampEmbedToken();
    return true;
}

/**
 * Initialise embed mode: the URL's `?token=` wins (and a malformed one never falls back to the copy
 * in the history entry), then the copy in this frame's history entry (reload, Back/Forward).
 */
export function initEmbed(): boolean {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
        // Strip it right away; the router guard also strips it from the route it resolves
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', url.toString());
        if (captureEmbedToken(urlToken)) return true;
        clearStateToken();
        return false;
    }

    const stored = readStateToken();
    if (!stored) {
        log.warn('embed init called but no token found in the URL or this history entry');
        return false;
    }
    if (applyToken(stored)) return true;
    clearStateToken();
    return false;
}

export function getEmbedToken(): string | null {
    return embedState.token;
}
