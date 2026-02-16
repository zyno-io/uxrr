import { h } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { isAdmin } from './auth';

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
                            style: 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--uxrr-text-muted)'
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
