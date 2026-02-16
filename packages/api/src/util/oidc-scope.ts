import type { JWTPayload } from 'jose';

import type { UxrrConfig } from '../config';

export function extractOidcScope(config: UxrrConfig, payload: JWTPayload): 'admin' | 'readonly' {
    if (config.OIDC_ADMIN_CLAIM && config.OIDC_ADMIN_VALUE) {
        const claimValue = payload[config.OIDC_ADMIN_CLAIM];
        const isAdmin = Array.isArray(claimValue)
            ? claimValue.includes(config.OIDC_ADMIN_VALUE)
            : claimValue === config.OIDC_ADMIN_VALUE;
        return isAdmin ? 'admin' : 'readonly';
    }
    return 'readonly';
}
