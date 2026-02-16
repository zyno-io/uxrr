import { test, expect } from '@playwright/test';
import {
    sessions,
    rrwebEvents,
    consoleLogs,
    networkLogs,
    chatMessages,
    authConfig,
    meResponse,
    VRT_NOW
} from './fixtures';
import { setupBaseMocks, mockSessionListRoutes, mockSessionDetailRoutes, expectMinScreenshotSize } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';
const session = sessions[0]; // prerecorded session with chat

/** Click the right end of the rrweb progress bar to seek to the session end. */
async function seekToEnd(page: import('@playwright/test').Page) {
    const progress = page.locator('.rr-progress');
    await expect(progress).toBeVisible({ timeout: 5000 });
    const box = (await progress.boundingBox())!;
    // Click near the right edge of the progress bar
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
}

test.describe('Prerecorded Session Detail', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        await setupBaseMocks(page, authConfig, meResponse);
        await mockSessionListRoutes(page, sessions);
        await mockSessionDetailRoutes(page, {
            session,
            events: rrwebEvents,
            logs: [...consoleLogs, ...networkLogs],
            chat: chatMessages
        });
    });

    test('replay and console tab', async ({ page }) => {
        await page.goto(`/sessions/${session.id}`);

        // Wait for player to mount
        await page.waitForSelector('.replay-pane iframe, .replay-pane canvas, .replayer-wrapper', {
            timeout: 15000
        });
        await page.waitForTimeout(1000);

        // Seek to end so log entries are not faded (.future class)
        await seekToEnd(page);

        // Console tab should be active by default — check for log entries
        const consoleTab = page.getByRole('button', { name: 'Console' });
        await consoleTab.click();
        await page.waitForTimeout(300);

        const consoleEntries = page.locator('.console-entry');
        await expect(consoleEntries.first()).toBeVisible({ timeout: 5000 });

        // Should have console log entries (not network ones)
        const entryCount = await consoleEntries.count();
        expect(entryCount).toBeGreaterThan(0);

        const consolePath = `${SCREENSHOTS_DIR}/session-detail-console.png`;
        await page.screenshot({ path: consolePath, fullPage: true });
        expectMinScreenshotSize(consolePath, 50_000);
    });

    test('network tab', async ({ page }) => {
        await page.goto(`/sessions/${session.id}`);

        await page.waitForSelector('.replay-pane iframe, .replay-pane canvas, .replayer-wrapper', {
            timeout: 15000
        });
        await page.waitForTimeout(500);

        // Seek to end so network entries are not faded
        await seekToEnd(page);

        // Switch to Network tab
        const networkTab = page.getByRole('button', { name: 'Network' });
        await expect(networkTab).toBeVisible({ timeout: 5000 });
        await networkTab.click();
        await page.waitForTimeout(300);

        // Should show network table with entries
        const networkTable = page.locator('.network-table');
        await expect(networkTable).toBeVisible({ timeout: 5000 });

        // Check rows exist
        const networkRows = page.locator('.network-table tbody tr:not(.detail-row)');
        const rowCount = await networkRows.count();
        expect(rowCount).toBeGreaterThan(0);

        const networkPath = `${SCREENSHOTS_DIR}/session-detail-network.png`;
        await page.screenshot({ path: networkPath, fullPage: true });
        expectMinScreenshotSize(networkPath, 50_000);
    });

    test('chat tab (readonly)', async ({ page }) => {
        await page.goto(`/sessions/${session.id}`);

        await page.waitForSelector('.replay-pane iframe, .replay-pane canvas, .replayer-wrapper', {
            timeout: 15000
        });
        await page.waitForTimeout(500);

        // Switch to Chat tab
        const chatTab = page.getByRole('button', { name: 'Chat' });
        await expect(chatTab).toBeVisible({ timeout: 5000 });
        await chatTab.click();
        await page.waitForTimeout(300);

        // Should show chat messages
        const chatMsgs = page.locator('.chat-msg');
        await expect(chatMsgs.first()).toBeVisible({ timeout: 5000 });

        const msgCount = await chatMsgs.count();
        expect(msgCount).toBe(chatMessages.length);

        // Should have both user and agent messages
        await expect(page.locator('.chat-msg--user').first()).toBeVisible();
        await expect(page.locator('.chat-msg--agent').first()).toBeVisible();

        const chatPath = `${SCREENSHOTS_DIR}/session-detail-chat.png`;
        await page.screenshot({ path: chatPath, fullPage: true });
        expectMinScreenshotSize(chatPath, 50_000);
    });
});
