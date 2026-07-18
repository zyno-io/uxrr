<script setup lang="ts">
import { dataFrom } from '@zyno-io/openapi-client-codegen';
import { VfSmartSelect } from '@zyno-io/vue-foundation';
import { reactive, ref, watch } from 'vue';

import type { GetSessionListSessionsData } from '@/openapi-client-generated';

import { createLogger } from '@/logger';
import { SessionApi } from '@/openapi-client-generated';

import DateRangePicker, { type DateRange } from './DateRangePicker.vue';

const log = createLogger('filter-bar');

const STORAGE_KEY = 'uxrr:session-filters';

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
    appKey: null as string | null,
    userId: null as string | null,
    deviceId: null as string | null,
    isLive: false,
    hasChat: false
});

const dateRange = ref<DateRange>({});
const datePickerRef = ref<InstanceType<typeof DateRangePicker>>();
const appOptionsVersion = ref(0);
const userOptionsVersion = ref(0);
const deviceOptionsVersion = ref(0);

function sharedAutocompleteFilters() {
    const current = getFilters();
    return {
        from: current.from,
        to: current.to,
        isLive: current.isLive,
        hasChat: current.hasChat
    };
}

async function loadAppKeys(searchText: string | null): Promise<string[]> {
    const options = dataFrom(
        await SessionApi.getSessionAutocompleteAppKeys({
            query: {
                q: searchText || undefined,
                userId: filters.userId || undefined,
                deviceId: filters.deviceId || undefined,
                ...sharedAutocompleteFilters()
            }
        })
    );
    if (!searchText && filters.appKey && !options.includes(filters.appKey)) return [filters.appKey, ...options];
    return options;
}

async function loadUsers(searchText: string | null): Promise<UserOption[]> {
    const options = dataFrom(
        await SessionApi.getSessionAutocompleteUsers({
            query: {
                q: searchText || undefined,
                appKey: filters.appKey || undefined,
                deviceId: filters.deviceId || undefined,
                ...sharedAutocompleteFilters()
            }
        })
    );
    if (!searchText && filters.userId && !options.some(option => option.userId === filters.userId)) {
        return [{ userId: filters.userId }, ...options];
    }
    return options;
}

async function loadDeviceIds(searchText: string | null): Promise<string[]> {
    const options = dataFrom(
        await SessionApi.getSessionAutocompleteDeviceIds({
            query: {
                q: searchText || undefined,
                appKey: filters.appKey || undefined,
                userId: filters.userId || undefined,
                ...sharedAutocompleteFilters()
            }
        })
    );
    if (!searchText && filters.deviceId && !options.includes(filters.deviceId)) return [filters.deviceId, ...options];
    return options;
}

function formatUser(o: UserOption): string {
    return o.userName || o.userEmail || o.userId;
}

function formatUserSubtitle(o: UserOption): string {
    if (o.userName && o.userEmail) return o.userEmail;
    if (o.userName || o.userEmail) return o.userId;
    return '';
}

function saveToStorage() {
    try {
        const dateState = datePickerRef.value?.getState() ?? {};
        const state = {
            appKey: filters.appKey ?? '',
            userId: filters.userId ?? '',
            deviceId: filters.deviceId ?? '',
            isLive: filters.isLive,
            hasChat: filters.hasChat,
            datePreset: dateState.preset ?? '',
            customFrom: dateState.customFrom ?? '',
            customTo: dateState.customTo ?? ''
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // sessionStorage may be unavailable
    }
}

function apply() {
    // Re-compute relative dates fresh each time
    const range = datePickerRef.value?.computeRange() ?? dateRange.value;
    const out: SessionFilters = {
        appKey: filters.appKey || undefined,
        userId: filters.userId || undefined,
        deviceId: filters.deviceId || undefined,
        isLive: filters.isLive || undefined,
        hasChat: filters.hasChat || undefined,
        from: range.from || undefined,
        to: range.to || undefined
    };
    log.log('applying filters:', out);
    saveToStorage();
    emit('filter', out);
}

function refreshAutocompleteOptions(except?: 'appKey' | 'userId' | 'deviceId') {
    if (except !== 'appKey') appOptionsVersion.value++;
    if (except !== 'userId') userOptionsVersion.value++;
    if (except !== 'deviceId') deviceOptionsVersion.value++;
}

watch(
    () => filters.appKey,
    () => {
        refreshAutocompleteOptions('appKey');
        apply();
    }
);
watch(
    () => filters.userId,
    () => {
        refreshAutocompleteOptions('userId');
        apply();
    }
);
watch(
    () => filters.deviceId,
    () => {
        refreshAutocompleteOptions('deviceId');
        apply();
    }
);

function onDateChange(range: DateRange) {
    dateRange.value = range;
    refreshAutocompleteOptions();
    apply();
}

function onToggleChange() {
    refreshAutocompleteOptions();
    apply();
}

function setFilter(key: string, value: string) {
    if (key in filters) {
        (filters as unknown as Record<string, string>)[key] = value;
        refreshAutocompleteOptions();
    }
    apply();
}

/** Returns current filters with relative dates re-computed to now. */
function getFilters(): SessionFilters {
    const range = datePickerRef.value?.computeRange() ?? dateRange.value;
    return {
        appKey: filters.appKey || undefined,
        userId: filters.userId || undefined,
        deviceId: filters.deviceId || undefined,
        isLive: filters.isLive || undefined,
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
    refreshAutocompleteOptions();
    apply();
}

function restoreFromStorage(): boolean {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw);
        log.log('restoring filters from sessionStorage:', state);
        if (state.appKey) filters.appKey = state.appKey;
        if (state.userId) filters.userId = state.userId;
        if (state.deviceId) filters.deviceId = state.deviceId;
        if (state.isLive) filters.isLive = state.isLive;
        if (state.hasChat) filters.hasChat = state.hasChat;
        if (state.datePreset || state.customFrom || state.customTo) {
            datePickerRef.value?.initState({
                preset: state.datePreset || undefined,
                customFrom: state.customFrom || undefined,
                customTo: state.customTo || undefined
            });
        }
        refreshAutocompleteOptions();
        return true;
    } catch {
        return false;
    }
}

defineExpose({ setFilter, getFilters, initFilters, restoreFromStorage });
</script>

<template>
    <div class="filter-bar">
        <VfSmartSelect
            :key="`app-${appOptionsVersion}`"
            v-model="filters.appKey"
            :load-options="loadAppKeys"
            :formatter="(o: string) => o"
            :value-extractor="(o: string) => o"
            placeholder="App Key"
            null-title="Any App"
            remote-search
            preload
            class="filter-select"
        />
        <VfSmartSelect
            :key="`user-${userOptionsVersion}`"
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
            :key="`device-${deviceOptionsVersion}`"
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
            <input type="checkbox" v-model="filters.isLive" @change="onToggleChange" />
            <span>Live</span>
        </label>
        <label class="filter-toggle">
            <input type="checkbox" v-model="filters.hasChat" @change="onToggleChange" />
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
