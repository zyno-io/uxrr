import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import ConsolePanel from '../components/ConsolePanel.vue';
import type { ILogEntry } from '../openapi-client-generated';

function makeLog(overrides: Partial<ILogEntry> = {}): ILogEntry {
    return {
        t: 1700000000000,
        v: 1,
        c: 'auth',
        m: 'User logged in',
        appId: 'app-1',
        deviceId: 'dev-1',
        sessionId: 'sess-1',
        ...overrides
    };
}

function makeNetLog(overrides: Partial<ILogEntry> = {}): ILogEntry {
    return {
        t: 1700000001000,
        v: 0,
        c: 'uxrr:net',
        m: 'GET /api/users',
        d: { method: 'GET', url: 'https://example.com/api/users', status: 200, duration: 45 },
        appId: 'app-1',
        deviceId: 'dev-1',
        sessionId: 'sess-1',
        ...overrides
    };
}

const defaultProps = {
    currentTimeMs: 999999999,
    sessionStartMs: 1700000000000
};

describe('ConsolePanel', () => {
    it('renders empty state with no logs', () => {
        const wrapper = mount(ConsolePanel, {
            props: { logs: [], ...defaultProps }
        });
        expect(wrapper.text()).toContain('No log entries yet');
    });

    it('renders console log entries', () => {
        const logs = [makeLog({ m: 'Hello world', c: 'app' })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });
        expect(wrapper.text()).toContain('Hello world');
        expect(wrapper.text()).toContain('app');
    });

    it('renders log level labels', () => {
        const logs = [
            makeLog({ v: 0, m: 'debug msg' }),
            makeLog({ v: 1, m: 'info msg' }),
            makeLog({ v: 2, m: 'warn msg' }),
            makeLog({ v: 3, m: 'error msg' })
        ];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });
        expect(wrapper.text()).toContain('DEBUG');
        expect(wrapper.text()).toContain('INFO');
        expect(wrapper.text()).toContain('WARN');
        expect(wrapper.text()).toContain('ERROR');
    });

    it('applies correct CSS class for each log level', () => {
        const logs = [makeLog({ v: 0 }), makeLog({ v: 1 }), makeLog({ v: 2 }), makeLog({ v: 3 })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });
        const entries = wrapper.findAll('.console-entry');
        expect(entries[0]!.classes()).toContain('level-debug');
        expect(entries[1]!.classes()).toContain('level-info');
        expect(entries[2]!.classes()).toContain('level-warn');
        expect(entries[3]!.classes()).toContain('level-error');
    });

    it('renders network entries with method and status', () => {
        const logs = [makeNetLog()];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });
        expect(wrapper.text()).toContain('GET');
        expect(wrapper.text()).toContain('200');
        expect(wrapper.text()).toContain('45ms');
    });

    it('applies future class for entries past current replay time', () => {
        const sessionStart = 1700000000000;
        // Entry at sessionStart + 5000ms, but currentTimeMs is only 2000ms
        const logs = [makeLog({ t: sessionStart + 5000 })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, currentTimeMs: 2000, sessionStartMs: sessionStart }
        });
        const entry = wrapper.find('.console-entry');
        expect(entry.classes()).toContain('future');
    });

    it('does not apply future class for entries before current time', () => {
        const sessionStart = 1700000000000;
        const logs = [makeLog({ t: sessionStart + 1000 })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, currentTimeMs: 5000, sessionStartMs: sessionStart }
        });
        const entry = wrapper.find('.console-entry');
        expect(entry.classes()).not.toContain('future');
    });

    it('filters by level — Warn+ hides debug and info', async () => {
        const logs = [
            makeLog({ v: 0, m: 'debug' }),
            makeLog({ v: 1, m: 'info' }),
            makeLog({ v: 2, m: 'warning' }),
            makeLog({ v: 3, m: 'error' })
        ];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });

        // Click "Warn+" filter
        const filterButtons = wrapper.findAll('.filter-chip');
        const warnButton = filterButtons.find(b => b.text() === 'Warn+');
        expect(warnButton).toBeTruthy();
        await warnButton!.trigger('click');

        const entries = wrapper.findAll('.console-entry');
        const texts = entries.map(e => e.text());
        expect(texts.some(t => t.includes('debug'))).toBe(false);
        expect(texts.some(t => t.includes('info'))).toBe(false);
        expect(texts.some(t => t.includes('warning'))).toBe(true);
        expect(texts.some(t => t.includes('error'))).toBe(true);
    });

    it('filters by level — Error shows only errors', async () => {
        const logs = [
            makeLog({ v: 1, m: 'info-msg' }),
            makeLog({ v: 2, m: 'warn-msg' }),
            makeLog({ v: 3, m: 'error-msg' })
        ];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });

        const filterButtons = wrapper.findAll('.filter-chip');
        const errorButton = filterButtons.find(b => b.text() === 'Error');
        await errorButton!.trigger('click');

        const entries = wrapper.findAll('.console-entry');
        expect(entries.length).toBe(1);
        expect(entries[0]!.text()).toContain('error-msg');
    });

    it('network entries pass through level filter', async () => {
        const logs = [
            makeLog({ v: 0, m: 'debug-only' }),
            makeNetLog() // c === 'uxrr:net', v === 0
        ];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });

        // Set filter to Error — network entries should still pass through
        const filterButtons = wrapper.findAll('.filter-chip');
        const errorButton = filterButtons.find(b => b.text() === 'Error');
        await errorButton!.trigger('click');

        const entries = wrapper.findAll('.console-entry');
        // debug-only should be filtered out, but network entry should remain
        expect(entries.length).toBe(1);
        expect(entries[0]!.classes()).toContain('net-entry');
    });

    it('network toggle hides network entries', async () => {
        const logs = [makeLog({ m: 'console-msg' }), makeNetLog()];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });

        // Uncheck the network toggle
        const netCheckbox = wrapper.find('.filter-chip-toggle input');
        await netCheckbox.setValue(false);

        const entries = wrapper.findAll('.console-entry');
        expect(entries.length).toBe(1);
        expect(entries[0]!.text()).toContain('console-msg');
    });

    it('emits seek when timestamp is clicked', async () => {
        const sessionStart = 1700000000000;
        const logs = [makeLog({ t: sessionStart + 3000 })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, currentTimeMs: 999999999, sessionStartMs: sessionStart }
        });

        await wrapper.find('.entry-time--clickable').trigger('click');
        expect(wrapper.emitted('seek')).toBeTruthy();
        expect(wrapper.emitted('seek')![0]![0]).toBe(3000);
    });

    it('displays log data as JSON', () => {
        const logs = [makeLog({ d: { userId: 'u1', action: 'login' } })];
        const wrapper = mount(ConsolePanel, {
            props: { logs, ...defaultProps }
        });
        expect(wrapper.text()).toContain('"userId"');
        expect(wrapper.text()).toContain('"action"');
    });

    it('renders toolbar filter buttons', () => {
        const wrapper = mount(ConsolePanel, {
            props: { logs: [], ...defaultProps }
        });
        const buttons = wrapper.findAll('.filter-chip');
        expect(buttons.map(b => b.text())).toEqual(['All', 'Debug', 'Info+', 'Warn+', 'Error']);
    });

    it('All filter is active by default', () => {
        const wrapper = mount(ConsolePanel, {
            props: { logs: [], ...defaultProps }
        });
        const allButton = wrapper.findAll('.filter-chip').find(b => b.text() === 'All');
        expect(allButton!.classes()).toContain('active');
    });

    it('auto-scrolls when logs are appended in place', async () => {
        const logsRef = ref<ILogEntry[]>([makeLog({ m: 'first' })]);
        const Host = defineComponent({
            components: { ConsolePanel },
            setup() {
                return { logsRef, ...defaultProps };
            },
            template:
                '<ConsolePanel :logs="logsRef" :current-time-ms="currentTimeMs" :session-start-ms="sessionStartMs" />'
        });

        const wrapper = mount(Host);
        const container = wrapper.find('.console-entries').element as HTMLDivElement;

        let scrollTop = 0;
        let scrollHeight = 200;
        Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 100 });
        Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => scrollHeight });
        Object.defineProperty(container, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: value => {
                scrollTop = value as number;
            }
        });

        scrollHeight = 400;
        logsRef.value.push(makeLog({ m: 'second', t: 1700000001000 }));

        await nextTick();
        await nextTick();

        expect(scrollTop).toBe(400);
    });
});
