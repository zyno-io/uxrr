<script setup lang="ts">
import { ref } from 'vue';
import { showToast } from '@zyno-io/vue-foundation';

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
                <span class="user-popover-value user-popover-copyable" @click.stop="copy(userEmail!)">{{
                    userEmail
                }}</span>
            </div>
            <div v-if="userId" class="user-popover-row">
                <span class="user-popover-label">ID</span>
                <span class="user-popover-value user-popover-mono user-popover-copyable" @click.stop="copy(userId!)">{{
                    userId
                }}</span>
            </div>
            <button v-if="userId" class="user-popover-btn" @click.stop="emit('filter', userId)">
                View all sessions
            </button>
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
    background: var(--uxrr-surface);
    border: 1px solid var(--uxrr-border);
    border-radius: 6px;
    padding: 8px 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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
    color: var(--uxrr-text-muted);
    min-width: 38px;
    flex-shrink: 0;
}

.user-popover-value {
    color: var(--uxrr-text);
}

.user-popover-mono {
    font-family: var(--uxrr-mono);
    font-size: 11px;
}

.user-popover-copyable {
    cursor: pointer;
    border-radius: 3px;
    padding: 0 3px;
    margin: 0 -3px;

    &:hover {
        background: rgba(108, 126, 225, 0.1);
    }
}

.user-popover-btn {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 4px 8px;
    font-size: 11px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-accent);
    cursor: pointer;

    &:hover {
        background: rgba(108, 126, 225, 0.1);
    }
}
</style>
