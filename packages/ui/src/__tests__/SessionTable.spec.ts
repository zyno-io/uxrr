import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionTable from '../components/SessionTable.vue';
import type { ISession } from '../openapi-client-generated';

const global = { directives: { duration: {} } };

function makeSession(overrides: Partial<ISession> = {}): ISession {
    const now = new Date().toISOString();
    return {
        id: 'abc12345-6789-0123-4567-890abcdef012',
        appId: 'my-app',
        deviceId: 'dev-abcdef12',
        startedAt: now,
        lastActivityAt: now,
        eventChunkCount: 5,
        eventBytesStored: 0,
        hasChatMessages: false,
        createdAt: now,
        updatedAt: now,
        allUserIds: [],
        isLive: false,
        ...overrides
    };
}

describe('SessionTable', () => {
    it('renders loading state', () => {
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [], loading: true, error: null }
        });
        expect(wrapper.text()).toContain('Loading sessions...');
    });

    it('renders error state', () => {
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [], loading: false, error: 'Connection failed' }
        });
        expect(wrapper.text()).toContain('Connection failed');
    });

    it('renders empty state', () => {
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [], loading: false, error: null }
        });
        expect(wrapper.text()).toContain('No sessions found');
    });

    it('renders session rows', () => {
        const sessions = [
            makeSession({ id: 'sess-0001-0000-0000-000000000001', appId: 'app-a' }),
            makeSession({ id: 'sess-0002-0000-0000-000000000002', appId: 'app-b' })
        ];
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions, loading: false, error: null }
        });

        const rows = wrapper.findAll('tbody tr');
        expect(rows.length).toBe(2);
        expect(rows[0]!.text()).toContain('sess-000');
        expect(rows[0]!.text()).toContain('app-a');
        expect(rows[1]!.text()).toContain('app-b');
    });

    it('emits select when row is clicked', async () => {
        const session = makeSession();
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });

        await wrapper.find('tbody tr').trigger('click');
        expect(wrapper.emitted('select')).toBeTruthy();
        expect(wrapper.emitted('select')![0]![0]).toEqual(session);
    });

    it('shows LIVE badge for live sessions', () => {
        const session = makeSession({ isLive: true });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        expect(wrapper.find('.live-badge').exists()).toBe(true);
        expect(wrapper.find('.live-badge').text()).toBe('LIVE');
    });

    it('does not show LIVE badge for non-live sessions', () => {
        const session = makeSession({ isLive: false });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        expect(wrapper.find('.live-badge').exists()).toBe(false);
    });

    it('shows chat badge when hasChatMessages is true', () => {
        const session = makeSession({ hasChatMessages: true });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        expect(wrapper.find('.chat-badge').exists()).toBe(true);
    });

    it('displays user name when available', () => {
        const session = makeSession({ userId: 'u1', userName: 'John Doe' });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        expect(wrapper.text()).toContain('John Doe');
    });

    it('displays dash when no userId', () => {
        const session = makeSession({ userId: undefined });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        // The user column should contain a dash
        const rows = wrapper.findAll('tbody td');
        const userCell = rows[3]; // 4th column is User
        expect(userCell!.text()).toBe('-');
    });

    it('emits filterByApp when app cell is clicked', async () => {
        const session = makeSession({ appId: 'test-app' });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });

        const appFilter = wrapper.findAll('.clickable-filter').filter(el => el.text() === 'test-app')[0];
        await appFilter!.trigger('click');
        expect(wrapper.emitted('filterByApp')).toBeTruthy();
        expect(wrapper.emitted('filterByApp')![0]![0]).toBe('test-app');
    });

    it('emits filterByDevice when device cell is clicked', async () => {
        const session = makeSession({ deviceId: 'dev-abcdef123456' });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });

        const deviceFilter = wrapper.findAll('.clickable-filter').filter(el => el.text() === 'dev-abcd')[0];
        await deviceFilter!.trigger('click');
        expect(wrapper.emitted('filterByDevice')).toBeTruthy();
        expect(wrapper.emitted('filterByDevice')![0]![0]).toBe('dev-abcdef123456');
    });

    it('renders table headers', () => {
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [], loading: false, error: null }
        });
        const headers = wrapper.findAll('th');
        expect(headers.map(h => h.text())).toEqual([
            'Session',
            'Time',
            'Duration',
            'User',
            'Device',
            'App',
            'Version',
            'Env'
        ]);
    });

    it('displays version and environment', () => {
        const session = makeSession({ version: '2.1.0', environment: 'staging' });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        expect(wrapper.text()).toContain('2.1.0');
        expect(wrapper.text()).toContain('staging');
    });

    it('displays dash for missing version/environment', () => {
        const session = makeSession({ version: undefined, environment: undefined });
        const wrapper = mount(SessionTable, {
            global,
            props: { sessions: [session], loading: false, error: null }
        });
        const row = wrapper.find('tbody tr');
        const cells = row.findAll('td');
        expect(cells[6]!.text()).toBe('-'); // version
        expect(cells[7]!.text()).toBe('-'); // environment
    });
});
