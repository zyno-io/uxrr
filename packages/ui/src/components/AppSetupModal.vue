<script setup lang="ts">
import { computed } from 'vue';
import { VfModal, showToast } from '@zyno-io/vue-foundation';
import type { AppResponse } from '@/openapi-client-generated';

const props = defineProps<{
    app: AppResponse;
    callback: (result: null) => void;
}>();

const snippet = computed(() => {
    return `import { init } from '@zyno-io/uxrr-client';

init({
    endpoint: '${window.location.origin}',
    appId: '${props.app.id}'
});`;
});

function copySnippet() {
    navigator.clipboard.writeText(snippet.value);
    showToast({ message: 'Copied to clipboard', durationSecs: 2 });
}
</script>

<template>
    <VfModal close-on-mask-click close-x @close="callback(null)">
        <template #header>Setup &mdash; {{ app.name }}</template>

        <div class="setup-content">
            <p class="setup-step">1. Install the client SDK:</p>
            <pre class="setup-code"><code>yarn add @zyno-io/uxrr-client</code></pre>

            <p class="setup-step">2. Initialize in your app entry point:</p>
            <pre class="setup-code"><code>{{ snippet }}</code></pre>
        </div>

        <template #footer>
            <button type="button" class="default" @click="copySnippet">Copy Snippet</button>
            <button type="button" class="default" @click="callback(null)">Close</button>
        </template>
    </VfModal>
</template>

<style scoped lang="scss">
.setup-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.setup-step {
    font-size: 13px;
    font-weight: 500;
    margin: 0;

    &:not(:first-child) {
        margin-top: 8px;
    }
}

.setup-code {
    margin: 0;
    padding: 10px 12px;
    background: var(--uxrr-bg);
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    font-family: var(--uxrr-mono);
    font-size: 12px;
    white-space: pre;
    overflow-x: auto;
    user-select: all;
}
</style>
