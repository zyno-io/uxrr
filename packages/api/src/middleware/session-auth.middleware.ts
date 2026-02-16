import { HttpRequest, HttpResponse, HttpUnauthorizedError } from '@deepkit/http';
import { HttpMiddleware } from '@zyno-io/dk-server-foundation';
import { ScopedLogger } from '@deepkit/logger';

import { UxrrConfig } from '../config';
import { OidcService } from '../services/oidc.service';
import { ApiKeyService } from '../services/api-key.service';
import { UserService } from '../services/user.service';
import { JWTExpired } from 'jose/errors';

export const AUTH_CONTEXT_KEY = Symbol('authContext');

export interface AuthContext {
    type: 'oidc' | 'api-key' | 'embed-token';
    scope: 'admin' | 'readonly' | 'interactive';
    appIds?: string[];
    sessionId?: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
}

export function getAuthContext(request: HttpRequest): AuthContext {
    return (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY];
}

export class SessionAuthMiddleware extends HttpMiddleware {
    constructor(
        private readonly config: UxrrConfig,
        private readonly oidc: OidcService,
        private readonly apiKeySvc: ApiKeyService,
        private readonly userSvc: UserService,
        private readonly logger: ScopedLogger
    ) {
        super();
    }

    async handle(request: HttpRequest, _response: HttpResponse): Promise<void> {
        // 1. Try OIDC Bearer token
        const authHeader = request.headers['authorization'];
        if (authHeader) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
                if (this.oidc.isEnabled) {
                    let payload;
                    try {
                        payload = await this.oidc.validateToken(parts[1]);
                    } catch (err) {
                        if (!(err instanceof JWTExpired)) {
                            this.logger.warn('Invalid OIDC token', {
                                reason: err instanceof Error ? err.message : err
                            });
                        }
                        // Fall through to other auth methods if token is expired or invalid
                    }

                    if (payload) {
                        const user = await this.userSvc.upsertFromOidc(payload);
                        (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
                            type: 'oidc',
                            scope: user.isAdmin ? 'admin' : 'readonly',
                            userId: user.id,
                            userName: user.name,
                            userEmail: user.email
                        } satisfies AuthContext;
                        return;
                    }
                }
            }
        }

        // 2. Try X-API-Key header (direct API key)
        const apiKey = request.headers['x-api-key'] as string | undefined;
        if (apiKey) {
            const ctx = await this.apiKeySvc.resolveApiKey(apiKey);
            if (ctx) {
                (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
                    type: 'api-key',
                    scope: ctx.scope,
                    appIds: ctx.appIds.length > 0 ? ctx.appIds : undefined
                } satisfies AuthContext;
                return;
            }
        }

        // 3. Try X-Embed-Token header (signed embed token)
        const embedToken = request.headers['x-embed-token'] as string | undefined;
        if (embedToken) {
            try {
                const payload = await this.apiKeySvc.verifyEmbedToken(embedToken);
                (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
                    type: 'embed-token',
                    scope: payload.scope,
                    appIds: payload.apps.length > 0 ? payload.apps : undefined,
                    sessionId: payload.sid
                } satisfies AuthContext;
                return;
            } catch {
                // Fall through
            }
        }

        // 4. If OIDC is not enabled, allow through only if dev mode is explicitly enabled
        if (!this.oidc.isEnabled && this.config.UXRR_DEV_MODE && process.env.NODE_ENV !== 'production') {
            (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
                type: 'oidc',
                scope: 'admin'
            } satisfies AuthContext;
            return;
        }

        throw new HttpUnauthorizedError('Authentication required');
    }
}
