// The embed bearer token: accepted in the iframe URL exactly as before (/embed?token=, /embed/:id?token=),
// then kept in memory and this frame's history entry, never in the address bar, history URLs, links or
// sessionStorage. The app router is created at import and reads the initial URL then, so each test sets
// the URL first and imports a fresh module graph.
import { flushPromises, mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { useRoute } from 'vue-router';

vi.mock('../logger', () => ({
    createLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} })
}));

vi.mock('../auth', async () => {
    const { reactive, computed } = await import('vue');
    const authState = reactive({ initialized: true, oidcEnabled: false, user: null, error: null, me: null });
    return { authState, isAdmin: computed(() => false), login: vi.fn(), logout: vi.fn() };
});

vi.mock('@zyno-io/vue-foundation', () => ({ OverlayContainer: { render: () => null } }));

const pageSetups: string[] = [];

function stubPage(name: string) {
    return {
        default: defineComponent({
            name,
            setup() {
                const route = useRoute();
                pageSetups.push(`${name}:${String(route.params.id ?? route.params.token ?? '')}`);
                return () => h('div', { class: 'page-stub' }, `${name}:${String(route.params.id ?? route.params.token ?? '')}`);
            }
        })
    };
}

vi.mock('../pages/SessionList.vue', () => stubPage('SessionList'));
vi.mock('../pages/SessionDetail.vue', () => stubPage('SessionDetail'));
vi.mock('../pages/SharedSessionDetail.vue', () => stubPage('SharedSessionDetail'));
vi.mock('../pages/EmbedSessionList.vue', () => stubPage('EmbedSessionList'));
vi.mock('../pages/EmbedSessionDetail.vue', () => stubPage('EmbedSessionDetail'));
vi.mock('../pages/AdminApps.vue', () => stubPage('AdminApps'));
vi.mock('../pages/AdminUsers.vue', () => stubPage('AdminUsers'));
vi.mock('../pages/AdminApiKeys.vue', () => stubPage('AdminApiKeys'));

function base64url(value: string): string {
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TOKEN = `${base64url(JSON.stringify({ scope: 'interactive', apps: ['app-1', 'app-2'] }))}.signature`;
const OTHER_TOKEN = `${base64url(JSON.stringify({ scope: 'readonly', apps: ['app-9'] }))}.other-signature`;
const NO_TOKEN_MESSAGE = "This embedded view can't be opened on its own. Open it from the application it's embedded in.";

function stateToken(): unknown {
    return (window.history.state as Record<string, unknown> | null)?.uxrrEmbedToken;
}

async function freshModules() {
    vi.resetModules();
    const embed = await import('../embed');
    const { router } = await import('../router');
    const App = (await import('../App.vue')).default;
    return { embed, router, App };
}

async function mountApp(App: object, router: import('vue-router').Router) {
    const wrapper = mount(App, {
        global: { plugins: [router], stubs: { ThemeMenu: true, DropdownMenu: true } },
        attachTo: document.body
    });
    await router.isReady();
    await flushPromises();
    return wrapper;
}

function sessionStorageText(): string {
    let text = '';
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!;
        text += key + (sessionStorage.getItem(key) ?? '');
    }
    return text;
}

