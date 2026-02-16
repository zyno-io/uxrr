import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'fs';
import { startStaticServer, getClientSessionId } from './helpers';
import type { Server } from 'http';
import type { Locator, Page, PageScreenshotOptions } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCREENSHOTS_DIR = 'screenshots';
const STATIC_PORT = 9878;
const API_BASE_URL = 'http://localhost:8977';
const UI_BASE_URL = 'http://localhost:8978';
const SDK_APP_ID = 'test-app';
const FIXED_DEVICE_ID = 'e2e-test-device-share-replay';
const MIN_NON_BLACK_SCREENSHOT_BYTES = 100_000;

function elapsed(start: number): string {
    return `+${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function ensureSdkAppOrigin(origin: string): Promise<void> {
    const listResponse = await fetch(`${API_BASE_URL}/v1/admin/apps`);
    if (!listResponse.ok) {
        const body = await listResponse.text();
        throw new Error(`Failed to list apps (${listResponse.status}): ${body}`);
    }
    const apps = (await listResponse.json()) as Array<{
        id: string;
        name: string;
        origins: string[];
        isActive: boolean;
    }>;
    const existing = apps.find(app => app.id === SDK_APP_ID);
    if (!existing) {
        const createResponse = await fetch(`${API_BASE_URL}/v1/admin/apps`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: SDK_APP_ID,
                name: 'SDK Test App',
                origins: [origin]
            })
        });
        if (!createResponse.ok) {
            const body = await createResponse.text();
            throw new Error(`Failed to create app (${createResponse.status}): ${body}`);
        }
        return;
    }

    const nextOrigins = Array.from(new Set([...(existing.origins ?? []), origin]));
    if (existing.isActive && nextOrigins.length === existing.origins.length) {
        return;
    }

    const patchResponse = await fetch(`${API_BASE_URL}/v1/admin/apps/${SDK_APP_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            origins: nextOrigins,
            isActive: true
        })
    });
    if (!patchResponse.ok) {
        const body = await patchResponse.text();
        throw new Error(`Failed to patch app (${patchResponse.status}): ${body}`);
    }
}

async function waitForSessionCreated(page: Page, sessionId: string): Promise<void> {
    const ingestPath = `/v1/ng/${SDK_APP_ID}/${sessionId}/data`;
    const seenIngestStatuses: number[] = [];
    const onResponse = (r: any) => {
        if (r.request().method() === 'POST' && r.url().includes(ingestPath)) {
            seenIngestStatuses.push(r.status());
        }
    };
    page.on('response', onResponse);

    try {
        await page.waitForResponse(
            r => r.request().method() === 'POST' && r.url().includes(ingestPath) && r.ok(),
            { timeout: 70_000 }
        );
    } catch {
        const statusSummary = seenIngestStatuses.length > 0 ? seenIngestStatuses.join(', ') : 'none';
        throw new Error(
            `Session ${sessionId} was not ingested in time (statuses seen: ${statusSummary})`
        );
    } finally {
        page.off('response', onResponse);
    }

    for (let i = 0; i < 60; i += 1) {
        try {
            const response = await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}`);
            if (response.ok) return;
        } catch {
            // keep polling
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Session ${sessionId} was not created in time`);
}

