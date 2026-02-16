<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { OverlayContainer } from '@zyno-io/vue-foundation';
import { authState, isAdmin, logout } from './auth';

const route = useRoute();
const isShared = computed(() => route.meta.shared === true);
const isEmbed = computed(() => route.meta.embed === true);

const adminMenuOpen = ref(false);
const adminMenuRef = ref<HTMLElement | null>(null);

function toggleAdminMenu() {
    adminMenuOpen.value = !adminMenuOpen.value;
}

function onClickOutside(e: MouseEvent) {
    if (adminMenuRef.value && !adminMenuRef.value.contains(e.target as Node)) {
        adminMenuOpen.value = false;
    }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>

<template>
    <div id="uxrr-app">
        <OverlayContainer />
        <div v-if="authState.error" class="uxrr-auth-error">
            <p>Authentication Error</p>
            <p class="uxrr-auth-error-detail">{{ authState.error }}</p>
        </div>

        <template v-else>
            <header v-if="!isEmbed" class="uxrr-header">
                <router-link v-if="!isShared" to="/" class="uxrr-logo">uxrr</router-link>
                <span v-else class="uxrr-logo">uxrr</span>
                <div v-if="isShared" class="uxrr-header-actions">
                    <span class="uxrr-shared-badge">Shared View</span>
                </div>
                <div v-else class="uxrr-header-actions">
                    <span v-if="authState.oidcEnabled && authState.user" class="uxrr-user-name">
                        {{ authState.user.profile?.name || authState.user.profile?.preferred_username || 'User' }}
                    </span>
                    <button v-if="authState.oidcEnabled && authState.user" class="uxrr-logout-btn" @click="logout">
                        Sign out
                    </button>
                    <div v-if="isAdmin" ref="adminMenuRef" class="uxrr-admin-menu">
                        <button
                            class="uxrr-admin-cog"
                            :class="{ active: adminMenuOpen }"
                            @click.stop="toggleAdminMenu"
                            title="Admin"
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <circle cx="12" cy="12" r="3" />
                                <path
                                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                                />
                            </svg>
                        </button>
                        <nav v-if="adminMenuOpen" class="uxrr-admin-dropdown" @click="adminMenuOpen = false">
                            <router-link to="/admin/apps">Apps</router-link>
                            <router-link to="/admin/users">Users</router-link>
                            <router-link to="/admin/api-keys">API Keys</router-link>
                        </nav>
                    </div>
                </div>
            </header>
            <main class="uxrr-main">
                <router-view />
            </main>
        </template>
    </div>
</template>

<style lang="scss">
*,
*::before,
*::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

:root {
    --uxrr-bg: #0f1117;
    --uxrr-surface: #1a1c25;
    --uxrr-border: #2a2d3a;
    --uxrr-text: #e0e0e8;
    --uxrr-text-muted: #8b8fa3;
    --uxrr-accent: #6c7ee1;
    --uxrr-accent-hover: #8290eb;
    --uxrr-danger: #e15b5b;
    --uxrr-warning: #e1b05b;
    --uxrr-success: #5be18a;
    --uxrr-info: #5bb8e1;
    --uxrr-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --uxrr-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

html,
body {
    height: 100%;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font-family: var(--uxrr-font);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
}

#app {
    height: 100%;
}

#uxrr-app {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.uxrr-header {
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--uxrr-border);
    background: var(--uxrr-surface);
    flex-shrink: 0;
}

.uxrr-logo {
    font-size: 18px;
    font-weight: 700;
    color: var(--uxrr-accent);
    text-decoration: none;
    letter-spacing: -0.5px;
}

.uxrr-admin-menu {
    position: relative;
}

.uxrr-admin-cog {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--uxrr-text-muted);
    cursor: pointer;
    transition:
        color 0.15s,
        background 0.15s;

    &:hover,
    &.active {
        color: var(--uxrr-accent);
        background: rgba(108, 126, 225, 0.1);
    }
}

.uxrr-admin-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 140px;
    padding: 4px 0;
    background: var(--uxrr-surface);
    border: 1px solid var(--uxrr-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    display: flex;
    flex-direction: column;

    a {
        display: block;
        padding: 8px 14px;
        font-size: 13px;
        color: var(--uxrr-text-muted);
        text-decoration: none;

        &:hover {
            background: rgba(108, 126, 225, 0.1);
            color: var(--uxrr-text);
        }

        &.router-link-active {
            color: var(--uxrr-accent);
        }
    }
}

