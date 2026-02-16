import { configureVfOpenApiClient } from '@zyno-io/vue-foundation';
import { OpenApiError } from '@zyno-io/openapi-client-codegen';
import type { OpenApiClient } from '@zyno-io/openapi-client-codegen';

import { authState, getAccessToken, handleUnauthorized } from './auth';
import { getEmbedToken } from './embed';
import { createLogger } from './logger';
import { client } from './openapi-client-generated/client.gen';

const log = createLogger('api');

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
        if (authState.oidcEnabled && !getEmbedToken() && err instanceof OpenApiError && err.response.status === 401) {
            log.warn('intercepted 401 response, triggering re-auth');
            handleUnauthorized();
            return null;
        }
    }
});
