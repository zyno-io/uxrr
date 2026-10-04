<script setup lang="ts">
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { VfModal, vfModalRef, showConfirmDestroy, showToast } from '@zyno-io/vue-foundation';
import { ref, onMounted } from 'vue';

import type { ApiKeyResponse, AppResponse, PostApiKeyCreateKeyResponse } from '@/openapi-client-generated';

import { AdminApi, ApiKeyApi } from '@/openapi-client-generated';

const keys = ref<ApiKeyResponse[]>([]);
const apps = ref<AppResponse[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const modalRef = vfModalRef();
const showCreate = ref(false);
const modalError = ref<string | null>(null);
const newName = ref('');
const newScope = ref<'readonly' | 'interactive'>('readonly');
const selectedAppKeys = ref<Set<string>>(new Set());
const createdKey = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        const [keysResult, appsResult] = await Promise.all([ApiKeyApi.getApiKeyListKeys(), AdminApi.getAdminListApps()]);
        keys.value = dataFrom(keysResult);
        apps.value = dataFrom(appsResult).filter(a => a.isActive);
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to load data';
    } finally {
        loading.value = false;
    }
}

function openCreate() {
    newName.value = '';
    newScope.value = 'readonly';
    selectedAppKeys.value = new Set();
    modalError.value = null;
    createdKey.value = null;
    showCreate.value = true;
}

function toggleApp(appKey: string) {
    const next = new Set(selectedAppKeys.value);
    if (next.has(appKey)) {
        next.delete(appKey);
    } else {
        next.add(appKey);
    }
    selectedAppKeys.value = next;
}

async function createKey() {
    modalError.value = null;
    const unmask = modalRef.value!.mask();
    try {
        const result = dataFrom(
            await ApiKeyApi.postApiKeyCreateKey({
                body: {
                    name: newName.value,
                    scope: newScope.value,
                    appKeys: [...selectedAppKeys.value]
                }
            })
        ) as unknown as PostApiKeyCreateKeyResponse;
        createdKey.value = result.key;
        showCreate.value = false;
        await load();
    } catch (err: unknown) {
        modalError.value = (err as Error).message ?? 'Failed to create API key';
        unmask();
    }
}

function appNamesForKey(key: ApiKeyResponse): string {
    if (!key.appKeys?.length) return 'All';
    return key.appKeys.map(id => apps.value.find(a => a.id === id)?.name ?? id).join(', ');
}

async function revokeKey(key: ApiKeyResponse) {
    const ok = await showConfirmDestroy('Revoke API Key', `Revoke "${key.name}"? This cannot be undone.`);
    if (!ok) return;

    try {
        dataFrom(await ApiKeyApi.deleteApiKeyRevokeKey({ path: { id: key.id } }));
        await load();
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to revoke API key';
    }
}

function copyKey() {
    if (!createdKey.value) return;
    navigator.clipboard.writeText(createdKey.value);
    showToast({ message: 'Copied to clipboard', durationSecs: 2 });
}

onMounted(load);
</script>

<template>
    <div class="admin-page">
        <div class="admin-page-header">
            <h1>API Keys</h1>
            <button class="btn primary uxrr-btn-primary" @click="openCreate">Create Key</button>
        </div>

        <div v-if="error" class="admin-error">{{ error }}</div>

        <div v-if="createdKey" class="admin-success-card">
            <p>API key created. Copy it now — it won't be shown again:</p>
            <code>{{ createdKey }}</code>
            <div class="api-key-actions">
                <button class="btn sm uxrr-btn-small" @click="copyKey">Copy</button>
                <button class="btn sm uxrr-btn-small" @click="createdKey = null">Dismiss</button>
            </div>
        </div>

        <div v-if="loading" class="admin-loading">Loading...</div>
        <table v-else-if="keys.length" class="admin-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Key Prefix</th>
                    <th>Scope</th>
                    <th>Apps</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="key in keys" :key="key.id" :class="{ inactive: !key.isActive }">
                    <td>{{ key.name }}</td>
                    <td>
                        <code>{{ key.keyPrefix }}...</code>
                    </td>
                    <td>{{ key.scope }}</td>
                    <td>{{ appNamesForKey(key) }}</td>
                    <td>
                        <span :class="['status-badge', key.isActive ? 'active' : 'inactive']">
                            {{ key.isActive ? 'Active' : 'Revoked' }}
                        </span>
                    </td>
                    <td>{{ new Date(key.createdAt).toLocaleDateString() }}</td>
                    <td class="actions">
                        <button v-if="key.isActive" class="btn sm uxrr-btn-small danger" @click="revokeKey(key)">Revoke</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <div v-else class="admin-empty">No API keys yet.</div>

        <teleport to="body">
            <VfModal v-if="showCreate" ref="modalRef" close-on-mask-click close-x @close="showCreate = false" @form-submit="createKey">
                <template #header>Create API Key</template>

                <div v-if="modalError" class="modal-error">{{ modalError }}</div>

                <div class="modal-form">
                    <label>
                        Name
                        <input class="input" v-model="newName" type="text" placeholder="My API Key" />
                    </label>
                    <label>
                        Scope
                        <select class="select" v-model="newScope">
                            <option value="readonly">Readonly</option>
                            <option value="interactive">Interactive</option>
                        </select>
                    </label>
                    <div class="field-group">
                        <span class="field-label">Apps <span class="label-hint">(none selected = all apps)</span></span>
                        <div class="app-checkboxes">
                            <label v-for="app in apps" :key="app.id" class="app-checkbox">
                                <input type="checkbox" :checked="selectedAppKeys.has(app.id)" @change="toggleApp(app.id)" />
                                {{ app.name }}
                            </label>
                            <span v-if="!apps.length" class="label-hint">No active apps</span>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <button type="button" class="btn uxrr-btn-secondary" @click="showCreate = false">Cancel</button>
                    <button type="submit" class="btn primary uxrr-btn-primary" :disabled="!newName">Create</button>
                </template>
            </VfModal>
        </teleport>
    </div>
</template>

<style scoped lang="scss">
@use './admin-shared';

.api-key-actions {
    display: flex;
    gap: 8px;
}

.modal-form {
    display: flex;
    flex-direction: column;
    gap: 12px;

    label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--text-3);
    }
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.field-label {
    font-size: 13px;
    color: var(--text-3);
}

.app-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    max-height: 180px;
    overflow-y: auto;
}

.app-checkbox {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 8px !important;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;

    input[type='checkbox'] {
        width: 14px;
        height: 14px;
        accent-color: var(--accent);
        cursor: pointer;
    }
}
</style>
