<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

export interface DateRange {
    from?: string;
    to?: string;
}

interface Preset {
    label: string;
    key: string;
    ms: number;
}

const PRESETS: Preset[] = [
    { label: 'Last 15 minutes', key: '15m', ms: 15 * 60_000 },
    { label: 'Last 30 minutes', key: '30m', ms: 30 * 60_000 },
    { label: 'Last 1 hour', key: '1h', ms: 60 * 60_000 },
    { label: 'Last 3 hours', key: '3h', ms: 3 * 60 * 60_000 },
    { label: 'Last 6 hours', key: '6h', ms: 6 * 60 * 60_000 },
    { label: 'Last 12 hours', key: '12h', ms: 12 * 60 * 60_000 },
    { label: 'Last 24 hours', key: '24h', ms: 24 * 60 * 60_000 },
    { label: 'Last 7 days', key: '7d', ms: 7 * 24 * 60 * 60_000 },
    { label: 'Last 30 days', key: '30d', ms: 30 * 24 * 60 * 60_000 }
];

const emit = defineEmits<{
    change: [range: DateRange];
}>();

const open = ref(false);
const activePreset = ref<string | null>(null);
const customFrom = ref('');
const customTo = ref('');
const dropdownRef = ref<HTMLDivElement>();
const triggerRef = ref<HTMLButtonElement>();

const displayText = computed(() => {
    if (activePreset.value) {
        const p = PRESETS.find(p => p.key === activePreset.value);
        return p?.label ?? 'Custom';
    }
    if (customFrom.value || customTo.value) {
        const from = customFrom.value ? formatDisplay(customFrom.value) : '...';
        const to = customTo.value ? formatDisplay(customTo.value) : 'now';
        return `${from} — ${to}`;
    }
    return 'All time';
});

function formatDisplay(datetimeLocal: string): string {
    const d = new Date(datetimeLocal);
    if (isNaN(d.getTime())) return datetimeLocal;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }
    if (sameYear) {
        return (
            d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ' ' +
            d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
        );
    }
    return (
        d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    );
}

function selectPreset(preset: Preset) {
    activePreset.value = preset.key;
    customFrom.value = '';
    customTo.value = '';
    open.value = false;
    emit('change', computeRange());
}

function clearRange() {
    activePreset.value = null;
    customFrom.value = '';
    customTo.value = '';
    open.value = false;
    emit('change', {});
}

function applyCustom() {
    activePreset.value = null;
    open.value = false;
    const range: DateRange = {};
    if (customFrom.value) range.from = new Date(customFrom.value).toISOString();
    if (customTo.value) range.to = new Date(customTo.value).toISOString();
    emit('change', range);
}

/** Compute the current range, re-evaluating relative presets to now. */
function computeRange(): DateRange {
    if (activePreset.value) {
        const preset = PRESETS.find(p => p.key === activePreset.value);
        if (preset) {
            return { from: new Date(Date.now() - preset.ms).toISOString() };
        }
    }
    const range: DateRange = {};
    if (customFrom.value) range.from = new Date(customFrom.value).toISOString();
    if (customTo.value) range.to = new Date(customTo.value).toISOString();
    return range;
}

function handleClickOutside(e: MouseEvent) {
    if (!open.value) return;
    const target = e.target as Node;
    if (dropdownRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
    open.value = false;
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside));

defineExpose({ computeRange });
</script>

<template>
    <div class="drp">
        <button ref="triggerRef" class="drp-trigger" :class="{ 'drp-trigger--active': open }" @click="open = !open">
            <svg class="drp-icon" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3" />
                <path d="M2 6.5h12" stroke="currentColor" stroke-width="1.3" />
                <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
            <span class="drp-label">{{ displayText }}</span>
            <svg class="drp-chevron" :class="{ 'drp-chevron--open': open }" viewBox="0 0 10 6" fill="none">
                <path
                    d="M1 1l4 4 4-4"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </button>

        <div v-if="open" ref="dropdownRef" class="drp-dropdown">
            <div class="drp-presets">
                <div class="drp-section-title">Quick ranges</div>
                <button
                    v-for="preset in PRESETS"
                    :key="preset.key"
                    class="drp-preset"
                    :class="{ 'drp-preset--active': activePreset === preset.key }"
                    @click="selectPreset(preset)"
                >
                    {{ preset.label }}
                </button>
                <button class="drp-preset drp-preset--clear" @click="clearRange">All time</button>
            </div>
            <div class="drp-custom">
                <div class="drp-section-title">Custom range</div>
                <label class="drp-field">
                    <span class="drp-field-label">From</span>
                    <input v-model="customFrom" type="datetime-local" class="drp-input" />
                </label>
                <label class="drp-field">
                    <span class="drp-field-label">To</span>
                    <input v-model="customTo" type="datetime-local" class="drp-input" />
                </label>
                <button class="drp-apply" :disabled="!customFrom && !customTo" @click="applyCustom">Apply</button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.drp {
    position: relative;
}

.drp-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s;

    &:hover,
    &--active {
        border-color: var(--uxrr-accent);
    }
}

.drp-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--uxrr-text-muted);
}

.drp-label {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.drp-chevron {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    color: var(--uxrr-text-muted);
    transition: transform 0.15s;

    &--open {
        transform: rotate(180deg);
    }
}

.drp-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    border: 1px solid var(--uxrr-border);
    border-radius: 6px;
    background: var(--uxrr-surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    overflow: hidden;
}

.drp-section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--uxrr-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 0 8px;
}

.drp-presets {
    display: flex;
    flex-direction: column;
    padding: 12px;
    border-right: 1px solid var(--uxrr-border);
    min-width: 170px;
}

.drp-preset {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--uxrr-text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;

    &:hover {
        background: rgba(108, 126, 225, 0.1);
    }

    &--active {
        background: rgba(108, 126, 225, 0.15);
        color: var(--uxrr-accent);
        font-weight: 500;
    }

    &--clear {
        margin-top: 4px;
        border-top: 1px solid var(--uxrr-border);
        padding-top: 10px;
        color: var(--uxrr-text-muted);
    }
}

.drp-custom {
    display: flex;
    flex-direction: column;
    padding: 12px;
    min-width: 220px;
    gap: 8px;
}

.drp-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.drp-field-label {
    font-size: 11px;
    color: var(--uxrr-text-muted);
    font-weight: 500;
}

.drp-input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font-size: 12px;
    color-scheme: dark;
    outline: none;

    &:focus {
        border-color: var(--uxrr-accent);
    }
}

.drp-apply {
    margin-top: 4px;
    height: 30px;
    border: none;
    border-radius: 4px;
    background: var(--uxrr-accent);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--uxrr-accent-hover);
    }

    &:disabled {
        opacity: 0.4;
        cursor: default;
    }
}
</style>
