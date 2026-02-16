import { reactive } from 'vue';

import { createLogger } from './logger';

const log = createLogger('embed');

export interface EmbedState {
    active: boolean;
    token: string | null;
    scope: 'readonly' | 'interactive' | null;
    appIds: string[];
    sessionId: string | null;
}

export const embedState = reactive<EmbedState>({
    active: false,
    token: null,
    scope: null,
    appIds: [],
    sessionId: null
});

export function initEmbed(): boolean {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
        log.warn('embed init called but no token found in URL');
        return false;
    }

    // Decode payload from token (base64url JSON before the dot)
    try {
        const dotIdx = token.indexOf('.');
        if (dotIdx < 0) return false;
        const payloadB64 = token.slice(0, dotIdx);
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        embedState.active = true;
        embedState.token = token;
        embedState.scope = payload.scope ?? 'readonly';
        embedState.appIds = payload.apps ?? [];
        embedState.sessionId = payload.sid ?? null;
        log.log(
            'embed initialized, scope:',
            embedState.scope,
            'appIds:',
            embedState.appIds,
            'sessionId:',
            embedState.sessionId
        );

        // Strip token from URL to prevent leakage via history/referrer/logs
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', url.toString());
    } catch (err) {
        log.warn('failed to decode embed token payload:', err);
        return false;
    }

    return true;
}

export function getEmbedToken(): string | null {
    return embedState.token;
}
