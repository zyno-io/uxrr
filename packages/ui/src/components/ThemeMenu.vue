<script setup lang="ts">
import { computed } from 'vue';

import { type ThemeMode, useTheme } from '../composables/useTheme';
import DropdownMenu from './DropdownMenu.vue';

const { mode, isDark, setMode } = useTheme();
const icons = {
    system: 'M3 4h18v12H3V4Zm5 16h8m-4-4v4',
    light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
    dark: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z'
};
const options: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
];
const currentIcon = computed(() => icons[mode.value === 'system' ? 'system' : isDark.value ? 'dark' : 'light']);
</script>

<template>
    <DropdownMenu label="Theme" trigger-class="icon-trigger">
        <template #trigger>
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path :d="currentIcon" />
            </svg>
        </template>
        <div class="menu-label">Theme</div>
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="menu-item"
            role="menuitemradio"
            :aria-checked="mode === option.value"
            @click="setMode(option.value)"
        >
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path :d="icons[option.value]" />
            </svg>
            {{ option.label }}
            <svg
                v-if="mode === option.value"
                class="check"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <path d="m5 12 4 4L19 6" />
            </svg>
        </button>
    </DropdownMenu>
</template>
