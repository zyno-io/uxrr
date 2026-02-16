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

async function submit() {
    modalError.value = null;
    const unmask = modalRef.value!.mask();
    try {
        const origins = formOrigins.value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        let result: AppResponse;
        if (props.app) {
            result = dataFrom(
                await AdminApi.patchAdminUpdateApp({
                    path: { id: props.app.id },
                    body: { name: formName.value, origins }
                })
            ) as unknown as AppResponse;
        } else {
            const name = formName.value || formId.value;
            result = dataFrom(
                await AdminApi.postAdminCreateApp({
                    body: { id: formId.value || undefined, name, origins }
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
                App ID
                <input v-if="app" :value="app.id" type="text" readonly />
                <input v-else v-model="formId" v-autofocus type="text" placeholder="auto-generated" />
            </label>
            <label>
                Name
                <input v-model="formName" type="text" :placeholder="formId || 'My App'" />
            </label>
            <label>
                Origins (comma-separated)
                <input v-model="formOrigins" type="text" placeholder="https://example.com" />
            </label>
        </div>

        <template #footer>
            <button type="button" class="default" @click="callback(null)">Cancel</button>
            <button type="submit" class="primary" :disabled="!formName && !formId">Save</button>
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
}
</style>