.uxrr-header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
}

.uxrr-user-name {
    font-size: 13px;
    color: var(--uxrr-text-muted);
}

.uxrr-logout-btn {
    padding: 4px 10px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-text-muted);
    font-size: 12px;
    cursor: pointer;

    &:hover {
        border-color: var(--uxrr-accent);
        color: var(--uxrr-accent);
    }
}

.uxrr-shared-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--uxrr-text-muted);
    padding: 2px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 3px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.uxrr-auth-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--uxrr-danger);
    gap: 8px;

    p:first-child {
        font-size: 18px;
        font-weight: 600;
    }
}

.uxrr-auth-error-detail {
    font-size: 13px;
    color: var(--uxrr-text-muted);
    max-width: 500px;
    text-align: center;
}

.uxrr-main {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

// VfModal + VfAlert dark-theme overrides
.vf-modal-wrap {
    background: rgba(0, 0, 0, 0.6) !important;
}

.vf-modal {
    background: var(--uxrr-surface) !important;
    border: 1px solid var(--uxrr-border);
    border-radius: 8px !important;
    min-width: 400px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5) !important;

    &.vf-masked {
        .vf-modal-content,
        .vf-modal-footer {
            opacity: 0.5;
            pointer-events: none;
        }
    }
}

.vf-modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--uxrr-border);
    font-size: 16px;
    font-weight: 600;
    color: var(--uxrr-text);
    display: flex;
    align-items: center;
    justify-content: space-between;

    .close {
        cursor: pointer;
        color: var(--uxrr-text-muted);

        &:hover {
            color: var(--uxrr-text);
        }
    }
}

.vf-modal-content {
    padding: 20px;

    .modal-error {
        padding: 8px 12px;
        margin-bottom: 12px;
        border-radius: 4px;
        background: rgba(225, 91, 91, 0.1);
        color: var(--uxrr-danger);
        font-size: 13px;
    }
}

.vf-modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--uxrr-border);
    display: flex;
    gap: 8px;
    justify-content: flex-end;

    button {
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        border: 1px solid var(--uxrr-border);
        background: transparent;
        color: var(--uxrr-text-muted);

        &:hover {
            border-color: var(--uxrr-accent);
            color: var(--uxrr-text);
        }

        &.primary {
            background: var(--uxrr-accent);
            border-color: var(--uxrr-accent);
            color: white;

            &:hover {
                background: var(--uxrr-accent-hover);
            }
        }

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }
}

.vf-modal-wrap.vf-alert {
    .vf-modal-content {
        color: var(--uxrr-text-muted);
        font-size: 13px;
    }

    &.destructive .vf-modal-footer button.primary {
        background: var(--uxrr-danger);
        border-color: var(--uxrr-danger);
        color: white;

        &:hover {
            background: #c94646;
        }
    }
}

// Toggle switch
.toggle-switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;

    input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .toggle-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: var(--uxrr-border);
        border-radius: 20px;
        transition: background 0.2s;

        &::before {
            content: '';
            position: absolute;
            height: 14px;
            width: 14px;
            left: 3px;
            bottom: 3px;
            background: var(--uxrr-text-muted);
            border-radius: 50%;
            transition:
                transform 0.2s,
                background 0.2s;
        }
    }

    input:checked + .toggle-slider {
        background: var(--uxrr-accent);

        &::before {
            transform: translateX(16px);
            background: white;
        }
    }

    input:disabled + .toggle-slider {
        opacity: 0.4;
        cursor: not-allowed;
    }
}

// Toast styling — fixed positioning so it floats above modals
.vf-toast {
    position: fixed;
    z-index: 100000;
    background: var(--uxrr-surface);
    border: 1px solid var(--uxrr-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 0;
    min-width: 200px;

    .content {
        padding: 10px 14px;
        gap: 12px;
    }

    .message {
        font-size: 13px;
        color: var(--uxrr-text);
        white-space: nowrap;
    }

    .close {
        color: var(--uxrr-text-muted);
        font-size: 14px;
        cursor: pointer;

        &:hover {
            color: var(--uxrr-text);
        }
    }

    .progress-bar {
        height: 2px;
        background: var(--uxrr-border);
        border-radius: 0 0 6px 6px;
        overflow: hidden;

        .inner {
            height: 100%;
            background: var(--uxrr-accent);
        }
    }
}
</style>
