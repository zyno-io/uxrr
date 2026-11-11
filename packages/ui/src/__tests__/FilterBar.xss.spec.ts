// FilterBar with the real VfSmartSelect: names, emails and ids come from customer apps (the public
// ingest endpoint) or the URL, and must never be parsed as HTML on the dashboard origin.
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';

import FilterBar from '../components/FilterBar.vue';

vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} })
}));

vi.mock('@zyno-io/openapi-client-codegen', () => ({
    dataFrom: (v: unknown) => v
}));

const MARKUP_NAME = '<img id="pwn" src=x>';
const MARKUP_EMAIL = '<img id="pwn-mail" src=x>@evil.test';
const MARKUP_APP = '<img id="pwn-app" src=x>';

vi.mock('@/openapi-client-generated', () => ({
    SessionApi: {
        getSessionAutocompleteAppKeys: vi.fn(async () => [MARKUP_APP]),
        getSessionAutocompleteUsers: vi.fn(async () => [{ userId: 'u-1', userName: MARKUP_NAME, userEmail: MARKUP_EMAIL }]),
        getSessionAutocompleteDeviceIds: vi.fn(async () => ['dev-1'])
    }
}));

vi.mock('../components/DateRangePicker.vue', () => ({
    default: {
        name: 'DateRangePicker',
        emits: ['change'],
        setup(_: unknown, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
            expose({ computeRange: () => ({}), initState: () => {}, getState: () => ({}) });
        },
        template: '<div />'
    }
}));

async function openSelect(input: HTMLInputElement) {
    input.dispatchEvent(new FocusEvent('focus'));
    await flushPromises();
    // the options list is teleported to <body> on a timer
    await new Promise(r => setTimeout(r, 10));
    await flushPromises();
}

function injected(): Element | null {
    return document.querySelector('img#pwn, img#pwn-mail, img#pwn-app, img#pwn-url');
}

describe('FilterBar option rendering (real VfSmartSelect)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('shows a user named with markup as text, never as an element', async () => {
        const wrapper = mount(FilterBar, { attachTo: document.body });
        await flushPromises();
        const userInput = wrapper.findAll<HTMLInputElement>('.filter-select input')[1]!.element;
        await openSelect(userInput);

        const options = document.querySelector('.vf-smart-select-options');
        expect(options).not.toBeNull();
        expect(injected()).toBeNull();
        const titles = Array.from(document.querySelectorAll('.vf-smart-select-options .title')).map(el => el.textContent);
        const subtitles = Array.from(document.querySelectorAll('.vf-smart-select-options .subtitle')).map(el => el.textContent);
        expect(titles).toContain(MARKUP_NAME);
        expect(subtitles).toContain(MARKUP_EMAIL);
        wrapper.unmount();
    });

    it('shows an app key with markup as text', async () => {
        const wrapper = mount(FilterBar, { attachTo: document.body });
        await flushPromises();
        await openSelect(wrapper.findAll<HTMLInputElement>('.filter-select input')[0]!.element);
        expect(injected()).toBeNull();
        const titles = Array.from(document.querySelectorAll('.vf-smart-select-options .title')).map(el => el.textContent);
        expect(titles).toContain(MARKUP_APP);
        wrapper.unmount();
    });

    it('shows the raw name (not escaped entities) in the field once selected', async () => {
        const wrapper = mount(FilterBar, { attachTo: document.body });
        await flushPromises();
        (wrapper.vm as unknown as { setFilter(key: string, value: string): void }).setFilter('userId', 'u-1');
        await flushPromises();
        await new Promise(r => setTimeout(r, 10));
        const userInput = wrapper.findAll<HTMLInputElement>('.filter-select input')[1]!.element;
        expect(userInput.value).toBe(MARKUP_NAME);
        expect(userInput.value).not.toContain('&lt;');
        wrapper.unmount();
    });

    it('renders a user id injected from the URL as text', async () => {
        const wrapper = mount(FilterBar, { attachTo: document.body });
        await flushPromises();
        // a crafted /?userId=… link: the value is injected into the options list and must render as text
        (wrapper.vm as unknown as { initFilters(p: Record<string, string>): void }).initFilters({ userId: '<img id="pwn-url" src=x>' });
        await flushPromises();
        await new Promise(r => setTimeout(r, 10));
        const userInput = wrapper.findAll<HTMLInputElement>('.filter-select input')[1]!.element;
        expect(userInput.value).toBe('<img id="pwn-url" src=x>');
        await openSelect(userInput);
        expect(injected()).toBeNull();
        const titles = Array.from(document.querySelectorAll('.vf-smart-select-options .title')).map(el => el.textContent);
        expect(titles).toContain('<img id="pwn-url" src=x>');
        wrapper.unmount();
    });

    it('typing a search (mark.js highlighting) adds no elements', async () => {
        const wrapper = mount(FilterBar, { attachTo: document.body });
        await flushPromises();
        const userInput = wrapper.findAll<HTMLInputElement>('.filter-select input')[1]!.element;
        await openSelect(userInput);
        userInput.value = 'img';
        userInput.dispatchEvent(new Event('input'));
        await flushPromises();
        await new Promise(r => setTimeout(r, 400));
        await flushPromises();
        expect(injected()).toBeNull();
        expect(document.querySelectorAll('.vf-smart-select-options img').length).toBe(0);
        wrapper.unmount();
    });
});
