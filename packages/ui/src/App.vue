<script setup lang="ts">
import { OverlayContainer } from '@zyno-io/vue-foundation';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { authState, isAdmin, logout } from './auth';
import DropdownMenu from './components/DropdownMenu.vue';
import ThemeMenu from './components/ThemeMenu.vue';
import { embedState } from './embed';

const route = useRoute();
const isShared = computed(() => route.meta.shared === true);
const isEmbed = computed(() => route.meta.embed === true);
// An embed route without a usable token (opened on its own, or the token was rejected) cannot load anything.
const embedUnavailable = computed(() => isEmbed.value && !embedState.token);
</script>

<template>
    <div id="uxrr-app">
        <OverlayContainer />
        <div v-if="authState.error" class="uxrr-auth-error">
            <p>Authentication Error</p>
            <p class="uxrr-auth-error-detail">{{ authState.error }}</p>
        </div>
        <template v-else>
            <a v-if="!isEmbed" class="skip-link" href="#main">Skip to content</a>
            <header v-if="!isEmbed" class="uxrr-header">
                <component :is="isShared ? 'span' : 'router-link'" to="/" class="uxrr-logo" aria-label="uxrr home">
                    <span class="brand-mark" aria-hidden="true">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="m11 7-6 5 6 5V7Zm8 0-6 5 6 5V7Z" />
                        </svg>
                    </span>
                    <span>uxrr</span>
                </component>
                <nav v-if="!isShared" class="uxrr-nav" aria-label="Primary">
                    <router-link to="/" class="nav-link" exact-active-class="active">Sessions</router-link>
                </nav>
                <div class="uxrr-header-actions">
                    <span v-if="isShared" class="tag">Shared View</span>
                    <ThemeMenu />
                    <template v-if="!isShared">
                        <span v-if="authState.oidcEnabled && authState.user" class="uxrr-user-name">
                            {{ authState.user.profile?.name || authState.user.profile?.preferred_username || 'User' }}
                        </span>
                        <button v-if="authState.oidcEnabled && authState.user" class="btn ghost sm" @click="logout">Sign out</button>
                        <DropdownMenu v-if="isAdmin" label="Admin" trigger-class="uxrr-admin-cog icon-trigger">
                            <template #trigger>
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    aria-hidden="true"
                                >
                                    <circle cx="12" cy="12" r="3" />
                                    <path
                                        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                                    />
                                </svg>
                            </template>
                            <div class="menu-label">Administration</div>
                            <router-link to="/admin/apps" class="menu-item" role="menuitem">Apps</router-link>
                            <router-link to="/admin/users" class="menu-item" role="menuitem">Users</router-link>
                            <router-link to="/admin/api-keys" class="menu-item" role="menuitem">API Keys</router-link>
                        </DropdownMenu>
                    </template>
                </div>
            </header>
            <main id="main" class="uxrr-main" tabindex="-1">
                <div v-if="embedUnavailable" class="embed-unavailable">
                    <div class="notice" role="status">
                        <p class="notice-body">
                            {{
                                embedState.rejected
                                    ? "This embedded view has expired or is no longer valid. Reopen it from the application it's embedded in."
                                    : "This embedded view can't be opened on its own. Open it from the application it's embedded in."
                            }}
                        </p>
                    </div>
                </div>
                <router-view v-else v-slot="{ Component }">
                    <keep-alive include="SessionList">
                        <component :is="Component" />
                    </keep-alive>
                </router-view>
            </main>
        </template>
    </div>
</template>

<style lang="scss" scoped>
.embed-unavailable {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px 16px;

    .notice {
        max-width: 480px;
    }
}

#uxrr-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
}

.skip-link {
    position: absolute;
    left: 12px;
    top: -40px;
    z-index: 100;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-text);

    &:focus {
        top: 10px;
    }
}

.uxrr-header {
    display: flex;
    align-items: center;
    gap: 18px;
    height: var(--header-h);
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: saturate(1.4) blur(10px);
    flex-shrink: 0;
    position: relative;
    z-index: 40;
}

.uxrr-logo {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 14px;
    font-weight: 650;
    color: var(--text);
    text-decoration: none;
    letter-spacing: -0.01em;
}

.brand-mark {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: var(--text);
    color: var(--bg);
}

.nav-link {
    display: block;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;

    &:hover {
        background: var(--surface-2);
        color: var(--text);
    }
    &.active {
        background: var(--surface-3);
        color: var(--text);
    }
}

.uxrr-header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;

    :deep(.icon-trigger) {
        justify-content: center;
        width: 32px;
        padding: 0;
    }
}

.uxrr-user-name {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--text-2);
}

.uxrr-auth-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    color: var(--danger);
    gap: 8px;

    p:first-child {
        font-size: 18px;
        font-weight: 600;
    }
}

.uxrr-auth-error-detail {
    font-size: 13px;
    color: var(--text-2);
    max-width: 500px;
    text-align: center;
}

.uxrr-main {
    flex: 1;
    min-height: 0;
    overflow: hidden;

    &:focus {
        outline: none;
    }
}

@media (max-width: 640px) {
    .uxrr-header {
        gap: 10px;
        padding: 0 12px;
    }
    .uxrr-user-name {
        display: none;
    }
}
</style>
