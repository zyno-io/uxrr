import { http, HttpRequest, HttpInternalServerError } from '@deepkit/http';

import { UxrrConfig } from '../config';
import { SessionAuthMiddleware } from '../middleware/session-auth.middleware';
import { getAuthContext } from '../middleware/session-auth.middleware';
import { signWsToken, type WsTokenPayload } from '../util/ws-token';

interface OidcConfig {
    issuerUrl: string;
    clientId: string;
    scopes: string;
}

interface GrafanaConfig {
    baseUrl: string;
    datasource: string;
}

interface AuthConfigResponse {
    oidc: OidcConfig | null;
    grafana: GrafanaConfig | null;
}

interface MeResponse {
    userId: string | undefined;
    userName: string | undefined;
    userEmail: string | undefined;
    scope: string;
    isAdmin: boolean;
}

@http.controller('v1/auth')
export class AuthController {
    constructor(private readonly config: UxrrConfig) {}

    @http.GET('config')
    getConfig(): AuthConfigResponse {
        const oidc = this.config.OIDC_ISSUER_URL
            ? {
                  issuerUrl: this.config.OIDC_ISSUER_URL,
                  clientId: this.config.OIDC_CLIENT_ID ?? '',
                  scopes: this.config.OIDC_SCOPES
              }
            : null;

        const grafana = this.config.GRAFANA_URL
            ? {
                  baseUrl: this.config.GRAFANA_URL.replace(/\/+$/, ''),
                  datasource: this.config.GRAFANA_DATASOURCE
              }
            : null;

        return { oidc, grafana };
    }

    @http.GET('me')
    @http.middleware(SessionAuthMiddleware)
    getMe(request: HttpRequest): MeResponse {
        const ctx = getAuthContext(request);
        return {
            userId: ctx.userId,
            userName: ctx.userName,
            userEmail: ctx.userEmail,
            scope: ctx.scope,
            isAdmin: ctx.scope === 'admin'
        };
    }

    @http.POST('ws-token')
    @http.middleware(SessionAuthMiddleware)
    getWsToken(request: HttpRequest): { token: string } {
        if (!this.config.UXRR_SHARE_SECRET) {
            throw new HttpInternalServerError('UXRR_SHARE_SECRET is not configured');
        }

        const ctx = getAuthContext(request);
        const payload: WsTokenPayload = {
            exp: Math.floor(Date.now() / 1000) + 10,
            scope: ctx.scope === 'admin' ? 'admin' : 'readonly',
            userId: ctx.userId
        };

        return { token: signWsToken(this.config.UXRR_SHARE_SECRET, payload) };
    }
}
