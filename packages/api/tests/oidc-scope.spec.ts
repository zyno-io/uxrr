import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { extractOidcScope } from '../src/util/oidc-scope';
import type { UxrrConfig } from '../src/config';
import type { JWTPayload } from 'jose';

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        OIDC_ADMIN_CLAIM: undefined,
        OIDC_ADMIN_VALUE: undefined,
        ...overrides
    } as UxrrConfig;
}

describe('extractOidcScope', () => {
    it('returns readonly when no admin claim/value configured', () => {
        const config = makeConfig();
        const payload: JWTPayload = { sub: 'user-1' };
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });

    it('returns admin when claim matches string value', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'role',
            OIDC_ADMIN_VALUE: 'admin'
        });
        const payload: JWTPayload = { sub: 'user-1', role: 'admin' };
        assert.equal(extractOidcScope(config, payload), 'admin');
    });

    it('returns readonly when claim does not match string value', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'role',
            OIDC_ADMIN_VALUE: 'admin'
        });
        const payload: JWTPayload = { sub: 'user-1', role: 'viewer' };
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });

    it('returns admin when claim is an array containing the admin value', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'groups',
            OIDC_ADMIN_VALUE: 'uxrr-admins'
        });
        const payload: JWTPayload = { sub: 'user-1', groups: ['users', 'uxrr-admins'] };
        assert.equal(extractOidcScope(config, payload), 'admin');
    });

    it('returns readonly when claim is an array not containing the admin value', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'groups',
            OIDC_ADMIN_VALUE: 'uxrr-admins'
        });
        const payload: JWTPayload = { sub: 'user-1', groups: ['users', 'readers'] };
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });

    it('returns readonly when claim is missing from payload', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'role',
            OIDC_ADMIN_VALUE: 'admin'
        });
        const payload: JWTPayload = { sub: 'user-1' };
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });

    it('returns readonly when only claim is set but value is not', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: 'role',
            OIDC_ADMIN_VALUE: undefined
        });
        const payload: JWTPayload = { sub: 'user-1', role: 'viewer' };
        // Both must be set for RBAC to be active; otherwise defaults to readonly
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });

    it('returns readonly when only value is set but claim is not', () => {
        const config = makeConfig({
            OIDC_ADMIN_CLAIM: undefined,
            OIDC_ADMIN_VALUE: 'admin'
        });
        const payload: JWTPayload = { sub: 'user-1' };
        assert.equal(extractOidcScope(config, payload), 'readonly');
    });
});
