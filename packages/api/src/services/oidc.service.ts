import { ScopedLogger } from '@deepkit/logger';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { UxrrConfig } from '../config';
import { memoize } from 'lodash';

export class OidcService {
    private jwks?: JWTVerifyGetKey;
    private discoveryUrl?: string;
    private issuer?: string;
    private audience?: string;

    constructor(
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger
    ) {
        if (config.OIDC_ISSUER_URL) {
            if (!config.OIDC_CLIENT_ID) {
                throw new Error('OIDC_CLIENT_ID is required when OIDC_ISSUER_URL is set');
            }
            this.discoveryUrl = this.normalizeIssuer(config.OIDC_ISSUER_URL);
            this.issuer = config.OIDC_ISSUER ? config.OIDC_ISSUER : this.discoveryUrl;
            this.audience = config.OIDC_AUDIENCE ?? config.OIDC_CLIENT_ID;
            this.logger.info(
                `OIDC auth enabled — discovery: ${this.discoveryUrl}, issuer: ${this.issuer}, audience: ${this.audience}`
            );
        } else {
            this.logger.info('OIDC auth not configured; session routes are unprotected');
        }
    }

    get isEnabled(): boolean {
        return !!this.discoveryUrl;
    }

    async validateToken(token: string): Promise<JWTPayload> {
        await this.ensureInitialized();

        if (!this.jwks) {
            throw new Error('OIDC not initialized');
        }

        const options: { issuer?: string; audience?: string } = {};
        if (this.issuer) options.issuer = this.issuer;
        if (this.audience) options.audience = this.audience;

        const { payload } = await jwtVerify(token, this.jwks, options);
        return payload;
    }

    private ensureInitialized = memoize(async () => {
        if (this.jwks) return;
        if (!this.discoveryUrl) return;

        const discoveryUrl = `${this.discoveryUrl}/.well-known/openid-configuration`;
        try {
            const response = await fetch(discoveryUrl);
            if (!response.ok) {
                throw new Error(`OIDC discovery failed: HTTP ${response.status}`);
            }
            const config = (await response.json()) as { jwks_uri?: string };
            if (!config.jwks_uri) {
                throw new Error('OIDC discovery response missing jwks_uri');
            }
            this.jwks = createRemoteJWKSet(new URL(config.jwks_uri));
            this.logger.info(`OIDC JWKS endpoint: ${config.jwks_uri}`);
        } catch (err) {
            this.logger.error('Failed to fetch OIDC discovery document', err);
            throw err;
        }
    });

    private normalizeIssuer(url: string): string {
        return url.endsWith('/') ? url.slice(0, -1) : url;
    }
}
