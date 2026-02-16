import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DateRangePicker from '../components/DateRangePicker.vue';

describe('DateRangePicker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
        localStorage.removeItem('uxrr:date-utc');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function mountPicker() {
        return mount(DateRangePicker);
    }

    function vm(wrapper: ReturnType<typeof mountPicker>) {
        return wrapper.vm as unknown as {
            computeRange(): { from?: string; to?: string };
            initState(s: { preset?: string; customFrom?: string; customTo?: string }): void;
            getState(): { preset?: string; customFrom?: string; customTo?: string };
        };
    }

    describe('display text', () => {
        it('shows "All time" by default', () => {
            const wrapper = mountPicker();
            expect(wrapper.find('.drp-label').text()).toBe('All time');
        });

        it('shows preset label after selecting a preset', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            const hourPreset = presets.find(p => p.text() === 'Last 1 hour');
            expect(hourPreset).toBeDefined();
            await hourPreset!.trigger('click');
            expect(wrapper.find('.drp-label').text()).toBe('Last 1 hour');
        });
    });

    describe('dropdown toggle', () => {
        it('opens dropdown on trigger click', async () => {
            const wrapper = mountPicker();
            expect(wrapper.find('.drp-dropdown').exists()).toBe(false);
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-dropdown').exists()).toBe(true);
        });

        it('closes dropdown on second click', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-dropdown').exists()).toBe(true);
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-dropdown').exists()).toBe(false);
        });
    });

    describe('preset selection', () => {
        it('emits change with computed from date for preset', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');

            const presets = wrapper.findAll('.drp-preset');
            // "Last 15 minutes" is the first preset
            await presets[0]!.trigger('click');

            const emitted = wrapper.emitted('change');
            expect(emitted).toBeTruthy();
            expect(emitted![0]![0]).toEqual({
                from: new Date(Date.now() - 15 * 60_000).toISOString()
            });
        });

        it('closes dropdown after preset selection', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            expect(wrapper.find('.drp-dropdown').exists()).toBe(false);
        });

        it('marks active preset with CSS class', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            // Re-open to see active state
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-preset--active').exists()).toBe(true);
            expect(wrapper.find('.drp-preset--active').text()).toBe('Last 15 minutes');
        });
    });

    describe('clear range', () => {
        it('emits empty range on clear', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            await wrapper.find('.drp-trigger').trigger('click');
            const clearBtn = wrapper.find('.drp-preset--clear');
            expect(clearBtn.text()).toBe('All time');
            await clearBtn.trigger('click');

            const emitted = wrapper.emitted('change')!;
            expect(emitted[emitted.length - 1]![0]).toEqual({});
        });

        it('resets display text to "All time"', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            await wrapper.find('.drp-trigger').trigger('click');
            await wrapper.find('.drp-preset--clear').trigger('click');
            expect(wrapper.find('.drp-label').text()).toBe('All time');
        });
    });

    describe('custom range', () => {
        it('emits custom from/to ISO strings', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');

            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            // from→to sync sets to = from, so explicitly set to afterward
            await inputs[1]!.setValue('2026-02-14 11:00');
            await wrapper.find('.drp-apply').trigger('click');

            const emitted = wrapper.emitted('change');
            expect(emitted).toBeTruthy();
            const range = emitted![0]![0] as { from?: string; to?: string };
            // Default is local time interpretation
            expect(range.from).toBe(new Date(2026, 1, 10, 9, 0).toISOString());
            expect(range.to).toBe(new Date(2026, 1, 14, 11, 0).toISOString());
        });

        it('apply button is disabled when no custom dates set', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-apply').attributes('disabled')).toBeDefined();
        });

        it('apply button is disabled when only one date is valid', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            // Set from to valid, but clear to (override the sync)
            await inputs[0]!.setValue('2026-02-10 09:00');
            await inputs[1]!.setValue('invalid');
            expect(wrapper.find('.drp-apply').attributes('disabled')).toBeDefined();
        });

        it('apply button is enabled when both dates are valid', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            await inputs[1]!.setValue('2026-02-14 11:00');
            expect(wrapper.find('.drp-apply').attributes('disabled')).toBeUndefined();
        });
    });

    describe('from → to sync', () => {
        it('sets to field when from is set to a valid date', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            expect((inputs[1]!.element as HTMLInputElement).value).toBe('2026-02-10 09:00');
        });

        it('does not sync on partial/invalid from input', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[1]!.setValue('2026-02-14 11:00');
            await inputs[0]!.setValue('2026-02');
            // to should remain unchanged
            expect((inputs[1]!.element as HTMLInputElement).value).toBe('2026-02-14 11:00');
        });
    });

    describe('UTC toggle', () => {
        it('defaults to Local mode', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-tz-toggle').text()).toBe('Local');
        });

        it('toggles to UTC and persists', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            await wrapper.find('.drp-tz-toggle').trigger('click');
            expect(wrapper.find('.drp-tz-toggle').text()).toBe('UTC');
            expect(localStorage.getItem('uxrr:date-utc')).toBe('true');
        });

        it('interprets input as UTC when toggled', async () => {
            localStorage.setItem('uxrr:date-utc', 'true');
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            await inputs[1]!.setValue('2026-02-14 11:00');
            await wrapper.find('.drp-apply').trigger('click');

            const emitted = wrapper.emitted('change');
            const range = emitted![0]![0] as { from?: string; to?: string };
            expect(range.from).toBe('2026-02-10T09:00:00.000Z');
            expect(range.to).toBe('2026-02-14T11:00:00.000Z');
        });

        it('converts existing values when toggling', async () => {
            localStorage.setItem('uxrr:date-utc', 'true');
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            await inputs[1]!.setValue('2026-02-14 11:00');
            // Toggle to local — values should convert
            await wrapper.find('.drp-tz-toggle').trigger('click');
            const fromVal = (inputs[0]!.element as HTMLInputElement).value;
            const toVal = (inputs[1]!.element as HTMLInputElement).value;
            // The absolute time is the same, just displayed in local tz
            // We can't assert exact values without knowing the test tz offset,
            // but they should be valid YYYY-MM-DD HH:mm strings
            expect(fromVal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
            expect(toVal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        });
    });

    describe('computeRange()', () => {
        it('returns empty range when nothing selected', () => {
            const wrapper = mountPicker();
            const range = vm(wrapper).computeRange();
            expect(range).toEqual({});
        });

        it('recomputes preset to current now', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[2]!.trigger('click');

            vi.advanceTimersByTime(5 * 60_000);

            const range = vm(wrapper).computeRange();
            const expected = new Date(Date.now() - 60 * 60_000).toISOString();
            expect(range.from).toBe(expected);
        });
    });

    describe('initState()', () => {
        it('sets active preset and display text', async () => {
            const wrapper = mountPicker();
            vm(wrapper).initState({ preset: '24h' });
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.drp-label').text()).toBe('Last 24 hours');
        });

        it('sets custom date range from ISO strings', async () => {
            const wrapper = mountPicker();
            vm(wrapper).initState({
                customFrom: '2026-02-10T09:00:00.000Z',
                customTo: '2026-02-14T11:00:00.000Z'
            });
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.drp-label').text()).not.toBe('All time');
        });

        it('does not sync to from from during initState', async () => {
            const wrapper = mountPicker();
            vm(wrapper).initState({
                customFrom: '2026-02-10T09:00:00.000Z',
                customTo: '2026-02-14T11:00:00.000Z'
            });
            await wrapper.vm.$nextTick();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            const fromVal = (inputs[0]!.element as HTMLInputElement).value;
            const toVal = (inputs[1]!.element as HTMLInputElement).value;
            // from and to should be different (initState preserves both)
            expect(fromVal).not.toBe(toVal);
        });

        it('is a no-op when called with empty object', async () => {
            const wrapper = mountPicker();
            vm(wrapper).initState({});
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.drp-label').text()).toBe('All time');
        });
    });

    describe('getState()', () => {
        it('returns empty object when nothing selected', () => {
            const wrapper = mountPicker();
            const state = vm(wrapper).getState();
            expect(state).toEqual({});
        });

        it('returns preset key when preset is active', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[2]!.trigger('click');
            const state = vm(wrapper).getState();
            expect(state).toEqual({ preset: '1h' });
        });

        it('returns ISO strings for custom range', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10 09:00');
            await inputs[1]!.setValue('2026-02-14 11:00');
            const state = vm(wrapper).getState();
            expect(state.customFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(state.customTo).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('presets list', () => {
        it('renders all 9 presets plus clear button', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            expect(presets.length).toBe(10);
        });

        it('has expected preset labels', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const labels = wrapper.findAll('.drp-preset').map(p => p.text());
            expect(labels).toContain('Last 15 minutes');
            expect(labels).toContain('Last 7 days');
            expect(labels).toContain('Last 30 days');
            expect(labels).toContain('All time');
        });
    });
});
