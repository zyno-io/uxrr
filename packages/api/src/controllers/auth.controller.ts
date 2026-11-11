import { http, HttpError, HttpRequest, HttpInternalServerError } from '@zyno-io/ts-server-foundation';

import { UxrrConfig } from '../config';
import { SessionAuthMiddleware } from '../middleware/session-auth.middleware';
import { getAuthContext } from '../middleware/session-auth.middleware';
import { signEmbedWsTicket, signWsToken, type WsTokenPayload } from '../util/ws-token';

const WS_TOKEN_TTL_SECS = 10;

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

interface WsTokenResponse {
    token: string;
    /** Set when the token is an embed ticket (minted from X-Embed-Token) carrying the embed token's restrictions. */
    kind?: 'embed';
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
    getWsToken(request: HttpRequest): WsTokenResponse {
        const ctx = getAuthContext(request);
        const isEmbed = ctx.type === 'embed-token';

        if (!this.config.UXRR_SHARE_SECRET) {
            // Embed clients detect this (like a 404 from an older server) and fall back to ?embed_token=
            if (isEmbed) throw new HttpError(501, 'WebSocket tickets are unavailable: UXRR_SHARE_SECRET is not configured');
            throw new HttpInternalServerError('UXRR_SHARE_SECRET is not configured');
        }

        const exp = Math.floor(Date.now() / 1000) + WS_TOKEN_TTL_SECS;

        // Embed tokens and app-scoped API keys get a ticket that carries their app, session and scope
        // restrictions; a plain ws token carries none.
        if (isEmbed || ctx.appKeys) {
            const apps = ctx.appKeys ?? [];
            const sid = ctx.sessionId ?? undefined;
            const claimsValid =
                Array.isArray(apps) &&
                apps.every(app => typeof app === 'string') &&
                (sid === undefined || (typeof sid === 'string' && sid.length > 0)) &&
                (ctx.expiresAt === undefined || (typeof ctx.expiresAt === 'number' && Number.isFinite(ctx.expiresAt)));
            if (!claimsValid) {
                // Never mint a ticket that drops a restriction or cannot verify; the client falls back to ?embed_token=
                throw new HttpError(501, 'A WebSocket ticket cannot be issued for these credentials');
            }

            const token = signEmbedWsTicket(this.config.UXRR_SHARE_SECRET, {
                exp: Math.min(exp, ctx.expiresAt ?? exp),
                scope: isEmbed && ctx.scope === 'interactive' ? 'interactive' : 'readonly',
                apps,
                sid
            });
            return isEmbed ? { token, kind: 'embed' } : { token };
        }

        const payload: WsTokenPayload = {
            exp,
            scope: ctx.scope === 'admin' ? 'admin' : 'readonly',
            userId: ctx.userId
        };

        return { token: signWsToken(this.config.UXRR_SHARE_SECRET, payload) };
    }
}
