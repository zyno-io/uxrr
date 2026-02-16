<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { VfSmartSelect } from '@zyno-io/vue-foundation';
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import type { GetSessionListSessionsData } from '@/openapi-client-generated';
import { SessionApi } from '@/openapi-client-generated';
import DateRangePicker, { type DateRange } from './DateRangePicker.vue';
import { createLogger } from '@/logger';

const log = createLogger('filter-bar');

type SessionFilters = NonNullable<GetSessionListSessionsData['query']>;

const emit = defineEmits<{
    filter: [filters: SessionFilters];
}>();

interface UserOption {
    userId: string;
    userName?: string;
    userEmail?: string;
}

const filters = reactive({
    appId: null as string | null,
    userId: null as string | null,
    deviceId: null as string | null,
    hasChat: false
});

const dateRange = ref<DateRange>({});
const datePickerRef = ref<InstanceType<typeof DateRangePicker>>();

async function loadAppIds(searchText: string | null): Promise<string[]> {
    return dataFrom(await SessionApi.getSessionAutocompleteAppIds({ query: { q: searchText || undefined } }));
}

async function loadUsers(searchText: string | null): Promise<UserOption[]> {
    return dataFrom(await SessionApi.getSessionAutocompleteUsers({ query: { q: searchText || undefined } }));
}

async function loadDeviceIds(searchText: string | null): Promise<string[]> {
    return dataFrom(await SessionApi.getSessionAutocompleteDeviceIds({ query: { q: searchText || undefined } }));
}

function formatUser(o: UserOption): string {
    return o.userName || o.userEmail || o.userId;
}

function formatUserSubtitle(o: UserOption): string {
    if (o.userName && o.userEmail) return o.userEmail;
    if (o.userName || o.userEmail) return o.userId;
    return '';
}

function apply() {
    // Re-compute relative dates fresh each time
    const range = datePickerRef.value?.computeRange() ?? dateRange.value;
    const out: SessionFilters = {
        appId: filters.appId || undefined,
        userId: filters.userId || undefined,
        deviceId: filters.deviceId || undefined,
        hasChat: filters.hasChat || undefined,
        from: range.from || undefined,
        to: range.to || undefined
    };
    log.log('applying filters:', out);
    emit('filter', out);
}

watch(
    () => filters.appId,
    () => apply()
);
watch(
    () => filters.userId,
    () => apply()
);
watch(
    () => filters.deviceId,
    () => apply()
);

function onDateChange(range: DateRange) {
    dateRange.value = range;
    apply();
}

function setFilter(key: string, value: string) {
    if (key in filters) {
        (filters as unknown as Record<string, string>)[key] = value;
    }
    apply();
}

/** Returns current filters with relative dates re-computed to now. */
function getFilters(): SessionFilters {
    const range = datePickerRef.value?.computeRange() ?? dateRange.value;
    return {
        appId: filters.appId || undefined,
        userId: filters.userId || undefined,
        deviceId: filters.deviceId || undefined,
        hasChat: filters.hasChat || undefined,
        from: range.from || undefined,
        to: range.to || undefined
    };
}

function initFilters(params: Record<string, string>) {
    log.log('initializing filters from params:', params);
    for (const [key, value] of Object.entries(params)) {
        if (key in filters) {
            (filters as unknown as Record<string, string>)[key] = value;
        }
    }
    apply();
}

defineExpose({ setFilter, getFilters, initFilters });
</script>

<template>
    <div class="filter-bar">
        <VfSmartSelect
            v-model="filters.appId"
            :load-options="loadAppIds"
            :formatter="(o: string) => o"
            :value-extractor="(o: string) => o"
            placeholder="App ID"
            null-title="Any App"
            remote-search
            preload
            class="filter-select"
        />
        <VfSmartSelect
            v-model="filters.userId"
            :load-options="loadUsers"
            :formatter="formatUser"
            :subtitle-formatter="formatUserSubtitle"
            :value-extractor="(o: UserOption) => o.userId"
            placeholder="User"
            null-title="Any User"
            remote-search
            preload
            class="filter-select"
        />
        <VfSmartSelect
            v-model="filters.deviceId"
            :load-options="loadDeviceIds"
            :formatter="(o: string) => o.slice(0, 8)"
            :value-extractor="(o: string) => o"
            placeholder="Device ID"
            null-title="Any Device"
            remote-search
            preload
            class="filter-select"
        />
        <DateRangePicker ref="datePickerRef" @change="onDateChange" />
        <label class="filter-toggle">
            <input type="checkbox" v-model="filters.hasChat" @change="apply" />
            <span>Has Chat</span>
        </label>
    </div>
</template>

<style scoped lang="scss">
.filter-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

.filter-input {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--uxrr-border);
    border-radius: 4px;
    background: var(--uxrr-bg);
    color: var(--uxrr-text);
    font-size: 13px;
    outline: none;

    &:focus {
        border-color: var(--uxrr-accent);
    }

    &::placeholder {
        color: var(--uxrr-text-muted);
    }
}

.filter-select {
    flex: 0 0 160px;

    :deep(input) {
        height: 32px;
        padding: 0 24px 0 10px !important;
        border: 1px solid var(--uxrr-border);
        border-radius: 4px;
        background: var(--uxrr-bg);
        color: var(--uxrr-text);
        font-size: 13px;
        outline: none;
        box-sizing: border-box;

        &:focus {
            border-color: var(--uxrr-accent);
        }

        &::placeholder {
            color: var(--uxrr-text-muted);
        }

        &.nullable::placeholder {
            color: var(--uxrr-text);
        }
    }

    :deep(.vf-smart-select)::after {
        border-top-color: var(--uxrr-text-muted);
    }

    :deep(.vf-smart-select.open)::after {
        border-bottom-color: var(--uxrr-text-muted);
    }
}

.filter-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--uxrr-text);
    cursor: pointer;
    white-space: nowrap;

    input {
        cursor: pointer;
    }
}
</style>

<style lang="scss">
/* VfSmartSelect dropdown is teleported to document.body, so it needs global (non-scoped) styles */
.vf-smart-select-options {
    border: 1px solid var(--uxrr-border) !important;
    background: var(--uxrr-surface) !important;
    color: var(--uxrr-text);
    font-size: 13px;
    border-radius: 4px;

    .option {
        &.highlighted {
            background-color: rgba(108, 126, 225, 0.15) !important;
        }
    }

    .group-title {
        color: var(--uxrr-text-muted);
    }

    .no-results {
        color: var(--uxrr-text-muted);
    }

    .subtitle {
        font-size: 11px;
        color: var(--uxrr-text-muted);
    }
}
</style>
