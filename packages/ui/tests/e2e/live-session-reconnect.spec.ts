import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startStaticServer, getClientSessionId } from './helpers';
import type { Server } from 'http';
import type { Locator, Page, PageScreenshotOptions } from '@playwright/test';
import { statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCREENSHOTS_DIR = 'screenshots';
const STATIC_PORT = 9876;
const UI_BASE_URL = 'http://localhost:8978';
const FIXED_DEVICE_ID = 'e2e-test-device-fixed';
const MIN_NON_BLACK_SCREENSHOT_BYTES = 100_000;

function elapsed(start: number): string {
    return `+${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function countCounterLogs(page: Page): Promise<number> {
    return page.evaluate(() => {
        const entries = document.querySelectorAll('.console-panel .entry-msg');
        return [...entries]
            .map(entry => entry.textContent?.trim())
            .filter((text): text is string => !!text && text.startsWith('Counter:')).length;
    });
}

async function waitForCounterLogsToIncrease(page: Page, baseline: number, timeout = 10000): Promise<void> {
    await page.waitForFunction(
        minCount => {
            const entries = document.querySelectorAll('.console-panel .entry-msg');
            const count = [...entries]
                .map(entry => entry.textContent?.trim())
                .filter(text => !!text && text.startsWith('Counter:')).length;
            return count > minCount;
        },
        baseline,
        { timeout }
    );
}

async function waitForReplayFixtureVisible(page: Page, timeout = 15000): Promise<void> {
    await page.waitForFunction(
        () => {
            const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
            if (!iframe?.contentDocument?.body) return false;
            const body = iframe.contentDocument.body;
            const text = body.textContent ?? '';
            const rect = iframe.getBoundingClientRect();
            return rect.width > 100 && rect.height > 100 && text.includes('UXRR SDK Test Client');
        },
        { timeout }
    );
}

async function waitForReplayFixtureStable(
    page: Page,
    options: { timeout?: number; stableForMs?: number; pollMs?: number } = {}
): Promise<void> {
    const timeout = options.timeout ?? 20000;
    const stableForMs = options.stableForMs ?? 1500;
    const pollMs = options.pollMs ?? 120;
    const deadline = Date.now() + timeout;

    await waitForReplayFixtureVisible(page, timeout);

    let stableSince = Date.now();
    while (Date.now() < deadline) {
        const stillVisible = await page.evaluate(() => {
            const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
            if (!iframe?.contentDocument?.body) return false;
            const body = iframe.contentDocument.body;
            const text = body.textContent ?? '';
            const rect = iframe.getBoundingClientRect();
            return rect.width > 100 && rect.height > 100 && text.includes('UXRR SDK Test Client');
        });

        if (stillVisible) {
            if (Date.now() - stableSince >= stableForMs) return;
        } else {
            stableSince = Date.now();
        }

        await page.waitForTimeout(pollMs);
    }

    throw new Error(`Replay fixture did not remain stable for ${stableForMs}ms before timeout`);
}

function getScreenshotSize(path: string): number {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}

async function captureStableScreenshot(
    page: Page,
    screenshot: PageScreenshotOptions,
    options: { label: string; minBytes?: number; maxAttempts?: number; retryDelayMs?: number } = { label: 'screenshot' }
): Promise<void> {
    const minBytes = options.minBytes ?? MIN_NON_BLACK_SCREENSHOT_BYTES;
    const maxAttempts = options.maxAttempts ?? 6;
    const retryDelayMs = options.retryDelayMs ?? 300;
    const path = screenshot.path;

    if (!path) {
        throw new Error('captureStableScreenshot requires screenshot.path');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await waitForReplayFixtureStable(page, { stableForMs: 1200, timeout: 20000 });
        await page.evaluate(
            () =>
                new Promise<void>(resolve => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                })
        );
        await page.screenshot(screenshot);

        const size = getScreenshotSize(path);
        if (size >= minBytes) {
            if (attempt > 1) {
                console.log(
                    `${options.label}: captured non-black frame on retry ${attempt} (size=${size} bytes, min=${minBytes})`
                );
            }
            return;
        }

        if (attempt < maxAttempts) {
            console.log(
                `${options.label}: screenshot looked blank (size=${size} bytes, min=${minBytes}), retrying (${attempt}/${maxAttempts})`
            );
            await page.waitForTimeout(retryDelayMs);
        }
    }

    throw new Error(
        `${options.label}: screenshot remained blank after ${maxAttempts} attempts (size=${getScreenshotSize(path)} bytes)`
    );
}

/**
 * E2E test for live session rendering and reconnection.
 *
 * PREREQUISITES:
 * 1. API server must be running: cd packages/api && yarn dev:api
 * 2. Client SDK must be built: cd packages/client && yarn build
 *
 * This test verifies that:
 * - Live sessions render correctly when an agent connects
 * - The replay player shows content (not black screen)
 * - Client reconnection works and player re-renders properly
 */
test.describe('Live Session Reconnect (E2E)', () => {
    let staticServer: Server;

    test.beforeAll(() => {
        // Start static server to serve SDK test fixtures
        const fixturesDir = join(__dirname, 'fixtures');
        const clientSdkPath = join(__dirname, '../../../client/dist/index.js');

        const { server } = startStaticServer({
            port: STATIC_PORT,
            fixturesDir,
            clientSdkPath
        });

        staticServer = server;
    });

    test.afterAll(() => {
        if (staticServer) {
            staticServer.close();
        }
    });

    test('live session renders and handles client reconnection', async ({ browser }) => {
        test.setTimeout(120000); // CI environments are slower
        const t0 = Date.now();

        // Create two browser contexts: one for client (SDK), one for agent (UI viewer)
        const clientContext = await browser.newContext({
            viewport: { width: 1280, height: 720 }
        });
        const agentContext = await browser.newContext({
            viewport: { width: 1920, height: 1080 }
        });

        try {
            // ──────────────────────────────────────────────────────────────
            // Phase 1: Initialize client with SDK
            // ──────────────────────────────────────────────────────────────
            const clientPage = await clientContext.newPage();

            // Log client console messages for debugging
            clientPage.on('console', msg => {
                if (msg.text().includes('logger') || msg.text().includes('Counter')) {
                    console.log(`[${elapsed(t0)}] [CLIENT ${msg.type()}]:`, msg.text());
                }
            });

            // Navigate to SDK test page with fixed deviceId
            await clientPage.goto(`http://localhost:${STATIC_PORT}/?deviceId=${FIXED_DEVICE_ID}`);

            // Wait for SDK to initialize and get session ID
            const sessionId = await getClientSessionId(clientPage);
            console.log(`[${elapsed(t0)}] Phase 1: Client initialized with session ID: ${sessionId}`);

            // Perform some actions to generate events
            await clientPage.click('#incrementBtn');
            await clientPage.fill('#textInput', 'Test input for replay');
            await clientPage.click('#logBtn');

            // Wait for first flush to create the session (SDK flushes every 5s)
            // Poll the API to verify the session was created
            console.log(`[${elapsed(t0)}] Waiting for session to be created...`);
            let sessionCreated = false;
            for (let i = 0; i < 20; i++) {
                try {
                    const response = await fetch(`http://localhost:8977/v1/sessions/${sessionId}`);
                    if (response.ok) {
                        sessionCreated = true;
                        console.log(`[${elapsed(t0)}] Session created (poll attempt ${i})`);
                        break;
                    }
                } catch (e) {
                    // Ignore errors and keep polling
                }
                await clientPage.waitForTimeout(500);
            }
            if (!sessionCreated) {
                throw new Error('Session was not created after 10 seconds');
            }

            // ──────────────────────────────────────────────────────────────
            // Phase 2: Agent connects to view live session BEFORE client flushes
            // ──────────────────────────────────────────────────────────────
            console.log(`[${elapsed(t0)}] Phase 2: Agent connecting...`);
            const agentPage = await agentContext.newPage();

            // Note: NOT using clock.install() for live sessions - it breaks WebSocket/async operations
            // Note: Using real API (no mocks) since OIDC is disabled for E2E tests

            // Log ALL console messages
            agentPage.on('console', msg => {
                const text = msg.text();
                if (text.includes('live') || text.includes('ws') || text.includes('WebSocket')) {
                    console.log(`[${elapsed(t0)}] [AGENT ${msg.type()}]:`, text);
                }
                if (msg.type() === 'error' || msg.type() === 'warning') {
                    console.log(`[${elapsed(t0)}] [AGENT ${msg.type()}]:`, text);
                }
            });
            agentPage.on('pageerror', error => {
                console.log(`[${elapsed(t0)}] [PAGE ERROR]:`, error.message);
            });

            // Navigate to session detail page
            await agentPage.goto(`${UI_BASE_URL}/sessions/${sessionId}`);
            console.log(`[${elapsed(t0)}] Agent navigated to session detail`);

            // Wait for the session detail page to load
            await agentPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });
            console.log(`[${elapsed(t0)}] Session detail page loaded`);

            // Wait for LIVE badge (or CONNECTING)
            const liveBadge = agentPage.locator('.live-badge, .badge:has-text("CONNECTING")');
            await expect(liveBadge).toBeVisible({ timeout: 10000 });
            console.log(`[${elapsed(t0)}] Live badge visible`);

            // Agent is now waiting for client. Trigger more client activity to force another flush
            // When client flushes, server will respond with "agent watching" → client upgrades to WS
            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');

            // Wait for the flush to happen and client to upgrade to WebSocket
            console.log(`[${elapsed(t0)}] Waiting for client indicator (WS upgrade)...`);
            const clientIndicator = agentPage.locator('.client-indicator, .status:has-text("connected")');
            await expect(clientIndicator).toBeVisible({ timeout: 10000 });
            console.log(`[${elapsed(t0)}] Client indicator visible`);

            // Verify player is not showing error state
            const errorMessage = agentPage.locator('.error-message, .player-error');
            await expect(errorMessage).not.toBeVisible();

            // Wait for replay player iframe to have content (replaces fixed 3s wait)
            console.log(`[${elapsed(t0)}] Waiting for player iframe...`);
            const playerIframe = agentPage.frameLocator('.replayer-wrapper iframe').first();
            const iframeBody = playerIframe.locator('body');
            await expect(iframeBody).toBeVisible({ timeout: 15000 });
            console.log(`[${elapsed(t0)}] Player iframe body visible`);

            // Poll for actual content (children elements) rather than fixed wait
            await agentPage.waitForFunction(
                () => {
                    const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement;
                    if (!iframe?.contentDocument?.body) return false;
                    const body = iframe.contentDocument.body;
                    return body.children.length > 0 && body.innerHTML.length > 100;
                },
                { timeout: 10000 }
            );
            console.log(`[${elapsed(t0)}] ✓ Replay player has content (not black)`);

            // ──────────────────────────────────────────────────────────────
            // Test console log relay over WebSocket
            // ──────────────────────────────────────────────────────────────
            console.log(`[${elapsed(t0)}] Testing console relay...`);
            const counterBaseline = await countCounterLogs(agentPage);

            // Click increment button - this logs to console
            await clientPage.click('#incrementBtn');

            // Wait for a new log entry after this click.
            await waitForCounterLogsToIncrease(agentPage, counterBaseline, 10000);
            console.log(`[${elapsed(t0)}] ✓ First console log relayed`);

            // Click again to verify second log
            await clientPage.click('#incrementBtn');

            // Wait for one more new log entry after second click.
            await waitForCounterLogsToIncrease(agentPage, counterBaseline + 1, 10000);
            console.log(`[${elapsed(t0)}] ✓ Second console log relayed`);

            // Take screenshot #1 - After console logs
            const screenshotMasks: Locator[] = [
                // Mask the session ID in header
                agentPage.locator('.meta-id'),
                // Mask the session timestamp in header
                agentPage.locator('.meta-time'),
                // Mask ALL console log timestamps
                agentPage.locator('.entry-time'),
                // Mask playback time bar
                agentPage.locator('.playback-time-bar'),
                // Mask playback time values
                agentPage.locator('.playback-time-value')
            ];
            await captureStableScreenshot(
                agentPage,
                {
                    path: `${SCREENSHOTS_DIR}/live-session-with-console-logs.png`,
                    fullPage: true,
                    mask: screenshotMasks
                },
                { label: 'live-session-with-console-logs' }
            );
            console.log(`[${elapsed(t0)}] Screenshot #1 taken`);

            // ──────────────────────────────────────────────────────────────
            // Phase 3: Client reconnects (simulate page reload)
            // ──────────────────────────────────────────────────────────────
            console.log(`[${elapsed(t0)}] Phase 3: Reloading client...`);

            // Reload client page to trigger reconnection
            await clientPage.reload({ waitUntil: 'networkidle' });
            console.log(`[${elapsed(t0)}] Client page reloaded (networkidle)`);

            // Wait for SDK to re-initialize
            const reconnectedSessionId = await getClientSessionId(clientPage);
            console.log(`[${elapsed(t0)}] Client reconnected with session ID: ${reconnectedSessionId}`);

            // Verify it's the same session
            expect(reconnectedSessionId).toBe(sessionId);

            // Perform actions after reconnection
            await clientPage.fill('#textInput', 'After reconnection');

            // ──────────────────────────────────────────────────────────────
            // Phase 4: Verify console relay after reconnection
            // ──────────────────────────────────────────────────────────────
            console.log(`[${elapsed(t0)}] Phase 4: Waiting for client WS reconnect...`);

            // Wait for client to reconnect via WebSocket (needs first HTTP flush at ~5s after reload)
            await expect(clientIndicator).toBeVisible({ timeout: 20000 });
            console.log(`[${elapsed(t0)}] ✓ Client reconnected via WebSocket`);

            // Click increment buttons to generate console logs
            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');

            // Wait for post-reconnect Counter entries to appear, then verify exact values.
            // Counter: 2, 3 arrive via WS relay of the Phase 2 HTTP flush (server relays to watching agent).
            // Counter: 4, 5 are live WS relay. Counter: 1, 2 arrive via WS relay of the reconnect HTTP flush.
            const expectedCounterMessages = ['Counter: 2', 'Counter: 3', 'Counter: 4', 'Counter: 5', 'Counter: 1', 'Counter: 2'];
            console.log(`[${elapsed(t0)}] Waiting for ${expectedCounterMessages.length} Counter entries...`);
            await agentPage.waitForFunction(
                (expected) => {
                    const entries = document.querySelectorAll('.console-panel .entry-msg');
                    const counterMessages = [...entries]
                        .map(e => e.textContent?.trim())
                        .filter(t => t?.startsWith('Counter:'));
                    return counterMessages.length >= expected;
                },
                expectedCounterMessages.length,
                { timeout: 15000 }
            );

            const actualCounterMessages = await agentPage.evaluate(() => {
                const entries = document.querySelectorAll('.console-panel .entry-msg');
                return [...entries]
                    .map(e => e.textContent?.trim())
                    .filter((t): t is string => !!t?.startsWith('Counter:'));
            });
            expect(actualCounterMessages).toEqual(expectedCounterMessages);
            console.log(`[${elapsed(t0)}] ✓ Console counter entries match: [${actualCounterMessages.join(', ')}]`);

            // Verify no error state
            await expect(errorMessage).not.toBeVisible();

            // Verify replay player still has content after reconnection (not black)
            const hasContentAfterReconnect = await playerIframe.locator('body').evaluate((body) => {
                return body.children.length > 0 && body.innerHTML.length > 100;
            });
            if (!hasContentAfterReconnect) {
                throw new Error('Replay player is black after reconnection - content not rendered');
            }
            console.log(`[${elapsed(t0)}] ✓ Replay player still has content after reconnection`);

            // Wait for replay player to reflect post-reconnect state (counter reset to 0, then 2 clicks)
            await agentPage.waitForFunction(
                () => {
                    const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement;
                    if (!iframe?.contentDocument?.body) return false;
                    const counter = iframe.contentDocument.querySelector('#counter');
                    return counter && counter.textContent === '2';
                },
                { timeout: 15000 }
            );
            console.log(`[${elapsed(t0)}] ✓ Replay player shows post-reconnect counter value`);

            // Take screenshot #2 - After reconnection with console logs
            await captureStableScreenshot(
                agentPage,
                {
                    path: `${SCREENSHOTS_DIR}/live-session-after-reconnect.png`,
                    fullPage: true,
                    mask: screenshotMasks
                },
                { label: 'live-session-after-reconnect' }
            );

            console.log(`[${elapsed(t0)}] ✓ All phases complete`);

            // ──────────────────────────────────────────────────────────────
            // Cleanup
            // ──────────────────────────────────────────────────────────────
            await clientPage.close();
            await agentPage.close();

            // Clean up session from database to avoid buildup
            await fetch(`http://localhost:8977/v1/sessions/${sessionId}`, { method: 'DELETE' })
                .catch(() => {
                    // Ignore errors if cleanup fails
                });
        } finally {
            await clientContext.close();
            await agentContext.close();
        }
    });
});
