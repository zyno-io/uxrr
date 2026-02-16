<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { markRaw } from 'vue';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { showConfirmDestroy, presentOverlay } from '@zyno-io/vue-foundation';
import type { AppResponse } from '@/openapi-client-generated';
import { AdminApi } from '@/openapi-client-generated';
import AppFormModal from '@/components/AppFormModal.vue';
import AppSetupModal from '@/components/AppSetupModal.vue';

const apps = ref<AppResponse[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        apps.value = dataFrom(await AdminApi.getAdminListApps());
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to load apps';
    } finally {
        loading.value = false;
    }
}

async function openCreate() {
    const result = await presentOverlay(markRaw(AppFormModal), {});
    if (result) {
        await load();
        await presentOverlay(markRaw(AppSetupModal), { app: result });
    }
}

async function openEdit(app: AppResponse) {
    const result = await presentOverlay(markRaw(AppFormModal), { app });
    if (result) {
        await load();
    }
}

function openSetup(app: AppResponse) {
    presentOverlay(markRaw(AppSetupModal), { app });
}

async function toggleActive(app: AppResponse) {
    try {
        if (app.isActive) {
            const ok = await showConfirmDestroy(
                'Deactivate App',
                `Deactivate "${app.name}"? It will stop accepting ingest data.`
            );
            if (!ok) return;
            dataFrom(await AdminApi.deleteAdminDeactivateApp({ path: { id: app.id } }));
        } else {
            dataFrom(await AdminApi.patchAdminUpdateApp({ path: { id: app.id }, body: { isActive: true } }));
        }
        await load();
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to update app';
    }
}

onMounted(load);
</script>

<template>
    <div class="admin-page">
        <div class="admin-page-header">
            <h1>Apps</h1>
            <button class="uxrr-btn-primary" @click="openCreate">Create App</button>
        </div>

        <div v-if="error" class="admin-error">{{ error }}</div>

        <div v-if="loading" class="admin-loading">Loading...</div>
        <table v-else-if="apps.length" class="admin-table">
            <thead>
                <tr>
                    <th>App ID</th>
                    <th>Name</th>
                    <th>Origins</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="app in apps" :key="app.id" :class="{ inactive: !app.isActive }">
                    <td>
                        <code class="app-id">{{ app.id }}</code>
                    </td>
                    <td>{{ app.name }}</td>
                    <td class="origins">{{ app.origins.join(', ') || '-' }}</td>
                    <td>
                        <span :class="['status-badge', app.isActive ? 'active' : 'inactive']">
                            {{ app.isActive ? 'Active' : 'Inactive' }}
                        </span>
                    </td>
                    <td>{{ new Date(app.createdAt).toLocaleDateString() }}</td>
                    <td class="actions">
                        <button class="uxrr-btn-small" @click="openSetup(app)">Setup</button>
                        <button class="uxrr-btn-small" @click="openEdit(app)">Edit</button>
                        <button
                            class="uxrr-btn-small"
                            :class="app.isActive ? 'danger' : 'success'"
                            @click="toggleActive(app)"
                        >
                            {{ app.isActive ? 'Deactivate' : 'Activate' }}
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <div v-else class="admin-empty">No apps yet. Create one to get started.</div>
    </div>
</template>

<style scoped lang="scss">
@use './admin-shared';

.app-id {
    padding: 2px 6px;
    background: var(--uxrr-bg);
    border-radius: 3px;
    font-family: var(--uxrr-mono);
    font-size: 11px;
    user-select: all;
}
</style>
