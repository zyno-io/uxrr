import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startStaticServer, getClientSessionId } from './helpers';
import type { Server } from 'http';
import type { Page, Response } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATIC_PORT = 9877;
const API_BASE_URL = 'http://localhost:8977';
const UI_BASE_URL = 'http://localhost:8978';
const SDK_APP_ID = 'test-app';
const FIXED_DEVICE_ID = 'e2e-test-device-shared-fixed';

function elapsed(start: number): string {
    return `+${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function waitForSessionCreated(page: Page, sessionId: string): Promise<void> {
    const ingestPath = `/v1/ng/${SDK_APP_ID}/${sessionId}/data`;
    const seenIngestStatuses: number[] = [];
    const onResponse = (response: Response) => {
        if (response.request().method() === 'POST' && response.url().includes(ingestPath)) {
            seenIngestStatuses.push(response.status());
        }
    };
    page.on('response', onResponse);

    try {
        await page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                response.url().includes(ingestPath) &&
                response.ok(),
            { timeout: 70_000 }
        );
    } catch {
        const statusSummary = seenIngestStatuses.length > 0 ? seenIngestStatuses.join(', ') : 'none';
        throw new Error(
            `Session ${sessionId} was not ingested in time (no successful POST ${ingestPath}; statuses seen: ${statusSummary})`
        );
    } finally {
        page.off('response', onResponse);
    }

    let lastStatus: number | undefined;
    let lastBody = '';
    for (let i = 0; i < 60; i += 1) {
        try {
            const response = await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}`);
            if (response.ok) return;
            lastStatus = response.status;
            lastBody = await response.text();
        } catch {
            // keep polling
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const suffix = lastStatus
        ? ` (last status: ${lastStatus}${lastBody ? `, body: ${lastBody.slice(0, 200)}` : ''})`
        : '';
    throw new Error(`Session ${sessionId} was not created in time${suffix}`);
}

async function createShareToken(sessionId: string): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}/share`, { method: 'POST' });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to create share link (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) {
        throw new Error('Share link response missing token');
    }
    return payload.token;
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

test.describe('Live Session Shared Viewer + Reconnect (E2E)', () => {
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

    test('agent and shared viewer both keep visual stream after shared join and client reload', async ({ browser }) => {
        test.setTimeout(180000);
        const t0 = Date.now();

        const clientContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const agentContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const sharedContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });

        let sessionId = '';
        try {
            await ensureSdkAppOrigin(`http://localhost:${STATIC_PORT}`);

            const clientPage = await clientContext.newPage();
            await clientPage.goto(`http://localhost:${STATIC_PORT}/?deviceId=${FIXED_DEVICE_ID}`);
            sessionId = await getClientSessionId(clientPage);
            console.log(`[${elapsed(t0)}] Client session: ${sessionId}`);

            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');
            await waitForSessionCreated(clientPage, sessionId);
            console.log(`[${elapsed(t0)}] Session created`);

            const agentPage = await agentContext.newPage();
            await agentPage.goto(`${UI_BASE_URL}/sessions/${sessionId}`);
            await agentPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });

            // Force client WS upgrade with fresh activity.
            await clientPage.click('#incrementBtn');
            await clientPage.click('#logBtn');

            const agentClientIndicator = agentPage.locator('.client-indicator');
            await expect(agentClientIndicator).toBeVisible({ timeout: 15000 });
            await waitForReplayContent(agentPage);
            console.log(`[${elapsed(t0)}] Agent replay ready`);

            const shareToken = await createShareToken(sessionId);
            console.log(`[${elapsed(t0)}] Share token created`);

            const sharedPage = await sharedContext.newPage();
            await sharedPage.goto(`${UI_BASE_URL}/share/${encodeURIComponent(shareToken)}`);
            await sharedPage.waitForSelector('.session-detail, .detail-header', { timeout: 15000 });

            const sharedClientIndicator = sharedPage.locator('.client-indicator');
            await expect(sharedClientIndicator).toBeVisible({ timeout: 15000 });
            await waitForReplayContent(sharedPage);
            // Critical assertion for reported bug: existing agent stays rendered after share viewer joins.
            await waitForReplayContent(agentPage);
            console.log(`[${elapsed(t0)}] Shared viewer joined; both replays still rendered`);

            const agentCounterBefore = await countCounterLogs(agentPage);
            const sharedCounterBefore = await countCounterLogs(sharedPage);
            const agentVisualBeforeJoinIncrement = await getReplayCounter(agentPage);
            const sharedVisualBeforeJoinIncrement = await getReplayCounter(sharedPage);
            if (agentVisualBeforeJoinIncrement === null || sharedVisualBeforeJoinIncrement === null) {
                throw new Error('Replay counter was not readable before share-join increment check');
            }

            // Critical assertion for reported bug #2: after share join, live visuals must continue advancing.
            await clientPage.click('#incrementBtn');
            await waitForCounterLogsToIncrease(agentPage, agentCounterBefore);
            await waitForCounterLogsToIncrease(sharedPage, sharedCounterBefore);
            await waitForReplayCounterGreaterThan(agentPage, agentVisualBeforeJoinIncrement);
            await waitForReplayCounterGreaterThan(sharedPage, sharedVisualBeforeJoinIncrement);
            const agentCounterBeforeReconnect = await countCounterLogs(agentPage);
            const sharedCounterBeforeReconnect = await countCounterLogs(sharedPage);

            await clientPage.reload({ waitUntil: 'networkidle' });
            const reconnectedSessionId = await getClientSessionId(clientPage);
            expect(reconnectedSessionId).toBe(sessionId);
            console.log(`[${elapsed(t0)}] Client reloaded/reconnected`);

            const agentVisualBeforeReconnectIncrement = await getReplayCounter(agentPage);
            const sharedVisualBeforeReconnectIncrement = await getReplayCounter(sharedPage);
            if (agentVisualBeforeReconnectIncrement === null || sharedVisualBeforeReconnectIncrement === null) {
                throw new Error('Replay counter was not readable before reconnect increment check');
            }

            await clientPage.click('#incrementBtn');
            await clientPage.click('#incrementBtn');

            await expect(agentClientIndicator).toBeVisible({ timeout: 20000 });
            await expect(sharedClientIndicator).toBeVisible({ timeout: 20000 });
            await waitForCounterLogsToIncrease(agentPage, agentCounterBeforeReconnect);
            await waitForCounterLogsToIncrease(sharedPage, sharedCounterBeforeReconnect);
            await waitForReplayCounterValue(agentPage, 2);
            await waitForReplayCounterValue(sharedPage, 2);

            // Critical assertion for reported bug: both viewers keep visual replay after client refresh.
            await waitForReplayContent(agentPage);
            await waitForReplayContent(sharedPage);
            console.log(`[${elapsed(t0)}] Post-reconnect: both viewers still rendered and receiving logs`);

            await clientPage.close();
            await agentPage.close();
            await sharedPage.close();
        } finally {
            if (sessionId) {
                await fetch(`${API_BASE_URL}/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {
                    // best-effort cleanup
                });
            }
            await clientContext.close();
            await agentContext.close();
            await sharedContext.close();
        }
    });
});
