<script setup lang="ts">
import { ref } from 'vue';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { VfModal, vfModalRef } from '@zyno-io/vue-foundation';
import type { AppResponse } from '@/openapi-client-generated';
import { AdminApi } from '@/openapi-client-generated';

const props = defineProps<{
    app?: AppResponse;
    callback: (result: AppResponse | null) => void;
}>();

const modalRef = vfModalRef();
const modalError = ref<string | null>(null);
const formId = ref('');
const formName = ref(props.app?.name ?? '');
const formOrigins = ref(props.app?.origins.join(', ') ?? '');
const formMaxIdleMinutes = ref(props.app?.maxIdleTimeout ? String(props.app.maxIdleTimeout / 60000) : '');

async function submit() {
    modalError.value = null;
    const unmask = modalRef.value!.mask();
    try {
        const origins = formOrigins.value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const maxIdleTimeout = formMaxIdleMinutes.value.trim()
            ? Math.round(parseFloat(formMaxIdleMinutes.value) * 60000)
            : undefined;

        let result: AppResponse;
        if (props.app) {
            result = dataFrom(
                await AdminApi.patchAdminUpdateApp({
                    path: { appKey: props.app.appKey },
                    body: { name: formName.value, origins, maxIdleTimeout: maxIdleTimeout ?? null }
                })
            ) as unknown as AppResponse;
        } else {
            const name = formName.value || formId.value;
            result = dataFrom(
                await AdminApi.postAdminCreateApp({
                    body: { appKey: formId.value, name, origins, maxIdleTimeout }
                })
            ) as unknown as AppResponse;
        }

        props.callback(result);
    } catch (err: unknown) {
        modalError.value = (err as Error).message ?? 'Failed to save app';
        unmask();
    }
}
</script>

<template>
    <VfModal ref="modalRef" close-on-mask-click close-x @close="callback(null)" @form-submit="submit">
        <template #header>{{ app ? 'Edit App' : 'Create App' }}</template>

        <div v-if="modalError" class="modal-error">{{ modalError }}</div>

        <div class="modal-form">
            <label>
                App Key
                <input v-if="app" :value="app.appKey" type="text" readonly />
                <input v-else v-model="formId" v-autofocus type="text" placeholder="e.g. my-app" />
            </label>
            <label>
                Name
                <input v-model="formName" type="text" :placeholder="formId || 'My App'" />
            </label>
            <label>
                Origins (comma-separated)
                <input v-model="formOrigins" type="text" placeholder="https://example.com" />
            </label>
            <label>
                Max Idle Timeout (minutes)
                <input v-model="formMaxIdleMinutes" type="number" min="0" step="1" placeholder="30 (default)" />
                <span class="field-hint">Session resets after this many minutes of inactivity. Leave blank for default (30 min).</span>
            </label>
        </div>

        <template #footer>
            <button type="button" class="default" @click="callback(null)">Cancel</button>
            <button type="submit" class="primary" :disabled="!formId && !app">Save</button>
        </template>
    </VfModal>
</template>

<style scoped lang="scss">
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

    input {
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

        &[readonly] {
            opacity: 0.7;
            cursor: default;
        }
    }

    .field-hint {
        font-size: 11px;
        color: var(--uxrr-text-muted);
        opacity: 0.7;
    }
}
</style>