describe('embed token', () => {
    beforeEach(() => {
        sessionStorage.clear();
        pageSetups.length = 0;
        window.history.replaceState(null, '', '/');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('backward compatible: /embed?token=T&x=1 still opens the list, and ends at /embed?x=1 with the token in memory only', async () => {
        window.history.replaceState(null, '', `/embed?token=${encodeURIComponent(TOKEN)}&x=1`);
        const lengthBefore = window.history.length;
        const { embed, router, App } = await freshModules();

        // main.ts order: router module already imported, then initEmbed, then app.use(router)
        expect(embed.initEmbed()).toBe(true);
        const wrapper = await mountApp(App, router);

        expect(router.currentRoute.value.fullPath).toBe('/embed?x=1');
        expect(window.location.pathname + window.location.search).toBe('/embed?x=1');
        expect(window.location.href).not.toContain('signature');
        expect(window.history.length).toBe(lengthBefore);
        expect(embed.embedState.token).toBe(TOKEN);
        expect(embed.embedState.scope).toBe('interactive');
        expect(stateToken()).toBe(TOKEN);
        expect(sessionStorageText()).not.toContain('signature');
        expect(wrapper.find('.page-stub').text()).toBe('EmbedSessionList:');
        wrapper.unmount();
    });

    it('backward compatible: /embed/:id?token=T still opens that session, with a clean URL', async () => {
        window.history.replaceState(null, '', `/embed/s-1?token=${encodeURIComponent(TOKEN)}`);
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(true);
        const wrapper = await mountApp(App, router);

        expect(router.currentRoute.value.fullPath).toBe('/embed/s-1');
        expect(window.location.href).not.toContain('token');
        expect(embed.embedState.token).toBe(TOKEN);
        expect(stateToken()).toBe(TOKEN);
        expect(wrapper.find('.page-stub').text()).toBe('EmbedSessionDetail:s-1');
        wrapper.unmount();
    });

    it('the router guard alone captures and strips the token (no initEmbed, any import order)', async () => {
        window.history.replaceState(null, '', `/embed?token=${encodeURIComponent(TOKEN)}&userId=u1`);
        const { embed, router, App } = await freshModules();
        const wrapper = await mountApp(App, router);

        expect(router.currentRoute.value.fullPath).toBe('/embed?userId=u1');
        expect(window.location.href).not.toContain('signature');
        expect(embed.embedState.token).toBe(TOKEN);
        expect(stateToken()).toBe(TOKEN);
        wrapper.unmount();
    });

    it('strips a token from an in-app navigation too, without looping', async () => {
        window.history.replaceState({ uxrrEmbedToken: TOKEN }, '', '/embed');
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(true);
        const wrapper = await mountApp(App, router);

        const guardRuns = vi.fn();
        router.beforeEach(() => void guardRuns());
        await router.push(`/embed/s-1?token=${encodeURIComponent(OTHER_TOKEN)}`);
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe('/embed/s-1');
        expect(window.location.href).not.toContain('other-signature');
        expect(JSON.stringify(window.history.state)).not.toContain('other-signature');
        // guards added later only see the token-free redirect, once: the strip does not loop
        expect(guardRuns).toHaveBeenCalledTimes(1);
        expect(embed.embedState.token).toBe(TOKEN);
        wrapper.unmount();
    });

    it('never strips or stamps non-embed routes (main app, share links)', async () => {
        window.history.replaceState(null, '', '/');
        const { embed, router, App } = await freshModules();
        const wrapper = await mountApp(App, router);
        await router.push('/?token=x');
        expect(router.currentRoute.value.fullPath).toBe('/?token=x');
        await router.push('/share/share-token-1');
        expect(router.currentRoute.value.fullPath).toBe('/share/share-token-1');
        expect(stateToken()).toBeUndefined();

        embed.captureEmbedToken(TOKEN);
        await router.push('/sessions/s-1');
        expect(stateToken()).toBeUndefined();
        wrapper.unmount();
    });

    it('a reload (no URL token) initialises from this frame’s history entry', async () => {
        window.history.replaceState({ uxrrEmbedToken: TOKEN }, '', '/embed/s-1');
        const { embed, router, App } = await freshModules();

        expect(embed.initEmbed()).toBe(true);
        expect(embed.embedState.token).toBe(TOKEN);
        expect(embed.embedState.appKeys).toEqual(['app-1', 'app-2']);
        const wrapper = await mountApp(App, router);
        expect(wrapper.find('.embed-unavailable').exists()).toBe(false);
        expect(wrapper.find('.page-stub').text()).toBe('EmbedSessionDetail:s-1');
        wrapper.unmount();
    });

    it('never reads sessionStorage: a token there is ignored', async () => {
        sessionStorage.setItem('uxrr:embed-token', OTHER_TOKEN);
        window.history.replaceState(null, '', '/embed');
        const { embed } = await freshModules();
        expect(embed.initEmbed()).toBe(false);
        expect(embed.embedState.token).toBeNull();
    });

    it('a token in the URL replaces the one in the history entry', async () => {
        window.history.replaceState({ uxrrEmbedToken: OTHER_TOKEN }, '', `/embed?token=${encodeURIComponent(TOKEN)}`);
        const { embed } = await freshModules();
        expect(embed.initEmbed()).toBe(true);
        expect(embed.embedState.token).toBe(TOKEN);
        expect(stateToken()).toBe(TOKEN);
    });

    it('an undecodable URL token does not fall back to a persisted one, now or on reload', async () => {
        window.history.replaceState({ uxrrEmbedToken: OTHER_TOKEN }, '', '/embed?token=garbage');
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(false);
        expect(embed.embedState.token).toBeNull();
        expect(window.location.search).toBe('');
        expect(stateToken()).toBeUndefined();

        const wrapper = await mountApp(App, router);
        expect(embed.embedState.token).toBeNull();
        expect(wrapper.find('.embed-unavailable').exists()).toBe(true);
        wrapper.unmount();
    });

    it('removes a history-state token that no longer decodes', async () => {
        window.history.replaceState({ uxrrEmbedToken: 'not-a-token' }, '', '/embed');
        const { embed } = await freshModules();
        expect(embed.initEmbed()).toBe(false);
        expect(embed.embedState.token).toBeNull();
        expect(stateToken()).toBeUndefined();
    });

    it('re-stamps the new entry when pushing to another embed route; internal links carry no token', async () => {
        window.history.replaceState({ uxrrEmbedToken: TOKEN }, '', '/embed');
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(true);
        const wrapper = await mountApp(App, router);

        await router.push({ name: 'embed-session-detail', params: { id: 's-2' } });
        await flushPromises();
        expect(window.location.pathname + window.location.search).toBe('/embed/s-2');
        expect(stateToken()).toBe(TOKEN);

        await router.push({ name: 'embed-sessions' });
        await flushPromises();
        expect(window.location.pathname + window.location.search).toBe('/embed');
        expect(stateToken()).toBe(TOKEN);

        // Back still works: the previous entry kept its copy
        router.back();
        await new Promise(r => setTimeout(r, 20));
        await flushPromises();
        expect(window.location.pathname).toBe('/embed/s-2');
        expect(stateToken()).toBe(TOKEN);
        wrapper.unmount();
    });

    it('a rejected token is cleared from memory and the history entry, and a clear notice replaces the page', async () => {
        window.history.replaceState({ uxrrEmbedToken: TOKEN }, '', '/embed/s-1');
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(true);
        const wrapper = await mountApp(App, router);

        embed.rejectEmbedToken();
        await flushPromises();
        expect(embed.embedState.token).toBeNull();
        expect(stateToken()).toBeUndefined();
        const notice = wrapper.find('.embed-unavailable');
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toContain('no longer valid');
        expect(notice.text()).not.toContain('signature');
        expect(wrapper.find('.page-stub').exists()).toBe(false);
        wrapper.unmount();

        const reloaded = await freshModules();
        expect(reloaded.embed.initEmbed()).toBe(false);
    });

    it('without any token, an embed route shows the calm message instead of the page', async () => {
        window.history.replaceState(null, '', '/embed/s-1');
        const { embed, router, App } = await freshModules();
        expect(embed.initEmbed()).toBe(false);
        const wrapper = await mountApp(App, router);

        const notice = wrapper.find('.embed-unavailable');
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toBe(NO_TOKEN_MESSAGE);
        expect(notice.find('button').exists()).toBe(false);
        expect(pageSetups).toEqual([]);
        wrapper.unmount();
    });

    it('the token never reaches the document title or any attribute', async () => {
        window.history.replaceState(null, '', `/embed/s-1?token=${encodeURIComponent(TOKEN)}`);
        const { embed, router, App } = await freshModules();
        embed.initEmbed();
        const wrapper = await mountApp(App, router);
        expect(document.title).not.toContain('signature');
        expect(document.documentElement.outerHTML).not.toContain('signature');
        wrapper.unmount();
    });
});
