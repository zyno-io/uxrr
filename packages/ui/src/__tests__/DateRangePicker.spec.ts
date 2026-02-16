import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DateRangePicker from '../components/DateRangePicker.vue';

describe('DateRangePicker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function mountPicker() {
        return mount(DateRangePicker);
    }

    describe('display text', () => {
        it('shows "All time" by default', () => {
            const wrapper = mountPicker();
            expect(wrapper.find('.drp-label').text()).toBe('All time');
        });

        it('shows preset label after selecting a preset', async () => {
            const wrapper = mountPicker();
            // Open dropdown
            await wrapper.find('.drp-trigger').trigger('click');
            // Select "Last 1 hour"
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
            // Select a preset first
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            // Re-open and click "All time" (clear button)
            await wrapper.find('.drp-trigger').trigger('click');
            const clearBtn = wrapper.find('.drp-preset--clear');
            expect(clearBtn.text()).toBe('All time');
            await clearBtn.trigger('click');

            const emitted = wrapper.emitted('change')!;
            // Last emission should be empty
            expect(emitted[emitted.length - 1]![0]).toEqual({});
        });

        it('resets display text to "All time"', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            await presets[0]!.trigger('click');
            // Re-open and clear
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
            await inputs[0]!.setValue('2026-02-10T09:00');
            await inputs[1]!.setValue('2026-02-14T11:00');
            await wrapper.find('.drp-apply').trigger('click');

            const emitted = wrapper.emitted('change');
            expect(emitted).toBeTruthy();
            const range = emitted![0]![0] as { from?: string; to?: string };
            expect(range.from).toBe(new Date('2026-02-10T09:00').toISOString());
            expect(range.to).toBe(new Date('2026-02-14T11:00').toISOString());
        });

        it('apply button is disabled when no custom dates set', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            expect(wrapper.find('.drp-apply').attributes('disabled')).toBeDefined();
        });

        it('apply button is enabled when at least from is set', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const inputs = wrapper.findAll('.drp-input');
            await inputs[0]!.setValue('2026-02-10T09:00');
            expect(wrapper.find('.drp-apply').attributes('disabled')).toBeUndefined();
        });
    });

    describe('computeRange()', () => {
        it('returns empty range when nothing selected', () => {
            const wrapper = mountPicker();
            const range = (wrapper.vm as unknown as { computeRange(): Record<string, string> }).computeRange();
            expect(range).toEqual({});
        });

        it('recomputes preset to current now', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            // Select "Last 1 hour"
            await presets[2]!.trigger('click');

            // Advance time by 5 minutes
            vi.advanceTimersByTime(5 * 60_000);

            const range = (wrapper.vm as unknown as { computeRange(): Record<string, string> }).computeRange();
            // from should be 1h before the new now
            const expected = new Date(Date.now() - 60 * 60_000).toISOString();
            expect(range.from).toBe(expected);
        });
    });

    describe('presets list', () => {
        it('renders all 9 presets plus clear button', async () => {
            const wrapper = mountPicker();
            await wrapper.find('.drp-trigger').trigger('click');
            const presets = wrapper.findAll('.drp-preset');
            // 9 presets + 1 "All time" clear button = 10
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
