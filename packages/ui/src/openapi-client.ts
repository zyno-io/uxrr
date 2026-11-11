import type { OpenApiClient } from '@zyno-io/openapi-client-codegen';

import { OpenApiError } from '@zyno-io/openapi-client-codegen';
import { configureVfOpenApiClient } from '@zyno-io/vue-foundation';

import { authState, getAccessToken, handleUnauthorized } from './auth';
import { getEmbedToken, handleEmbedUnauthorized, rejectEmbedToken } from './embed';
import { createLogger } from './logger';
import { client } from './openapi-client-generated/client.gen';

const log = createLogger('api');

// The API answers 403 both for a dead embed token and for an app or session outside the token's scope
// ("Access denied for this app"). Only the first means the token is unusable.
const EMBED_TOKEN_REJECTION = /embed token|token scope|token app|api key not found/i;

export function isEmbedTokenRejection(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { body?: unknown; message?: unknown };
    const body = e.body && typeof e.body === 'object' ? (e.body as { message?: unknown }).message : e.body;
    return [body, e.message].some(v => typeof v === 'string' && EMBED_TOKEN_REJECTION.test(v));
}

client.setConfig({
    baseUrl: ''
});

log.log('openapi client configured');

configureVfOpenApiClient(client as unknown as OpenApiClient, {
    headers() {
        const embedToken = getEmbedToken();
        if (embedToken) return { 'X-Embed-Token': embedToken };
        const token = getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    },

    onError(err) {
        const status = err instanceof OpenApiError ? err.response?.status : undefined;
        const embedMode = !!getEmbedToken();
        // In embed mode the embed token is the only credential sent: a 401 is about it, but may be transient
        if (embedMode && status === 401) handleEmbedUnauthorized();
        else if (embedMode && status === 403 && isEmbedTokenRejection(err)) rejectEmbedToken();
        if (authState.oidcEnabled && !embedMode && err instanceof OpenApiError && err.response?.status === 401) {
            log.warn('intercepted 401 response, triggering re-auth');
            handleUnauthorized();
            return null;
        }
    }
});
