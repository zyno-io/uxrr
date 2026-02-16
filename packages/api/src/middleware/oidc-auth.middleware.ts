import { HttpAccessDeniedError, HttpRequest, HttpResponse, HttpUnauthorizedError } from '@deepkit/http';
import { HttpMiddleware } from '@zyno-io/dk-server-foundation';
import { ScopedLogger } from '@deepkit/logger';
import type { JWTPayload } from 'jose';

import { UxrrConfig } from '../config';
import { OidcService } from '../services/oidc.service';
import { UserService } from '../services/user.service';
import { AUTH_CONTEXT_KEY, type AuthContext } from './session-auth.middleware';

export class OidcAuthMiddleware extends HttpMiddleware {
    constructor(
        private readonly config: UxrrConfig,
        private readonly oidc: OidcService,
        private readonly userSvc: UserService,
        private readonly logger: ScopedLogger
    ) {
        super();
    }

    async handle(request: HttpRequest, _response: HttpResponse): Promise<void> {
        // Dev mode bypass: allow admin access without OIDC
        if (!this.oidc.isEnabled) {
            if (this.config.UXRR_DEV_MODE && process.env.NODE_ENV !== 'production') {
                (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
                    type: 'oidc',
                    scope: 'admin'
                } satisfies AuthContext;
                return;
            }
            throw new HttpUnauthorizedError('OIDC authentication is required');
        }

        const authHeader = request.headers['authorization'];
        if (!authHeader) {
            throw new HttpUnauthorizedError('Missing Authorization header');
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
            throw new HttpUnauthorizedError('Invalid Authorization header format');
        }

        let payload: JWTPayload;
        try {
            payload = await this.oidc.validateToken(parts[1]);
        } catch (err) {
            this.logger.warn('OIDC token validation failed', { error: String(err) });
            throw new HttpUnauthorizedError('Invalid or expired token');
        }

        const user = await this.userSvc.upsertFromOidc(payload);
        if (!user.isAdmin) {
            throw new HttpAccessDeniedError('Admin access required');
        }

        (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT_KEY] = {
            type: 'oidc',
            scope: 'admin',
            userId: user.id,
            userName: user.name,
            userEmail: user.email
        } satisfies AuthContext;
    }
}
