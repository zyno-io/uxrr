/**
 * Route-mocking helpers for VRT e2e tests.
 * Uses Playwright page.route() to intercept API calls with fixture data.
 */

import type { Page } from '@playwright/test';
import type {
    ISession,
    ILogEntry,
    IChatMessage,
    IRrwebEvent,
    AppResponse,
    UserResponse,
    ApiKeyResponse,
    AuthConfigResponse,
    MeResponse
} from '../../src/openapi-client-generated';

function json(page: Page, urlPattern: string | RegExp, body: unknown, status = 200) {
    return page.route(urlPattern, route =>
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body)
        })
    );
}

// ─── Auth ────────────────────────────────────────────────────────────
export function mockAuthRoutes(page: Page, config: AuthConfigResponse, me: MeResponse) {
    return Promise.all([
        json(page, '**/v1/auth/config', config),
        json(page, '**/v1/auth/me', me),
        json(page, '**/v1/auth/ws-token', { token: 'e2e-ws-token' })
    ]);
}

// ─── Session List ────────────────────────────────────────────────────
export function mockSessionListRoutes(page: Page, sessions: ISession[]) {
    return Promise.all([
        json(page, '**/v1/sessions?*', sessions),
        // Also match bare /v1/sessions with no query string
        page.route('**/v1/sessions', route => {
            const url = route.request().url();
            // Only handle if it's the list endpoint (GET, no sub-path like /watch or /autocomplete)
            if (route.request().method() === 'GET' && !url.includes('/autocomplete') && !url.includes('/watch')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(sessions)
                });
            }
            return route.fallback();
        }),
        json(page, '**/v1/sessions/autocomplete/appIds*', ['my-app', 'other-app']),
        json(page, '**/v1/sessions/autocomplete/deviceIds*', []),
        json(page, '**/v1/sessions/autocomplete/users*', [])
    ]);
}

// ─── Session Detail ──────────────────────────────────────────────────
export function mockSessionDetailRoutes(
    page: Page,
    opts: {
        session: ISession;
        events?: IRrwebEvent[];
        logs?: ILogEntry[];
        chat?: IChatMessage[];
    }
) {
    const id = opts.session.id;
    return Promise.all([
        // Match GET /v1/sessions/:id (but not /v1/sessions/:id/events etc.)
        page.route(`**/v1/sessions/${id}`, route => {
            const url = route.request().url();
            const path = new URL(url).pathname;
            // Only fulfill if it's exactly /v1/sessions/:id (no trailing sub-path)
            if (path === `/v1/sessions/${id}`) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(opts.session)
                });
            }
            return route.fallback();
        }),
        json(page, `**/v1/sessions/${id}/events`, opts.events ?? []),
        json(page, `**/v1/sessions/${id}/logs`, opts.logs ?? []),
        json(page, `**/v1/sessions/${id}/chat`, opts.chat ?? []),
        json(page, `**/v1/sessions/${id}/share`, { active: false })
    ]);
}

// ─── Admin ───────────────────────────────────────────────────────────
export function mockAdminRoutes(
    page: Page,
    opts: {
        apps?: AppResponse[];
        users?: UserResponse[];
        keys?: ApiKeyResponse[];
    }
) {
    return Promise.all([
        json(page, '**/v1/admin/apps', opts.apps ?? []),
        json(page, '**/v1/admin/users', opts.users ?? []),
        json(page, '**/v1/api-keys', opts.keys ?? [])
    ]);
}

// ─── WebSocket ───────────────────────────────────────────────────────
/** Abort WebSocket upgrade requests to prevent connection errors. */
export function mockWebSocket(page: Page) {
    return Promise.all([
        page.routeWebSocket('**/v1/sessions/watch**', ws => ws.close()),
        page.routeWebSocket('**/v1/sessions/*/live**', ws => ws.close())
    ]);
}

/**
 * Mock the live session WebSocket using Playwright's routeWebSocket().
 * Sends client_connected, rrweb events, start_chat, and chat messages
 * in sequence to simulate an active live session with chat.
 */
