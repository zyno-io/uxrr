<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { showConfirm } from '@zyno-io/vue-foundation';
import type { UserResponse } from '@/openapi-client-generated';
import { AdminApi } from '@/openapi-client-generated';
import { authState } from '@/auth';

const users = ref<UserResponse[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        users.value = dataFrom(await AdminApi.getAdminListUsers());
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to load users';
    } finally {
        loading.value = false;
    }
}

async function toggleAdmin(user: UserResponse) {
    if (user.id === authState.me?.userId) return;

    const newIsAdmin = !user.isAdmin;
    if (!newIsAdmin) {
        const ok = await showConfirm('Revoke Admin', `Remove admin access for ${user.name || user.email}?`);
        if (!ok) return;
    }

    try {
        dataFrom(await AdminApi.patchAdminUpdateUser({ path: { id: user.id }, body: { isAdmin: newIsAdmin } }));
        await load();
    } catch (err: unknown) {
        error.value = (err as Error).message ?? 'Failed to update user';
    }
}

onMounted(load);
</script>

<template>
    <div class="admin-page">
        <div class="admin-page-header">
            <h1>Users</h1>
        </div>

        <div v-if="error" class="admin-error">{{ error }}</div>

        <div v-if="loading" class="admin-loading">Loading...</div>
        <table v-else-if="users.length" class="admin-table">
            <thead>
                <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Admin</th>
                    <th>Last Login</th>
                    <th>Created</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="user in users" :key="user.id">
                    <td>{{ user.email }}</td>
                    <td>{{ user.name || '-' }}</td>
                    <td>
                        <label
                            class="toggle-switch"
                            :title="user.id === authState.me?.userId ? 'Cannot change own admin status' : ''"
                        >
                            <input
                                type="checkbox"
                                :checked="user.isAdmin"
                                :disabled="user.id === authState.me?.userId"
                                @change="toggleAdmin(user)"
                            />
                            <span class="toggle-slider" />
                        </label>
                    </td>
                    <td>{{ new Date(user.lastLoginAt).toLocaleString() }}</td>
                    <td>{{ new Date(user.createdAt).toLocaleDateString() }}</td>
                </tr>
            </tbody>
        </table>
        <div v-else class="admin-empty">No users yet. Users are created on first OIDC login.</div>
    </div>
</template>

<style scoped lang="scss">
@use './admin-shared';
</style>
