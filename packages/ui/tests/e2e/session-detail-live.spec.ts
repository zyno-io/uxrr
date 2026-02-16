import { test, expect } from '@playwright/test';
import { sessions, rrwebEvents, liveChatMessages, authConfig, meResponse, VRT_NOW } from './fixtures';
import {
    mockAuthRoutes,
    mockSessionListRoutes,
    mockSessionDetailRoutes,
    mockWebSocket,
    mockLiveWebSocket,
    expectMinScreenshotSize
} from './helpers';

const SCREENSHOTS_DIR = 'screenshots';
const liveSession = sessions[1]; // live session, no events

test.describe('Live Session Detail', () => {
    test('waiting state', async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        // Use standard WS abort for the waiting-state test
        await Promise.all([mockAuthRoutes(page, authConfig, meResponse), mockWebSocket(page)]);
        await mockSessionListRoutes(page, sessions);
        await mockSessionDetailRoutes(page, {
            session: liveSession,
            events: [],
            logs: []
        });

        await page.goto(`/sessions/${liveSession.id}`);

        // Wait for the detail page to load
        await page.waitForSelector('.session-detail, .detail-header', { timeout: 10000 });
        await page.waitForTimeout(1000);

        // Should show LIVE badge or CONNECTING badge
        const liveBadge = page.locator('.live-badge');
        await expect(liveBadge).toBeVisible({ timeout: 5000 });

        // Should show waiting indicator (client not connected since WS is aborted)
        const clientIndicator = page.locator('.client-indicator');
        await expect(clientIndicator).toBeVisible({ timeout: 5000 });

        const waitingPath = `${SCREENSHOTS_DIR}/session-live-waiting.png`;
        await page.screenshot({ path: waitingPath, fullPage: true });
        expectMinScreenshotSize(waitingPath, 10_000);
    });

    test('active chat', async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        // Use the live WS mock — must be set up BEFORE navigation
        await mockAuthRoutes(page, authConfig, meResponse);
        await mockLiveWebSocket(page, {
            events: rrwebEvents,
            chatMessages: liveChatMessages
        });
        await mockSessionListRoutes(page, sessions);
        await mockSessionDetailRoutes(page, {
            session: liveSession,
            events: [],
            logs: []
        });

        await page.goto(`/sessions/${liveSession.id}`);

        // Wait for the live player to mount (rrweb can render iframe or canvas depending on runtime)
        await page.waitForSelector('.replay-pane iframe, .replay-pane canvas, .replayer-wrapper', {
            timeout: 15000
        });

        // Should show LIVE badge (not CONNECTING — client is connected via mock WS)
        const liveBadge = page.locator('.live-badge:not(.live-badge--connecting)');
        await expect(liveBadge).toBeVisible({ timeout: 5000 });

        // Switch to Chat tab
        const chatTab = page.getByRole('button', { name: 'Chat' });
        await expect(chatTab).toBeVisible({ timeout: 5000 });
        await chatTab.click();

        // Wait for all chat messages to arrive (they arrive with 100ms spacing)
        const chatMsgs = page.locator('.chat-msg');
        await expect(chatMsgs).toHaveCount(liveChatMessages.length, { timeout: 5000 });

        // Should have both user and agent messages
        await expect(page.locator('.chat-msg--user').first()).toBeVisible();
        await expect(page.locator('.chat-msg--agent').first()).toBeVisible();

        // Should show the input box (not readonly — this is a live session with control)
        const chatInput = page.locator('.chat-input textarea');
        await expect(chatInput).toBeVisible({ timeout: 3000 });

        // Blur the textarea so focus ring doesn't cause VRT flakiness
        await chatInput.blur();

        const chatPath = `${SCREENSHOTS_DIR}/session-live-chat.png`;
        await page.screenshot({ path: chatPath, fullPage: true });
        expectMinScreenshotSize(chatPath, 50_000);
    });
});