export async function mockLiveWebSocket(
    page: Page,
    opts: {
        events: IRrwebEvent[];
        chatMessages: { message: string; from: string }[];
    }
) {
    // Abort the session list watch WS
    await page.routeWebSocket('**/v1/sessions/watch**', ws => {
        ws.close();
    });

    // Mock the live session WS with simulated messages
    await page.routeWebSocket('**/v1/sessions/*/live**', ws => {
        const send = (data: unknown) => ws.send(JSON.stringify(data));

        // Simulate: client connects
        setTimeout(() => send({ type: 'client_connected' }), 100);

        // Simulate: rrweb events with full snapshot (makes player ready)
        setTimeout(() => send({ type: 'events', data: opts.events }), 200);

        // Simulate: chat starts
        setTimeout(() => send({ type: 'start_chat' }), 400);

        // Simulate: chat messages arrive
        opts.chatMessages.forEach((msg, i) => {
            setTimeout(() => send({ type: 'chat', message: msg.message, from: msg.from }), 500 + i * 150);
        });
    });
}

// ─── Combined Setup ──────────────────────────────────────────────────
/** Standard mock setup for most tests: auth + WS suppression. */
export function setupBaseMocks(page: Page, config: AuthConfigResponse, me: MeResponse) {
    return Promise.all([mockAuthRoutes(page, config, me), mockWebSocket(page)]);
}

// ─── Screenshot Assertions ──────────────────────────────────────────
import { statSync } from 'fs';

/**
 * Assert a screenshot file meets a minimum size threshold.
 * Use after every page.screenshot() to catch blank/black renders
 * before they reach VRT in CI.
 */
export function expectMinScreenshotSize(path: string, minBytes: number): void {
    const size = statSync(path).size;
    if (size < minBytes) {
        throw new Error(
            `Screenshot too small: ${path} is ${size} bytes (min ${minBytes}). ` +
                'This usually means the page rendered blank or an rrweb player was black.'
        );
    }
}

// ─── E2E Live Session Helpers ────────────────────────────────────────
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { Server } from 'http';

interface StaticServerOptions {
    port: number;
    fixturesDir: string;
    clientSdkPath: string;
}

/**
 * Start a static HTTP server to serve SDK test fixtures.
 * Maps /client-sdk.js to the built SDK bundle.
 * Returns the server instance and base URL.
 */
export function startStaticServer(opts: StaticServerOptions): { server: Server; baseUrl: string } {
    const server = createServer((req, res) => {
        const fullUrl = req.url || '/';
        // Strip query string for file resolution
        const url = fullUrl.split('?')[0];

        // Map /client-sdk.js to the built SDK bundle
        if (url === '/client-sdk.js') {
            if (!existsSync(opts.clientSdkPath)) {
                res.writeHead(404);
                res.end('SDK bundle not found. Run: cd packages/client && yarn build');
                return;
            }
            const content = readFileSync(opts.clientSdkPath, 'utf-8');
            res.writeHead(200, {
                'Content-Type': 'application/javascript',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
            return;
        }

        // Serve fixture files
        const filePath = url === '/' ? join(opts.fixturesDir, 'sdk-client.html') : join(opts.fixturesDir, url);

        if (!existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = extname(filePath);
        const contentTypes: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json'
        };

        const content = readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(content);
    });

    server.listen(opts.port);
    return {
        server,
        baseUrl: `http://localhost:${opts.port}`
    };
}

/**
 * Extract session ID from the SDK test client page.
 * Waits for SDK initialization and returns the session ID.
 */
export async function getClientSessionId(page: Page): Promise<string> {
    await page.waitForFunction(
        () => {
            const state = (window as any).uxrrState;
            return state && state.ready && state.sessionId;
        },
        { timeout: 10000 }
    );

    return page.evaluate(() => (window as any).uxrrState.sessionId);
}

/**
 * Wait for the rrweb replay player iframe to render with content.
 * This checks that:
 * 1. The iframe element exists
 * 2. The iframe has a valid src or srcdoc
 * 3. The iframe document has meaningful content (not blank)
 */
export async function waitForPlayerIframe(page: Page, options: { timeout?: number } = {}) {
    const timeout = options.timeout || 15000;

    await page.waitForFunction(
        () => {
            const iframe = document.querySelector('.replayer-wrapper iframe');
            if (!iframe) return false;

            try {
                const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
                if (!iframeDoc) return false;

                // Check if the iframe has actual content (body with children)
                const body = iframeDoc.body;
                if (!body || body.children.length === 0) return false;

                // Check for the rrweb replay container
                const replayRoot = body.querySelector('.replayer-mouse, [data-rrweb-id]');
                return !!replayRoot;
            } catch (e) {
                // Cross-origin or not ready yet
                return false;
            }
        },
        { timeout }
    );
}
