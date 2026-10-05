<script setup lang="ts">
import { showToast } from '@zyno-io/vue-foundation';
import { ref } from 'vue';

defineProps<{
    userId?: string;
    userName?: string;
    userEmail?: string;
}>();

const emit = defineEmits<{
    filter: [userId: string];
}>();

const show = ref(false);
let hideTimeout: ReturnType<typeof setTimeout> | undefined;

function onEnter() {
    clearTimeout(hideTimeout);
    show.value = true;
}

function onLeave() {
    hideTimeout = setTimeout(() => (show.value = false), 150);
}

function copy(value: string) {
    navigator.clipboard.writeText(value);
    showToast({ message: 'Copied to clipboard', durationSecs: 2 });
}
</script>

<template>
    <span class="user-popover-anchor" @mouseenter="onEnter" @mouseleave="onLeave">
        <slot />
        <div v-if="show" class="user-popover" @mouseenter="onEnter" @mouseleave="onLeave">
            <div v-if="userName" class="user-popover-row">
                <span class="user-popover-label">Name</span>
                <span class="user-popover-value">{{ userName }}</span>
            </div>
            <div v-if="userEmail" class="user-popover-row">
                <span class="user-popover-label">Email</span>
                <span class="user-popover-value user-popover-copyable" @click.stop="copy(userEmail!)">{{ userEmail }}</span>
            </div>
            <div v-if="userId" class="user-popover-row">
                <span class="user-popover-label">ID</span>
                <span class="user-popover-value user-popover-mono user-popover-copyable" @click.stop="copy(userId!)">{{ userId }}</span>
            </div>
            <button v-if="userId" class="btn sm user-popover-btn" @click.stop="emit('filter', userId)">View all sessions</button>
        </div>
    </span>
</template>

<style scoped lang="scss">
.user-popover-anchor {
    position: relative;
    display: inline;
}

.user-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 100;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    box-shadow: var(--shadow-md);
    white-space: nowrap;
    min-width: 180px;
    user-select: text;
    cursor: default;
}

.user-popover-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 2px 0;
    font-size: 12px;
}

.user-popover-label {
    color: var(--text-3);
    min-width: 38px;
    flex-shrink: 0;
}

.user-popover-value {
    color: var(--text);
}

.user-popover-mono {
    font-family: var(--font-mono);
    font-size: 11px;
}

.user-popover-copyable {
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: 0 3px;
    margin: 0 -3px;

    &:hover {
        background: var(--accent-soft);
    }
}
</style>
