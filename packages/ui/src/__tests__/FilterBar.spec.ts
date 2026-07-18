import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import FilterBar from '../components/FilterBar.vue';
import { SessionApi } from '../openapi-client-generated';

const STORAGE_KEY = 'uxrr:session-filters';

// Mock external dependencies
vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {} })
}));

vi.mock('@zyno-io/openapi-client-codegen', () => ({
    dataFrom: (v: unknown) => v
}));

vi.mock('@/openapi-client-generated', () => ({
    SessionApi: {
        getSessionAutocompleteAppKeys: vi.fn(async () => ['app-1', 'app-2']),
        getSessionAutocompleteUsers: vi.fn(async () => [
            { userId: 'u1', userName: 'Alice', userEmail: 'alice@test.com' },
            { userId: 'u2', userEmail: 'bob@test.com' }
        ]),
        getSessionAutocompleteDeviceIds: vi.fn(async () => ['dev-1', 'dev-2'])
    }
}));

// Stub VfSmartSelect as a simple select-like component
vi.mock('@zyno-io/vue-foundation', () => ({
    VfSmartSelect: {
        name: 'VfSmartSelect',
        props: ['modelValue', 'loadOptions', 'formatter', 'valueExtractor', 'placeholder', 'nullTitle', 'subtitleFormatter'],
        emits: ['update:modelValue'],
        template: '<div class="vf-smart-select-stub"><slot /></div>'
    }
}));

// Stub DateRangePicker
const computeRangeMock = vi.fn(() => ({}));
const initStateMock = vi.fn();
const getStateMock = vi.fn(() => ({}));
vi.mock('../components/DateRangePicker.vue', () => ({
    default: {
        name: 'DateRangePicker',
        emits: ['change'],
        setup(_: unknown, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
            expose({ computeRange: computeRangeMock, initState: initStateMock, getState: getStateMock });
        },
        template: '<div class="date-range-picker-stub" />'
    }
}));

function mountFilterBar() {
    return mount(FilterBar);
}

