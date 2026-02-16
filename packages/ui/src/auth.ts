import { reactive, ref, computed } from 'vue';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { MeResponse } from '@/openapi-client-generated';

import { createLogger } from './logger';

const log = createLogger('auth');

interface OidcConfig {
    issuerUrl: string;
    clientId: string;
    scopes: string;
}

export interface GrafanaConfig {
    baseUrl: string;
    datasource: string;
}

interface AuthConfigResponse {
    oidc: OidcConfig | null;
    grafana: GrafanaConfig | null;
}

export interface AuthState {
    initialized: boolean;
    oidcEnabled: boolean;
    user: User | null;
    error: string | null;
    me: MeResponse | null;
}

export const authState = reactive<AuthState>({
    initialized: false,
    oidcEnabled: false,
    user: null,
    error: null,
    me: null
});

export const isAdmin = computed(() => authState.me?.isAdmin === true);

export const grafanaConfig = ref<GrafanaConfig | null>(null);

let userManager: UserManager | null = null;
let freshLogin = false;

export async function initAuth(): Promise<void> {
    try {
        log.log('fetching auth config');
        const response = await fetch('/v1/auth/config');
        if (!response.ok) {
            throw new Error(`Auth config fetch failed: ${response.status}`);
        }

        const config: AuthConfigResponse = await response.json();
        log.log('auth config received, oidc:', !!config.oidc, 'grafana:', !!config.grafana);
        grafanaConfig.value = config.grafana ?? null;

        // Shared session and embed routes bypass OIDC entirely
        if (window.location.pathname.startsWith('/share/') || window.location.pathname.startsWith('/embed')) {
            log.log('bypassing OIDC for share/embed route');
            authState.initialized = true;
            return;
        }

        if (!config.oidc) {
            log.log('OIDC not configured, skipping auth');
            authState.oidcEnabled = false;
            await fetchMe();
            authState.initialized = true;
            return;
        }

        authState.oidcEnabled = true;
        userManager = createUserManager(config.oidc);
        log.log('OIDC user manager created, authority:', config.oidc.issuerUrl);

        userManager.events.addUserLoaded(user => {
            log.log('user loaded:', user.profile?.sub);
            authState.user = user;
        });

        userManager.events.addUserUnloaded(() => {
            log.log('user unloaded');
            authState.user = null;
        });

        userManager.events.addSilentRenewError(err => {
            log.error('silent renew failed:', err);
            authState.user = null;
        });

        if (isOidcCallback()) {
            log.log('handling OIDC callback');
            await handleCallback();
            return;
        }

        const existingUser = await userManager.getUser();
        if (existingUser && !existingUser.expired) {
            log.log('restored existing user session:', existingUser.profile?.sub);
            authState.user = existingUser;
            await fetchMe();
            authState.initialized = true;
            return;
        }

        log.log('no valid session found, redirecting to login');
        await login();
    } catch (err) {
        log.error('auth initialization failed:', err);
        authState.error = err instanceof Error ? err.message : String(err);
        authState.initialized = true;
    }
}

export function getAccessToken(): string | null {
    return authState.user?.access_token ?? null;
}

async function fetchMe(): Promise<void> {
    try {
        const headers: Record<string, string> = {};
        const token = getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const response = await fetch('/v1/auth/me', { headers });
        if (!response.ok) {
            throw new Error(`/me returned ${response.status}`);
        }
        authState.me = await response.json();
        log.log('fetched /me:', authState.me);
    } catch (err) {
        log.warn('failed to fetch /me:', err);
        authState.me = null;
    }
}

export async function login(): Promise<void> {
    if (!userManager) return;
    log.log('initiating login redirect');
    sessionStorage.setItem('uxrr:returnUrl', window.location.pathname + window.location.search);
    await userManager.signinRedirect();
}

export async function logout(): Promise<void> {
    if (!userManager) return;

    try {
        log.log('initiating logout redirect');
        await userManager.signoutRedirect();
    } catch {
        log.warn('signout redirect failed, falling back to manual cleanup');
        await userManager.removeUser();
        authState.user = null;
        window.location.href = '/';
    }
}

export async function handleUnauthorized(): Promise<void> {
    if (!userManager) return;
    if (authState.error) return;

    if (freshLogin) {
        freshLogin = false;
        log.error('server rejected token after fresh login — check OIDC configuration');
        authState.error = 'Server rejected the token. Check OIDC issuer and client ID configuration.';
        await userManager.removeUser();
        authState.user = null;
        return;
    }

    log.warn('received 401, clearing session and re-authenticating');
    await userManager.removeUser();
    authState.user = null;
    await login();
}

function createUserManager(config: OidcConfig): UserManager {
    const origin = window.location.origin;

    return new UserManager({
        authority: config.issuerUrl,
        client_id: config.clientId,
        redirect_uri: `${origin}/auth/callback`,
        post_logout_redirect_uri: origin,
        scope: config.scopes,
        response_type: 'code',
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
        silent_redirect_uri: `${origin}/auth/silent-callback`
    });
}

function isOidcCallback(): boolean {
    return window.location.pathname === '/auth/callback';
}

async function handleCallback(): Promise<void> {
    if (!userManager) return;

    try {
        const user = await userManager.signinRedirectCallback();
        log.log('OIDC callback successful, user:', user.profile?.sub);
        authState.user = user;
        await fetchMe();
        authState.initialized = true;
        freshLogin = true;
    } catch (err) {
        log.error('OIDC callback failed:', err);
        authState.error = err instanceof Error ? err.message : String(err);
        authState.initialized = true;
    }
}

export function consumeReturnUrl(): string {
    const url = sessionStorage.getItem('uxrr:returnUrl') || '/';
    sessionStorage.removeItem('uxrr:returnUrl');
    return url;
}
