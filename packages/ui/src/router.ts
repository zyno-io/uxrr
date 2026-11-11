import { h } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { isAdmin } from './auth';
import { captureEmbedToken, embedState, stampEmbedToken } from './embed';

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'sessions',
            component: () => import('./pages/SessionList.vue')
        },
        {
            path: '/sessions/:id',
            name: 'session-detail',
            component: () => import('./pages/SessionDetail.vue')
        },
        {
            path: '/share/:token',
            name: 'shared-session',
            component: () => import('./pages/SharedSessionDetail.vue'),
            meta: { shared: true }
        },
        {
            path: '/embed',
            name: 'embed-sessions',
            component: () => import('./pages/EmbedSessionList.vue'),
            meta: { embed: true }
        },
        {
            path: '/embed/:id',
            name: 'embed-session-detail',
            component: () => import('./pages/EmbedSessionDetail.vue'),
            meta: { embed: true }
        },
        {
            path: '/admin/apps',
            name: 'admin-apps',
            component: () => import('./pages/AdminApps.vue'),
            meta: { admin: true }
        },
        {
            path: '/admin/users',
            name: 'admin-users',
            component: () => import('./pages/AdminUsers.vue'),
            meta: { admin: true }
        },
        {
            path: '/admin/api-keys',
            name: 'admin-api-keys',
            component: () => import('./pages/AdminApiKeys.vue'),
            meta: { admin: true }
        },
        {
            path: '/auth/callback',
            name: 'auth-callback',
            component: {
                render: () =>
                    h(
                        'div',
                        {
                            style: 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-3)'
                        },
                        'Completing sign-in...'
                    )
            }
        }
    ]
});

router.beforeEach(to => {
    if (to.meta.admin && !isAdmin.value) {
        return '/';
    }
});

// The embed bearer token arrives as ?token= on the iframe URL. Keep it in memory (initEmbed or here,
// whichever runs first: the router reads the initial URL when it is created) and resolve the same route
// without it, replacing the entry, so it never stays in the address bar, history or links. The redirect
// carries no token, so it passes straight through on the next run.
router.beforeEach(to => {
    if (!to.meta.embed || !('token' in to.query)) return;
    const { token, ...rest } = to.query;
    const value = Array.isArray(token) ? token[0] : token;
    if (!embedState.token && typeof value === 'string' && value) captureEmbedToken(value);
    return { path: to.path, query: rest, hash: to.hash, replace: true };
});

// vue-router writes fresh history state on push, so keep the token on this frame's current entry.
router.afterEach(to => {
    if (to.meta.embed && embedState.token) stampEmbedToken();
});