describe('FilterBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        computeRangeMock.mockReset().mockReturnValue({});
        initStateMock.mockReset();
        getStateMock.mockReset().mockReturnValue({});
    });

    describe('formatUser', () => {
        // Access internal functions via component instance
        it('exposes setFilter and getFilters', () => {
            const wrapper = mountFilterBar();
            expect(typeof wrapper.vm.setFilter).toBe('function');
            expect(typeof wrapper.vm.getFilters).toBe('function');
        });
    });

    describe('setFilter()', () => {
        it('updates filter and emits', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('appKey', 'app-1');
            await flushPromises();

            const emitted = wrapper.emitted('filter');
            expect(emitted).toBeTruthy();
            const lastFilters = emitted![emitted!.length - 1]![0] as Record<string, unknown>;
            expect(lastFilters.appKey).toBe('app-1');
        });

        it('ignores unknown keys', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('unknownKey', 'value');
            await flushPromises();

            const emitted = wrapper.emitted('filter');
            expect(emitted).toBeTruthy();
            const lastFilters = emitted![emitted!.length - 1]![0] as Record<string, unknown>;
            expect(lastFilters).not.toHaveProperty('unknownKey');
        });
    });

    describe('getFilters()', () => {
        it('returns current filters', () => {
            const wrapper = mountFilterBar();
            const filters = wrapper.vm.getFilters();
            expect(filters).toEqual({
                appKey: undefined,
                userId: undefined,
                deviceId: undefined,
                hasChat: undefined,
                from: undefined,
                to: undefined
            });
        });

        it('reflects set filter values', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('appKey', 'app-1');
            await flushPromises();

            const filters = wrapper.vm.getFilters();
            expect(filters.appKey).toBe('app-1');
        });

        it('includes date range from DateRangePicker', async () => {
            computeRangeMock.mockReturnValue({ from: '2026-02-01T00:00:00Z' });
            const wrapper = mountFilterBar();
            const filters = wrapper.vm.getFilters();
            expect(filters.from).toBe('2026-02-01T00:00:00Z');
        });
    });

    describe('initFilters()', () => {
        it('sets filters from route params', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.initFilters({ appKey: 'app-x', userId: 'u-1' });
            await flushPromises();

            const filters = wrapper.vm.getFilters();
            expect(filters.appKey).toBe('app-x');
            expect(filters.userId).toBe('u-1');
        });

        it('emits filter event after init', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.initFilters({ appKey: 'app-x' });
            await flushPromises();

            expect(wrapper.emitted('filter')).toBeTruthy();
        });

        it('ignores keys not in filters', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.initFilters({ garbage: 'value' });
            await flushPromises();

            const filters = wrapper.vm.getFilters();
            expect(filters).not.toHaveProperty('garbage');
        });
    });

    describe('hasChat toggle', () => {
        it('renders hasChat checkbox', () => {
            const wrapper = mountFilterBar();
            const checkbox = wrapper.find('input[type="checkbox"]');
            expect(checkbox.exists()).toBe(true);
        });

        it('emits filter on hasChat change', async () => {
            const wrapper = mountFilterBar();
            const checkboxes = wrapper.findAll('input[type="checkbox"]');
            // hasChat is the second checkbox (first is isLive)
            const checkbox = checkboxes[1]!;
            await checkbox.setValue(true);
            // trigger change manually since setValue doesn't always fire @change
            await checkbox.trigger('change');
            await flushPromises();

            const emitted = wrapper.emitted('filter');
            expect(emitted).toBeTruthy();
            const lastFilters = emitted![emitted!.length - 1]![0] as Record<string, unknown>;
            expect(lastFilters.hasChat).toBe(true);
        });
    });

    describe('rendering', () => {
        it('renders filter bar container', () => {
            const wrapper = mountFilterBar();
            expect(wrapper.find('.filter-bar').exists()).toBe(true);
        });

        it('renders three VfSmartSelect stubs', () => {
            const wrapper = mountFilterBar();
            const selects = wrapper.findAll('.vf-smart-select-stub');
            expect(selects.length).toBe(3);
        });
    });

    describe('cross-filtered options', () => {
        it('passes the other active filters to each autocomplete endpoint', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('appKey', 'app-1');
            wrapper.vm.setFilter('userId', 'u1');
            wrapper.vm.setFilter('deviceId', 'dev-1');
            await flushPromises();

            const selects = wrapper.findAllComponents({ name: 'VfSmartSelect' });
            await (selects[0]!.props('loadOptions') as (search: string | null) => Promise<unknown>)('app');
            await (selects[1]!.props('loadOptions') as (search: string | null) => Promise<unknown>)('ali');
            await (selects[2]!.props('loadOptions') as (search: string | null) => Promise<unknown>)('dev');

            expect(SessionApi.getSessionAutocompleteAppKeys).toHaveBeenLastCalledWith({
                query: expect.objectContaining({ q: 'app', userId: 'u1', deviceId: 'dev-1' })
            });
            expect(SessionApi.getSessionAutocompleteUsers).toHaveBeenLastCalledWith({
                query: expect.objectContaining({ q: 'ali', appKey: 'app-1', deviceId: 'dev-1' })
            });
            expect(SessionApi.getSessionAutocompleteDeviceIds).toHaveBeenLastCalledWith({
                query: expect.objectContaining({ q: 'dev', appKey: 'app-1', userId: 'u1' })
            });

            const appQuery = vi.mocked(SessionApi.getSessionAutocompleteAppKeys).mock.calls.at(-1)![0]!.query!;
            const userQuery = vi.mocked(SessionApi.getSessionAutocompleteUsers).mock.calls.at(-1)![0]!.query!;
            const deviceQuery = vi.mocked(SessionApi.getSessionAutocompleteDeviceIds).mock.calls.at(-1)![0]!.query!;
            expect(appQuery).not.toHaveProperty('appKey');
            expect(userQuery).not.toHaveProperty('userId');
            expect(deviceQuery).not.toHaveProperty('deviceId');
        });

        it('remounts the other option lists when a filter changes', async () => {
            const wrapper = mountFilterBar();
            const before = wrapper.findAllComponents({ name: 'VfSmartSelect' }).map(select => select.vm);

            wrapper.findAllComponents({ name: 'VfSmartSelect' })[0]!.vm.$emit('update:modelValue', 'app-1');
            await flushPromises();

            const after = wrapper.findAllComponents({ name: 'VfSmartSelect' }).map(select => select.vm);
            expect(after[0]).toBe(before[0]);
            expect(after[1]).not.toBe(before[1]);
            expect(after[2]).not.toBe(before[2]);
        });
    });

    describe('sessionStorage persistence', () => {
        it('apply() saves filters to sessionStorage', async () => {
            getStateMock.mockReturnValue({ preset: '24h' });
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('appKey', 'app-1');
            await flushPromises();

            const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!);
            expect(stored.appKey).toBe('app-1');
            expect(stored.datePreset).toBe('24h');
        });

        it('restoreFromStorage() reads and applies stored filters', async () => {
            sessionStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    appKey: 'app-saved',
                    userId: 'u-saved',
                    deviceId: '',
                    hasChat: false,
                    datePreset: '1h',
                    customFrom: '',
                    customTo: ''
                })
            );
            const wrapper = mountFilterBar();
            const result = wrapper.vm.restoreFromStorage();
            expect(result).toBe(true);

            const filters = wrapper.vm.getFilters();
            expect(filters.appKey).toBe('app-saved');
            expect(filters.userId).toBe('u-saved');
            expect(initStateMock).toHaveBeenCalledWith({ preset: '1h' });
        });

        it('restoreFromStorage() is a no-op when storage is empty', () => {
            const wrapper = mountFilterBar();
            const result = wrapper.vm.restoreFromStorage();
            expect(result).toBe(false);

            const filters = wrapper.vm.getFilters();
            expect(filters.appKey).toBeUndefined();
        });
    });
});