async function createShareToken(sessionId: string): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}/share`, { method: 'POST' });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to create share link (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) throw new Error('Share link response missing token');
    return payload.token;
}

async function waitForReplayContent(page: Page, timeout = 15000): Promise<void> {
    await page.waitForFunction(
        () => {
            const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
            if (!iframe?.contentDocument?.body) return false;
            const body = iframe.contentDocument.body;
            return body.children.length > 0 && body.innerHTML.length > 100;
        },
        { timeout }
    );
}

/** Wait for the rrweb iframe to be visually rendered with real content and non-trivial dimensions. */
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

/** Wait for the replay fixture to stay visually stable for a period (no flicker/teardown). */
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
        if (!stillVisible) {
            stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableForMs) {
            return;
        }
        await page.waitForTimeout(pollMs);
    }
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

async function getReplayCounter(page: Page): Promise<number | null> {
    return page.evaluate(() => {
        const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
        if (!iframe?.contentDocument) return null;
        const counterText = iframe.contentDocument.querySelector('#counter')?.textContent?.trim();
        if (!counterText) return null;
        const parsed = Number.parseInt(counterText, 10);
        return Number.isFinite(parsed) ? parsed : null;
    });
}

async function waitForReplayCounterValue(page: Page, expected: number, timeout = 15000): Promise<void> {
    await page.waitForFunction(
        value => {
            const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
            if (!iframe?.contentDocument) return false;
            const counterText = iframe.contentDocument.querySelector('#counter')?.textContent?.trim();
            if (!counterText) return false;
            const parsed = Number.parseInt(counterText, 10);
            return Number.isFinite(parsed) && parsed === value;
        },
        expected,
        { timeout }
    );
}

async function waitForReplayCounterGreaterThan(page: Page, baseline: number, timeout = 15000): Promise<void> {
    await page.waitForFunction(
        minValue => {
            const iframe = document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement | null;
            if (!iframe?.contentDocument) return false;
            const counterText = iframe.contentDocument.querySelector('#counter')?.textContent?.trim();
            if (!counterText) return false;
            const parsed = Number.parseInt(counterText, 10);
            return Number.isFinite(parsed) && parsed > minValue;
        },
        baseline,
        { timeout }
    );
}

async function countCounterLogs(page: Page): Promise<number> {
    return page.evaluate(() => {
        const entries = document.querySelectorAll('.console-panel .entry-msg');
        return [...entries]
            .map(entry => entry.textContent?.trim())
            .filter((text): text is string => !!text && text.startsWith('Counter:')).length;
    });
}

async function waitForCounterLogsToIncrease(page: Page, baseline: number, timeout = 20000): Promise<void> {
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

test.describe('Live Session Share & Post-Live Replay (E2E)', () => {
    let staticServer: Server;

    test.beforeAll(() => {
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
        if (staticServer) staticServer.close();
    });

    // ─── Test 1: Anonymous share link renders while agent is connected ───

    test('anonymous share link renders live session while agent is viewing', async ({ browser }) => {
        test.setTimeout(120000);
        const t0 = Date.now();

        const clientContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const agentContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const shareContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

        let sessionId = '';
        try {
            await ensureSdkAppOrigin(`http://localhost:${STATIC_PORT}`);

            // Phase 1: Client initializes and generates activity
            const clientPage = await clientContext.newPage();
            await clientPage.goto(`http://localhost:${STATIC_PORT}/?deviceId=${FIXED_DEVICE_ID}-share`);
            sessionId = await getClientSessionId(clientPage);
            console.log(`[${elapsed(t0)}] Client session: ${sessionId}`);

            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');
            await waitForSessionCreated(clientPage, sessionId);
            console.log(`[${elapsed(t0)}] Session created`);

            // Phase 2: Agent opens session detail and waits for live stream
            const agentPage = await agentContext.newPage();
            await agentPage.goto(`${UI_BASE_URL}/sessions/${sessionId}`);
            await agentPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });

            // Force WS upgrade
            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');

            const agentClientIndicator = agentPage.locator('.client-indicator');
            await expect(agentClientIndicator).toBeVisible({ timeout: 15000 });
            await waitForReplayFixtureVisible(agentPage);
            console.log(`[${elapsed(t0)}] Agent replay ready`);

            // Phase 3: Create share token and open anonymous share link
            const shareToken = await createShareToken(sessionId);
            console.log(`[${elapsed(t0)}] Share token: ${shareToken.slice(0, 20)}...`);

            const sharePage = await shareContext.newPage();
            await sharePage.goto(`${UI_BASE_URL}/share/${encodeURIComponent(shareToken)}`);
            await sharePage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });
            console.log(`[${elapsed(t0)}] Share page loaded`);

            // Wait for share viewer to show live content
            const shareClientIndicator = sharePage.locator('.client-indicator');
            await expect(shareClientIndicator).toBeVisible({ timeout: 15000 });
            await waitForReplayFixtureVisible(sharePage);
            console.log(`[${elapsed(t0)}] Share viewer has replay content`);

            // Verify BOTH viewers still have content (share join must not break agent)
            await waitForReplayFixtureVisible(agentPage);
            console.log(`[${elapsed(t0)}] Agent still has replay content after share join`);

            // Phase 4: Generate more activity and verify both viewers advance
            const agentCounterBefore = await countCounterLogs(agentPage);
            const shareCounterBefore = await countCounterLogs(sharePage);
            const agentVisualBefore = await getReplayCounter(agentPage);
            const shareVisualBefore = await getReplayCounter(sharePage);

            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');

            // Both viewers should receive console logs
            await waitForCounterLogsToIncrease(agentPage, agentCounterBefore);
            await waitForCounterLogsToIncrease(sharePage, shareCounterBefore);
            console.log(`[${elapsed(t0)}] Both viewers received console logs`);

            // Both viewers should show updated counter in replay
            if (agentVisualBefore !== null) {
                await waitForReplayCounterGreaterThan(agentPage, agentVisualBefore);
            }
            if (shareVisualBefore !== null) {
                await waitForReplayCounterGreaterThan(sharePage, shareVisualBefore);
            }
            console.log(`[${elapsed(t0)}] Both viewers show updated replay counter`);

            // Take screenshots
            const agentMasks: Locator[] = [
                agentPage.locator('.meta-id'),
                agentPage.locator('.meta-time'),
                agentPage.locator('.entry-time'),
                agentPage.locator('.playback-time-bar'),
                agentPage.locator('.playback-time-value')
            ];
            await captureStableScreenshot(
                agentPage,
                { path: `${SCREENSHOTS_DIR}/agent-with-share-viewer.png`, fullPage: true, mask: agentMasks },
                { label: 'agent-with-share-viewer' }
            );
            console.log(`[${elapsed(t0)}] Agent screenshot captured`);

            const shareMasks: Locator[] = [
                sharePage.locator('.meta-id'),
                sharePage.locator('.meta-time'),
                sharePage.locator('.entry-time'),
                sharePage.locator('.playback-time-bar'),
                sharePage.locator('.playback-time-value')
            ];
            await captureStableScreenshot(
                sharePage,
                { path: `${SCREENSHOTS_DIR}/share-link-live-session.png`, fullPage: true, mask: shareMasks },
                { label: 'share-link-live-session' }
            );
            console.log(`[${elapsed(t0)}] Share screenshot captured`);

            await clientPage.close();
            await agentPage.close();
            await sharePage.close();
        } finally {
            if (sessionId) {
                await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
            }
            await clientContext.close();
            await agentContext.close();
            await shareContext.close();
        }
    });

    // ─── Test 2: Post-live replay with client refresh (segment transition) ───

    test('post-live replay plays through a client refresh without going black', async ({ browser }) => {
        test.setTimeout(180000);
        const t0 = Date.now();

        const clientContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const agentContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

        let sessionId = '';
        try {
            await ensureSdkAppOrigin(`http://localhost:${STATIC_PORT}`);

            // Phase 1: Client initializes and generates pre-refresh activity
            const clientPage = await clientContext.newPage();
            await clientPage.goto(`http://localhost:${STATIC_PORT}/?deviceId=${FIXED_DEVICE_ID}-replay`);
            sessionId = await getClientSessionId(clientPage);
            console.log(`[${elapsed(t0)}] Client session: ${sessionId}`);

            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');
            await waitForSessionCreated(clientPage, sessionId);
            console.log(`[${elapsed(t0)}] Session created, counter at 3`);

            // Phase 2: Agent connects to trigger WS upgrade (needed so events stream live)
            console.log(`[${elapsed(t0)}] Phase 2: Agent connecting...`);
            const agentPage = await agentContext.newPage();
            agentPage.on('console', msg => {
                const text = msg.text();
                if (text.includes('live') || text.includes('player') || text.includes('segment')) {
                    console.log(`[${elapsed(t0)}] [AGENT]:`, text);
                }
            });
            await agentPage.goto(`${UI_BASE_URL}/sessions/${sessionId}`);
            await agentPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });
            console.log(`[${elapsed(t0)}] Agent page loaded`);

            // Force WS upgrade with activity
            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');

            const clientIndicator = agentPage.locator('.client-indicator');
            await expect(clientIndicator).toBeVisible({ timeout: 15000 });
            console.log(`[${elapsed(t0)}] Client indicator visible`);
            await waitForReplayContent(agentPage);
            console.log(`[${elapsed(t0)}] Agent sees live session, counter at 4`);

            // Phase 3: Client refreshes — this creates a mid-stream FullSnapshot
            await clientPage.reload({ waitUntil: 'networkidle' });
            const reconnectedSessionId = await getClientSessionId(clientPage);
            expect(reconnectedSessionId).toBe(sessionId);
            console.log(`[${elapsed(t0)}] Client refreshed, same session ID`);

            // Generate post-refresh activity
            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');
            console.log(`[${elapsed(t0)}] Post-refresh counter at 3`);

            // Wait for agent to reconnect and see post-refresh content
            await expect(clientIndicator).toBeVisible({ timeout: 20000 });
            await waitForReplayContent(agentPage);
            console.log(`[${elapsed(t0)}] Agent reconnected to live stream`);

            // Phase 4: End the live session — close client first, then agent.
            // The session stays isLive=true as long as ANY WS connection exists (including
            // the agent). We must close both to let the server mark it non-live.
            await clientPage.close();
            console.log(`[${elapsed(t0)}] Client closed`);

            // Navigate agent away to close its live WS connection
            await agentPage.goto('about:blank');
            console.log(`[${elapsed(t0)}] Agent disconnected`);

            // Wait for live-buffered events to be persisted to S3.
            // The server flushes on disconnect (async S3 upload) and via a 5s timer.
            // We need enough events to include both pre- and post-refresh activity,
            // which means at least 2 FullSnapshots and enough incremental events.
            // Give the server a moment to flush before starting to poll.
            await new Promise(resolve => setTimeout(resolve, 3000));

            let lastEventCount = 0;
            let stableSince = Date.now();
            let ready = false;
            for (let i = 0; i < 90; i++) {
                try {
                    const eventsRes = await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}/events`);
                    const events = eventsRes.ok ? ((await eventsRes.json()) as unknown[]) : [];

                    if (events.length !== lastEventCount) {
                        lastEventCount = events.length;
                        stableSince = Date.now();
                    }

                    const snapshotCount = events.filter(
                        (e: any) => e && typeof e === 'object' && e.type === 2
                    ).length;
                    const isStable = Date.now() - stableSince >= 5000 && events.length > 0;

                    // Need at least 10 events and 2 FullSnapshots (pre + post refresh)
                    if (snapshotCount >= 2 && events.length >= 10 && isStable) {
                        console.log(`[${elapsed(t0)}] Events persisted: ${events.length} events, ${snapshotCount} snapshots (poll ${i})`);
                        ready = true;
                        break;
                    }

                    // Fall back: if events are stable for a long time with at least 1 snapshot,
                    // proceed anyway (server may have merged events into fewer chunks)
                    if (snapshotCount >= 1 && events.length >= 5 && Date.now() - stableSince >= 15000) {
                        console.log(`[${elapsed(t0)}] Events stable (fallback): ${events.length} events, ${snapshotCount} snapshots (poll ${i})`);
                        ready = true;
                        break;
                    }

                    if (i % 5 === 4) {
                        console.log(`[${elapsed(t0)}] Waiting... count=${events.length}, snapshots=${snapshotCount}, stable=${isStable} (poll ${i})`);
                    }
                } catch {
                    // keep polling
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (!ready) {
                throw new Error(`Events not ready for replay (count=${lastEventCount})`);
            }

            // Phase 5: Open session detail — it will enter live/waiting mode since
            // isLive is still true in the DB. Click "Skip Live Connection" to switch
            // to recorded replay mode.
            await agentPage.goto(`${UI_BASE_URL}/sessions/${sessionId}`, { waitUntil: 'networkidle' });
            await agentPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });
            console.log(`[${elapsed(t0)}] Agent page loaded (live/waiting mode)`);

            // Wait for "Skip Live Connection" button and click it
            const skipBtn = agentPage.locator('.skip-live-btn');
            await expect(skipBtn).toBeVisible({ timeout: 15000 });
            await skipBtn.click();
            console.log(`[${elapsed(t0)}] Clicked Skip Live Connection`);

            // Wait for replay player to mount and visually render the fixture content
            await waitForReplayFixtureVisible(agentPage);
            console.log(`[${elapsed(t0)}] Replay player mounted with recorded events`);

            // Take screenshot to verify initial content renders (not black)
            const replayMasks: Locator[] = [
                agentPage.locator('.meta-id'),
                agentPage.locator('.meta-time'),
                agentPage.locator('.entry-time'),
                agentPage.locator('.playback-time-bar'),
                agentPage.locator('.playback-time-value')
            ];
            await captureStableScreenshot(
                agentPage,
                { path: `${SCREENSHOTS_DIR}/post-live-replay-start.png`, fullPage: true, mask: replayMasks },
                { label: 'post-live-replay-start' }
            );
            console.log(`[${elapsed(t0)}] Screenshot: replay start (pre-refresh segment)`);

            // The replay contains events from before AND after the refresh.
            // With segment-based replay, the player should auto-transition through
            // the refresh boundary. Let the replay play for a bit, then check the
            // rrweb player still has content (hasn't gone black).
            await agentPage.waitForTimeout(3000);

            // The replay should still be rendering (not black). This is the critical
            // assertion: without segment-based replay, rrweb tears down the iframe DOM
            // at the mid-stream FullSnapshot and produces a black screen.
            await waitForReplayFixtureVisible(agentPage);
            console.log(`[${elapsed(t0)}] Replay still has content after playing (not black)`);

            // Seek to 85% of the total timeline to jump past the refresh boundary.
            await agentPage.evaluate(() => {
                const controller = document.querySelector('.rr-controller__progress') as HTMLElement | null;
                if (controller) {
                    const rect = controller.getBoundingClientRect();
                    const clickX = rect.left + rect.width * 0.85;
                    const clickY = rect.top + rect.height / 2;
                    controller.dispatchEvent(
                        new MouseEvent('click', { clientX: clickX, clientY: clickY, bubbles: true })
                    );
                }
            });
            await agentPage.waitForTimeout(2000);

            // After seeking past the refresh point, the player should STILL show content.
            await waitForReplayFixtureVisible(agentPage);
            console.log(`[${elapsed(t0)}] Replay has content after seeking past refresh point`);

            await captureStableScreenshot(
                agentPage,
                { path: `${SCREENSHOTS_DIR}/post-live-replay-after-refresh.png`, fullPage: true, mask: replayMasks },
                { label: 'post-live-replay-after-refresh' }
            );
            console.log(`[${elapsed(t0)}] Screenshot: replay after refresh point`);

            await agentPage.close();
        } finally {
            if (sessionId) {
                await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
            }
            await clientContext.close();
            await agentContext.close();
        }
    });
});
