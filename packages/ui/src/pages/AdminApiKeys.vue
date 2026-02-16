<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { VfModal, vfModalRef, showConfirmDestroy, showToast } from '@zyno-io/vue-foundation';
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
const selectedAppIds = ref<Set<string>>(new Set());
const createdKey = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        const [keysResult, appsResult] = await Promise.all([
            ApiKeyApi.getApiKeyListKeys(),
            AdminApi.getAdminListApps()
        ]);
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
    selectedAppIds.value = new Set();
    modalError.value = null;
    createdKey.value = null;
    showCreate.value = true;
}

function toggleApp(appId: string) {
    const next = new Set(selectedAppIds.value);
    if (next.has(appId)) {
        next.delete(appId);
    } else {
        next.add(appId);
    }
    selectedAppIds.value = next;
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
                    appIds: [...selectedAppIds.value]
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
    if (!key.appIds?.length) return 'All';
    return key.appIds.map(id => apps.value.find(a => a.id === id)?.name ?? id).join(', ');
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
            <button class="uxrr-btn-primary" @click="openCreate">Create Key</button>
        </div>

        <div v-if="error" class="admin-error">{{ error }}</div>

        <div v-if="createdKey" class="admin-success-card">
            <p>API key created. Copy it now — it won't be shown again:</p>
            <code>{{ createdKey }}</code>
            <div class="api-key-actions">
                <button class="uxrr-btn-small" @click="copyKey">Copy</button>
                <button class="uxrr-btn-small" @click="createdKey = null">Dismiss</button>
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
                        <button v-if="key.isActive" class="uxrr-btn-small danger" @click="revokeKey(key)">
                            Revoke
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <div v-else class="admin-empty">No API keys yet.</div>

        <teleport to="body">
            <VfModal
                v-if="showCreate"
                ref="modalRef"
                close-on-mask-click
                close-x
                @close="showCreate = false"
                @form-submit="createKey"
            >
                <template #header>Create API Key</template>

                <div v-if="modalError" class="modal-error">{{ modalError }}</div>

                <div class="modal-form">
                    <label>
                        Name
                        <input v-model="newName" type="text" placeholder="My API Key" />
                    </label>
                    <label>
                        Scope
                        <select v-model="newScope">
                            <option value="readonly">Readonly</option>
                            <option value="interactive">Interactive</option>
                        </select>
                    </label>
                    <div class="field-group">
                        <span class="field-label">Apps <span class="label-hint">(none selected = all apps)</span></span>
                        <div class="app-checkboxes">
                            <label v-for="app in apps" :key="app.id" class="app-checkbox">
                                <input
                                    type="checkbox"
                                    :checked="selectedAppIds.has(app.id)"
                                    @change="toggleApp(app.id)"
                                />
                                {{ app.name }}
                            </label>
                            <span v-if="!apps.length" class="label-hint">No active apps</span>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <button type="button" class="uxrr-btn-secondary" @click="showCreate = false">Cancel</button>
                    <button type="submit" class="uxrr-btn-primary" :disabled="!newName">Create</button>
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
        color: var(--uxrr-text-muted);
    }

    input[type='text'],
    select {
        padding: 6px 10px;
        border: 1px solid var(--uxrr-border);
        border-radius: 4px;
        background: var(--uxrr-bg);
        color: var(--uxrr-text);
        font-size: 13px;

        &:focus {
            outline: none;
            border-color: var(--uxrr-accent);
        }
    }
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.field-label {
    font-size: 13px;
    color: var(--uxrr-text-muted);
}

.app-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: var(--uxrr-bg);
    max-height: 180px;
    overflow-y: auto;
}

.app-checkbox {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 8px !important;
    font-size: 13px;
    color: var(--uxrr-text);
    cursor: pointer;

    input[type='checkbox'] {
        width: 14px;
        height: 14px;
        accent-color: var(--uxrr-accent);
        cursor: pointer;
    }
}
</style>
