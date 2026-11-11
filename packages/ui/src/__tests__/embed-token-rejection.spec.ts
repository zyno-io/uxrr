import { OpenApiError } from '@zyno-io/openapi-client-codegen';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({}) as { onError?: (err: unknown) => unknown });

vi.mock('@zyno-io/vue-foundation', () => ({
    configureVfOpenApiClient: vi.fn((_client: unknown, options: { onError: (err: unknown) => unknown }) => {
        captured.onError = options.onError;
    })
}));
vi.mock('../openapi-client-generated/client.gen', () => ({ client: { setConfig: vi.fn() } }));
vi.mock('../logger', () => ({ createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }) }));

import { captureEmbedToken, embedState } from '../embed';
import { isEmbedTokenRejection } from '../openapi-client';

const tokenWith = (claims: Record<string, unknown>) =>
    `${btoa(JSON.stringify({ scope: 'readonly', apps: ['app-1'], ...claims })).replace(/=+$/, '')}.sig`;
const TOKEN = tokenWith({ exp: Math.floor(Date.now() / 1000) + 3600 });

function apiError(status: number, message: string): OpenApiError {
    return new OpenApiError(message, undefined, new Response(null, { status }), { message });
}

describe('isEmbedTokenRejection', () => {
    it('recognises the API messages for a dead or mis-scoped embed token', () => {
        expect(isEmbedTokenRejection({ body: { message: 'Embed token has expired' } })).toBe(true);
        expect(isEmbedTokenRejection({ body: { message: 'Invalid embed token' } })).toBe(true);
        expect(isEmbedTokenRejection({ body: { message: 'Invalid embed token scope' } })).toBe(true);
        expect(isEmbedTokenRejection({ body: '{"message":"Token scope exceeds key scope"}' })).toBe(true);
        expect(isEmbedTokenRejection({ message: 'Token app not allowed for this key' })).toBe(true);
        expect(isEmbedTokenRejection({ message: 'API key not found or inactive' })).toBe(true);
        expect(isEmbedTokenRejection({ body: { message: 'Embed token has no expiry' } })).toBe(true);
        expect(isEmbedTokenRejection({ body: { message: 'Embed token lifetime exceeds the allowed maximum' } })).toBe(true);
    });

    it('does not treat an app or session scope denial as a dead token', () => {
        expect(isEmbedTokenRejection({ body: { message: 'Access denied for this app' } })).toBe(false);
        expect(isEmbedTokenRejection({ body: { message: 'Access denied for this session' } })).toBe(false);
        expect(isEmbedTokenRejection({ body: undefined, message: 'Forbidden' })).toBe(false);
        expect(isEmbedTokenRejection(null)).toBe(false);
    });
});

describe('API error handling in embed mode', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/embed');
        captureEmbedToken(TOKEN);
    });

    it('an app-scope 403 keeps the token', () => {
        captured.onError!(apiError(403, 'Access denied for this app'));
        expect(embedState.token).toBe(TOKEN);
        expect((window.history.state as Record<string, unknown>).uxrrEmbedToken).toBe(TOKEN);
    });

    it('a dead-token 403 clears memory and the history copy', () => {
        captured.onError!(apiError(403, 'Embed token has expired'));
        expect(embedState.token).toBeNull();
        expect((window.history.state as Record<string, unknown> | null)?.uxrrEmbedToken).toBeUndefined();
    });

    it('a 401 before the token’s expiry keeps it (another API pod may not know a new key yet)', () => {
        captured.onError!(apiError(401, 'Authentication required'));
        expect(embedState.token).toBe(TOKEN);
        expect((window.history.state as Record<string, unknown>).uxrrEmbedToken).toBe(TOKEN);
    });

    it('a 401 for an expired token, or one with no expiry, clears it', () => {
        captureEmbedToken(tokenWith({ exp: Math.floor(Date.now() / 1000) - 5 }));
        captured.onError!(apiError(401, 'Authentication required'));
        expect(embedState.token).toBeNull();
        expect((window.history.state as Record<string, unknown> | null)?.uxrrEmbedToken).toBeUndefined();

        captureEmbedToken(tokenWith({}));
        captured.onError!(apiError(401, 'Authentication required'));
        expect(embedState.token).toBeNull();
    });

    it('other failures keep the token', () => {
        captured.onError!(apiError(500, 'Internal Server Error'));
        captured.onError!(apiError(404, 'Session not found'));
        expect(embedState.token).toBe(TOKEN);
    });
});
