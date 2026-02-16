import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import NetworkPanel from '@/components/NetworkPanel.vue';
import type { ILogEntry } from '@/openapi-client-generated';

const SESSION_START = 1700000000000;

function makeEntry(overrides: Partial<ILogEntry> & { d?: Record<string, unknown> } = {}): ILogEntry {
    return {
        t: SESSION_START + 1000,
        v: 4,
        c: 'network',
        m: 'GET /api/users 200',
        appId: 'app-1',
        deviceId: 'dev-1',
        sessionId: 'sess-1',
        d: {
            method: 'GET',
            url: 'https://api.example.com/users',
            status: 200,
            duration: 120
        },
        ...overrides
    };
}

const defaultProps = {
    currentTimeMs: 5000,
    sessionStartMs: SESSION_START,
    grafana: null
};

describe('NetworkPanel', () => {
    describe('empty state', () => {
        it('shows empty message when no entries', () => {
            const wrapper = mount(NetworkPanel, {
                props: { entries: [], ...defaultProps }
            });
            expect(wrapper.find('.network-empty').text()).toBe('No network requests yet');
        });

        it('does not render table when empty', () => {
            const wrapper = mount(NetworkPanel, {
                props: { entries: [], ...defaultProps }
            });
            expect(wrapper.find('table').exists()).toBe(false);
        });
    });

    describe('request rendering', () => {
        it('renders network entries as table rows', () => {
            const entries = [makeEntry(), makeEntry({ t: SESSION_START + 2000 })];
            const wrapper = mount(NetworkPanel, {
                props: { entries, ...defaultProps }
            });
            const rows = wrapper.findAll('tbody tr');
            expect(rows.length).toBe(2);
        });

        it('displays method, URL, status, and duration', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [
                        makeEntry({
                            d: { method: 'POST', url: 'https://api.example.com/login', status: 201, duration: 450 }
                        })
                    ],
                    ...defaultProps
                }
            });
            const row = wrapper.find('tbody tr');
            expect(row.find('.col-method').text()).toBe('POST');
            expect(row.find('.col-url').text()).toContain('/login');
            expect(row.find('.col-status').text()).toBe('201');
            expect(row.find('.col-duration').text()).toBe('450ms');
        });

        it('displays request count in toolbar', () => {
            const entries = [
                makeEntry(),
                makeEntry({ t: SESSION_START + 2000 }),
                makeEntry({ t: SESSION_START + 3000 })
            ];
            const wrapper = mount(NetworkPanel, {
                props: { entries, ...defaultProps }
            });
            expect(wrapper.find('.network-count').text()).toBe('3 requests');
        });
    });

    describe('status classes', () => {
        it('applies status-ok for 2xx responses', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ d: { method: 'GET', url: 'http://x.com', status: 200, duration: 10 } })],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-status').classes()).toContain('status-ok');
        });

        it('applies status-redirect for 3xx responses', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ d: { method: 'GET', url: 'http://x.com', status: 301, duration: 10 } })],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-status').classes()).toContain('status-redirect');
        });

        it('applies status-error for 4xx/5xx responses', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ d: { method: 'GET', url: 'http://x.com', status: 500, duration: 10 } })],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-status').classes()).toContain('status-error');
        });
    });

    describe('future entries', () => {
        it('marks entries beyond currentTimeMs as future', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ t: SESSION_START + 10000 })],
                    currentTimeMs: 5000,
                    sessionStartMs: SESSION_START,
                    grafana: null
                }
            });
            expect(wrapper.find('tbody tr').classes()).toContain('future');
        });

        it('does not mark entries before currentTimeMs as future', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ t: SESSION_START + 1000 })],
                    currentTimeMs: 5000,
                    sessionStartMs: SESSION_START,
                    grafana: null
                }
            });
            expect(wrapper.find('tbody tr').classes()).not.toContain('future');
        });
    });

    describe('seek emit', () => {
        it('emits seek with offsetMs when time cell clicked', async () => {
            const entry = makeEntry({ t: SESSION_START + 3000 });
            const wrapper = mount(NetworkPanel, {
                props: { entries: [entry], ...defaultProps }
            });

            await wrapper.find('.col-time--clickable').trigger('click');
            expect(wrapper.emitted('seek')).toBeTruthy();
            expect(wrapper.emitted('seek')![0]).toEqual([3000]);
        });
    });

    describe('duration formatting', () => {
        it('formats milliseconds below 1000', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ d: { method: 'GET', url: 'http://x.com', status: 200, duration: 850 } })],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-duration').text()).toBe('850ms');
        });

        it('formats seconds when >= 1000ms', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry({ d: { method: 'GET', url: 'http://x.com', status: 200, duration: 2500 } })],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-duration').text()).toBe('2.5s');
        });
    });

    describe('expand/collapse detail', () => {
        it('shows detail row when entry with headers is clicked', async () => {
            const entry = makeEntry({
                d: {
                    method: 'POST',
                    url: 'http://x.com/api',
                    status: 200,
                    duration: 100,
                    requestHeaders: { 'Content-Type': 'application/json' }
                }
            });
            const wrapper = mount(NetworkPanel, {
                props: { entries: [entry], ...defaultProps }
            });

            expect(wrapper.find('.detail-row').exists()).toBe(false);
            await wrapper.find('tbody tr.clickable').trigger('click');
            expect(wrapper.find('.detail-row').exists()).toBe(true);
            expect(wrapper.find('.detail-pre').text()).toContain('Content-Type: application/json');
        });

        it('collapses detail row on second click', async () => {
            const entry = makeEntry({
                d: {
                    method: 'POST',
                    url: 'http://x.com/api',
                    status: 200,
                    duration: 100,
                    requestHeaders: { Authorization: 'Bearer xxx' }
                }
            });
            const wrapper = mount(NetworkPanel, {
                props: { entries: [entry], ...defaultProps }
            });

            const row = wrapper.find('tbody tr.clickable');
            await row.trigger('click');
            expect(wrapper.find('.detail-row').exists()).toBe(true);

            await row.trigger('click');
            expect(wrapper.find('.detail-row').exists()).toBe(false);
        });

        it('shows response body in detail', async () => {
            const entry = makeEntry({
                d: {
                    method: 'GET',
                    url: 'http://x.com/api',
                    status: 200,
                    duration: 50,
                    responseBody: '{"result": "ok"}'
                }
            });
            const wrapper = mount(NetworkPanel, {
                props: { entries: [entry], ...defaultProps }
            });

            await wrapper.find('tbody tr.clickable').trigger('click');
            expect(wrapper.find('.detail-pre').text()).toContain('{"result": "ok"}');
        });
    });

    describe('sorting', () => {
        it('sorts entries by timestamp ascending', () => {
            const entries = [
                makeEntry({
                    t: SESSION_START + 3000,
                    d: { method: 'GET', url: 'http://x.com/c', status: 200, duration: 10 }
                }),
                makeEntry({
                    t: SESSION_START + 1000,
                    d: { method: 'GET', url: 'http://x.com/a', status: 200, duration: 10 }
                }),
                makeEntry({
                    t: SESSION_START + 2000,
                    d: { method: 'GET', url: 'http://x.com/b', status: 200, duration: 10 }
                })
            ];
            const wrapper = mount(NetworkPanel, {
                props: { entries, ...defaultProps }
            });
            const urls = wrapper.findAll('.col-url').map(el => el.text());
            expect(urls).toEqual(['/a', '/b', '/c']);
        });
    });

    describe('Grafana trace column', () => {
        it('hides trace column when grafana is null', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [
                        makeEntry({
                            d: { method: 'GET', url: 'http://x.com', status: 200, duration: 10, traceId: 'abc123' }
                        })
                    ],
                    ...defaultProps,
                    grafana: null
                }
            });
            expect(wrapper.find('.col-trace').exists()).toBe(false);
            expect(wrapper.findAll('th').length).toBe(5);
        });

        it('shows trace column and link when grafana is configured', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [
                        makeEntry({
                            d: {
                                method: 'GET',
                                url: 'http://x.com',
                                status: 200,
                                duration: 10,
                                traceId: 'abcdef1234567890'
                            }
                        })
                    ],
                    currentTimeMs: 5000,
                    sessionStartMs: SESSION_START,
                    grafana: { baseUrl: 'https://grafana.example.com', datasource: 'tempo' }
                }
            });
            expect(wrapper.find('.col-trace').exists()).toBe(true);
            const link = wrapper.find('.trace-link');
            expect(link.exists()).toBe(true);
            expect(link.text()).toBe('abcdef12');
            expect(link.attributes('href')).toContain('grafana.example.com');
        });
    });

    describe('table headers', () => {
        it('renders standard column headers', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [makeEntry()],
                    ...defaultProps
                }
            });
            const headers = wrapper.findAll('th').map(th => th.text());
            expect(headers).toEqual(['Time', 'Method', 'URL', 'Status', 'Duration']);
        });
    });

    describe('URL truncation', () => {
        it('shows path and query from full URL', () => {
            const wrapper = mount(NetworkPanel, {
                props: {
                    entries: [
                        makeEntry({
                            d: {
                                method: 'GET',
                                url: 'https://api.example.com/users?page=1&limit=20',
                                status: 200,
                                duration: 50
                            }
                        })
                    ],
                    ...defaultProps
                }
            });
            expect(wrapper.find('.col-url').text()).toBe('/users?page=1&limit=20');
        });
    });

    describe('auto-scroll checkbox', () => {
        it('renders auto-scroll toggle checked by default', () => {
            const wrapper = mount(NetworkPanel, {
                props: { entries: [], ...defaultProps }
            });
            const checkbox = wrapper.find('.autoscroll-toggle input[type="checkbox"]');
            expect(checkbox.exists()).toBe(true);
            expect((checkbox.element as HTMLInputElement).checked).toBe(true);
        });
    });
});
