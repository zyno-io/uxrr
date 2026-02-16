import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FilterBar from '../components/FilterBar.vue';

// Mock external dependencies
vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {} })
}));

vi.mock('@zyno-io/openapi-client-codegen', () => ({
    dataFrom: (v: unknown) => v
}));

vi.mock('@/openapi-client-generated', () => ({
    SessionApi: {
        getSessionAutocompleteAppIds: vi.fn(async () => ['app-1', 'app-2']),
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
        props: [
            'modelValue',
            'loadOptions',
            'formatter',
            'valueExtractor',
            'placeholder',
            'nullTitle',
            'subtitleFormatter'
        ],
        emits: ['update:modelValue'],
        template: '<div class="vf-smart-select-stub"><slot /></div>'
    }
}));

// Stub DateRangePicker
const computeRangeMock = vi.fn(() => ({}));
vi.mock('../components/DateRangePicker.vue', () => ({
    default: {
        name: 'DateRangePicker',
        emits: ['change'],
        setup(_: unknown, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
            expose({ computeRange: computeRangeMock });
        },
        template: '<div class="date-range-picker-stub" />'
    }
}));

function mountFilterBar() {
    return mount(FilterBar);
}

describe('FilterBar', () => {
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
            wrapper.vm.setFilter('appId', 'app-1');
            await flushPromises();

            const emitted = wrapper.emitted('filter');
            expect(emitted).toBeTruthy();
            const lastFilters = emitted![emitted!.length - 1]![0] as Record<string, unknown>;
            expect(lastFilters.appId).toBe('app-1');
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
                appId: undefined,
                userId: undefined,
                deviceId: undefined,
                hasChat: undefined,
                from: undefined,
                to: undefined
            });
        });

        it('reflects set filter values', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.setFilter('appId', 'app-1');
            await flushPromises();

            const filters = wrapper.vm.getFilters();
            expect(filters.appId).toBe('app-1');
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
            wrapper.vm.initFilters({ appId: 'app-x', userId: 'u-1' });
            await flushPromises();

            const filters = wrapper.vm.getFilters();
            expect(filters.appId).toBe('app-x');
            expect(filters.userId).toBe('u-1');
        });

        it('emits filter event after init', async () => {
            const wrapper = mountFilterBar();
            wrapper.vm.initFilters({ appId: 'app-x' });
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
            const checkbox = wrapper.find('input[type="checkbox"]');
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
});
