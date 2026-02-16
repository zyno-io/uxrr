import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@zyno-io/vue-foundation', () => ({
    showToast: vi.fn()
}));

import UserInfoPopover from '@/components/UserInfoPopover.vue';

// Stub navigator.clipboard in happy-dom
const writeTextMock = vi.fn(() => Promise.resolve());
Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true
});

beforeEach(() => {
    writeTextMock.mockClear();
});

describe('UserInfoPopover', () => {
    describe('popover visibility', () => {
        it('does not show popover by default', () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userName: 'Alice' },
                slots: { default: '<span class="trigger">User</span>' }
            });
            expect(wrapper.find('.user-popover').exists()).toBe(false);
        });

        it('shows popover on mouseenter', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userName: 'Alice' },
                slots: { default: '<span class="trigger">User</span>' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            expect(wrapper.find('.user-popover').exists()).toBe(true);
        });

        it('hides popover on mouseleave after delay', async () => {
            vi.useFakeTimers();
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userName: 'Alice' },
                slots: { default: '<span class="trigger">User</span>' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            expect(wrapper.find('.user-popover').exists()).toBe(true);

            await wrapper.find('.user-popover-anchor').trigger('mouseleave');
            // Still visible before timeout
            expect(wrapper.find('.user-popover').exists()).toBe(true);

            vi.advanceTimersByTime(200);
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.user-popover').exists()).toBe(false);
            vi.useRealTimers();
        });
    });

    describe('user info display', () => {
        it('shows user name when provided', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userName: 'Alice', userEmail: 'alice@example.com' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const rows = wrapper.findAll('.user-popover-row');
            const nameRow = rows.find(r => r.find('.user-popover-label').text() === 'Name');
            expect(nameRow).toBeTruthy();
            expect(nameRow!.find('.user-popover-value').text()).toBe('Alice');
        });

        it('shows email when provided', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userEmail: 'alice@example.com' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const rows = wrapper.findAll('.user-popover-row');
            const emailRow = rows.find(r => r.find('.user-popover-label').text() === 'Email');
            expect(emailRow).toBeTruthy();
            expect(emailRow!.find('.user-popover-value').text()).toBe('alice@example.com');
        });

        it('shows user ID when provided', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-123' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const rows = wrapper.findAll('.user-popover-row');
            const idRow = rows.find(r => r.find('.user-popover-label').text() === 'ID');
            expect(idRow).toBeTruthy();
            expect(idRow!.find('.user-popover-value').text()).toBe('u-123');
        });

        it('hides name row when userName not provided', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const rows = wrapper.findAll('.user-popover-row');
            const nameRow = rows.find(r => r.find('.user-popover-label').text() === 'Name');
            expect(nameRow).toBeUndefined();
        });
    });

    describe('copy to clipboard', () => {
        it('copies email on click and shows toast', async () => {
            const { showToast } = await import('@zyno-io/vue-foundation');
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1', userEmail: 'alice@example.com' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const emailRow = wrapper
                .findAll('.user-popover-row')
                .find(r => r.find('.user-popover-label').text() === 'Email');
            await emailRow!.find('.user-popover-copyable').trigger('click');

            expect(writeTextMock).toHaveBeenCalledWith('alice@example.com');
            expect(showToast).toHaveBeenCalledWith({
                message: 'Copied to clipboard',
                durationSecs: 2
            });
        });

        it('copies userId on click', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-abc' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            const idRow = wrapper.findAll('.user-popover-row').find(r => r.find('.user-popover-label').text() === 'ID');
            await idRow!.find('.user-popover-copyable').trigger('click');

            expect(writeTextMock).toHaveBeenCalledWith('u-abc');
        });
    });

    describe('filter button', () => {
        it('shows "View all sessions" button when userId provided', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            expect(wrapper.find('.user-popover-btn').exists()).toBe(true);
            expect(wrapper.find('.user-popover-btn').text()).toBe('View all sessions');
        });

        it('hides button when no userId', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userName: 'Alice' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            expect(wrapper.find('.user-popover-btn').exists()).toBe(false);
        });

        it('emits filter with userId when button clicked', async () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-42' },
                slots: { default: 'User' }
            });

            await wrapper.find('.user-popover-anchor').trigger('mouseenter');
            await wrapper.find('.user-popover-btn').trigger('click');

            expect(wrapper.emitted('filter')).toBeTruthy();
            expect(wrapper.emitted('filter')![0]).toEqual(['u-42']);
        });
    });

    describe('slot rendering', () => {
        it('renders default slot content as anchor', () => {
            const wrapper = mount(UserInfoPopover, {
                props: { userId: 'u-1' },
                slots: { default: '<span class="my-trigger">Click me</span>' }
            });
            expect(wrapper.find('.my-trigger').text()).toBe('Click me');
        });
    });
});
