<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

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
const useUtc = ref(localStorage.getItem('uxrr:date-utc') === 'true');

let suppressSync = false;

// --- helpers ---

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

function dateToText(d: Date): string {
    if (useUtc.value) {
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a YYYY-MM-DD HH:mm (or with T separator / optional seconds) string, interpreted as UTC or local per toggle. */
function textToDate(text: string): Date | null {
    const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const [y, m, d, h, min, sec] = [+match[1]!, +match[2]!, +match[3]!, +match[4]!, +match[5]!, +(match[6] ?? 0)];
    const date = useUtc.value ? new Date(Date.UTC(y, m - 1, d, h, min, sec)) : new Date(y, m - 1, d, h, min, sec);
    return isNaN(date.getTime()) ? null : date;
}

/** Parse a pasted timestamp in various formats. */
function parseTimestamp(text: string): Date | null {
    text = text.trim();
    // Our display format (YYYY-MM-DD HH:mm, with optional T / seconds)
    const own = textToDate(text);
    if (own) return own;
    // ISO 8601 with timezone info (Z, +00:00, etc.)
    if (/^\d{4}-/.test(text)) {
        const d = new Date(text);
        if (!isNaN(d.getTime())) return d;
    }
    // Unix timestamp (seconds or milliseconds)
    if (/^\d{10,13}$/.test(text)) {
        const num = Number(text);
        const d = new Date(text.length >= 13 ? num : num * 1000);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

// --- display ---

const displayText = computed(() => {
    if (activePreset.value) {
        const p = PRESETS.find(p => p.key === activePreset.value);
        return p?.label ?? 'Custom';
    }
    if (customFrom.value || customTo.value) {
        const from = customFrom.value ? formatDisplay(customFrom.value) : '...';
        const to = customTo.value ? formatDisplay(customTo.value) : 'now';
        const tz = useUtc.value ? ' UTC' : '';
        return `${from} — ${to}${tz}`;
    }
    return 'All time';
});

function formatDisplay(text: string): string {
    const d = textToDate(text);
    if (!d) return text;
    const now = new Date();

    const y = useUtc.value ? d.getUTCFullYear() : d.getFullYear();
    const m = useUtc.value ? d.getUTCMonth() : d.getMonth();
    const day = useUtc.value ? d.getUTCDate() : d.getDate();
    const h = useUtc.value ? d.getUTCHours() : d.getHours();
    const min = useUtc.value ? d.getUTCMinutes() : d.getMinutes();
    const ny = useUtc.value ? now.getUTCFullYear() : now.getFullYear();
    const nm = useUtc.value ? now.getUTCMonth() : now.getMonth();
    const nd = useUtc.value ? now.getUTCDate() : now.getDate();

    const time = `${pad(h)}:${pad(min)}`;
    const sameYear = y === ny;
    const sameDay = sameYear && m === nm && day === nd;

    if (sameDay) return time;
    if (sameYear) return `${pad(m + 1)}-${pad(day)} ${time}`;
    return `${y}-${pad(m + 1)}-${pad(day)} ${time}`;
}

// --- actions ---

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
    emit('change', computeRange());
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
    if (customFrom.value) {
        const d = textToDate(customFrom.value);
        if (d) range.from = d.toISOString();
    }
    if (customTo.value) {
        const d = textToDate(customTo.value);
        if (d) range.to = d.toISOString();
    }
    return range;
}

function toggleUtc() {
    const fromDate = customFrom.value ? textToDate(customFrom.value) : null;
    const toDate = customTo.value ? textToDate(customTo.value) : null;
    useUtc.value = !useUtc.value;
    localStorage.setItem('uxrr:date-utc', String(useUtc.value));
    suppressSync = true;
    if (fromDate) customFrom.value = dateToText(fromDate);
    if (toDate) customTo.value = dateToText(toDate);
    suppressSync = false;
}

function handlePaste(e: ClipboardEvent, field: 'from' | 'to') {
    const text = e.clipboardData?.getData('text')?.trim();
    if (!text) return;
    const parsed = parseTimestamp(text);
    if (!parsed) return;
    e.preventDefault();
    const formatted = dateToText(parsed);
    suppressSync = true;
    if (field === 'from') {
        customFrom.value = formatted;
        customTo.value = formatted;
    } else {
        customTo.value = formatted;
    }
    suppressSync = false;
}

// Sync to = from when from is set to a valid date
watch(
    customFrom,
    (newVal) => {
        if (suppressSync) return;
        if (newVal && textToDate(newVal)) {
            customTo.value = newVal;
        }
    },
    { flush: 'sync' }
);

// --- click outside ---

function handleClickOutside(e: MouseEvent) {
    if (!open.value) return;
    const target = e.target as Node;
    if (dropdownRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
    open.value = false;
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside));

// --- state persistence (stores ISO strings for portability) ---

function initState(state: { preset?: string; customFrom?: string; customTo?: string }) {
    if (state.preset) {
        const found = PRESETS.find(p => p.key === state.preset);
        if (found) {
            activePreset.value = found.key;
            customFrom.value = '';
            customTo.value = '';
            return;
        }
    }
    if (state.customFrom || state.customTo) {
        activePreset.value = null;
        suppressSync = true;
        customFrom.value = isoToText(state.customFrom);
        customTo.value = isoToText(state.customTo);
        suppressSync = false;
    }
}

function isoToText(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : dateToText(d);
}

function getState(): { preset?: string; customFrom?: string; customTo?: string } {
    if (activePreset.value) return { preset: activePreset.value };
    const state: { preset?: string; customFrom?: string; customTo?: string } = {};
    if (customFrom.value) {
        const d = textToDate(customFrom.value);
        if (d) state.customFrom = d.toISOString();
    }
    if (customTo.value) {
        const d = textToDate(customTo.value);
        if (d) state.customTo = d.toISOString();
    }
    return state;
}

defineExpose({ computeRange, initState, getState });
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
                <div class="drp-custom-header">
                    <span class="drp-section-title">Custom range</span>
                    <button class="drp-tz-toggle" :class="{ 'drp-tz-toggle--utc': useUtc }" @click="toggleUtc">
                        {{ useUtc ? 'UTC' : 'Local' }}
                    </button>
                </div>
                <label class="drp-field">
                    <span class="drp-field-label">From</span>
                    <input
                        v-model="customFrom"
                        type="text"
                        class="drp-input"
                        placeholder="YYYY-MM-DD HH:mm[:ss]"
                        @paste="e => handlePaste(e, 'from')"
                    />
                </label>
                <label class="drp-field">
                    <span class="drp-field-label">To</span>
                    <input
                        v-model="customTo"
                        type="text"
                        class="drp-input"
                        placeholder="YYYY-MM-DD HH:mm[:ss]"
                        @paste="e => handlePaste(e, 'to')"
                    />
                </label>
                <button class="drp-apply" :disabled="!textToDate(customFrom) || !textToDate(customTo)" @click="applyCustom">Apply</button>
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

.drp-custom-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .drp-section-title {
        padding: 0;
    }
}

.drp-tz-toggle {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border: 1px solid var(--uxrr-border);
    border-radius: 10px;
    background: transparent;
    color: var(--uxrr-text-muted);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s,
        border-color 0.15s;

    &:hover {
        border-color: var(--uxrr-accent);
        color: var(--uxrr-text);
    }

    &--utc {
        background: rgba(108, 126, 225, 0.15);
        border-color: var(--uxrr-accent);
        color: var(--uxrr-accent);
    }
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
    font-family: inherit;
    color-scheme: dark;
    outline: none;

    &:focus {
        border-color: var(--uxrr-accent);
    }

    &::placeholder {
        color: var(--uxrr-text-muted);
        opacity: 0.6;
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
