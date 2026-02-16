import { test, expect } from '@playwright/test';
import { sessions, authConfig, meResponse, VRT_NOW } from './fixtures';
import { setupBaseMocks, mockSessionListRoutes, expectMinScreenshotSize } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test.describe('Session List', () => {
    test('populated list with live badge', async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        await setupBaseMocks(page, authConfig, meResponse);
        await mockSessionListRoutes(page, sessions);
        await page.goto('/');

        await page.waitForSelector('.session-table', { timeout: 10000 });
        await page.waitForTimeout(500);

        // Should render 3 rows
        const rows = page.locator('.session-table tbody .row-clickable');
        await expect(rows).toHaveCount(3);

        // Live badge should be visible on the live session
        const liveBadge = page.locator('.session-table .live-badge');
        await expect(liveBadge).toBeVisible();

        const listPath = `${SCREENSHOTS_DIR}/session-list.png`;
        await page.screenshot({ path: listPath, fullPage: true });
        expectMinScreenshotSize(listPath, 10_000);
    });

    test('empty state', async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        await setupBaseMocks(page, authConfig, meResponse);
        await mockSessionListRoutes(page, []);
        await page.goto('/');

        await page.waitForSelector('.session-table', { timeout: 10000 });
        await page.waitForTimeout(500);

        // Should show "No sessions found"
        const emptyCell = page.locator('.cell-empty');
        await expect(emptyCell).toContainText('No sessions found');

        const emptyPath = `${SCREENSHOTS_DIR}/session-list-empty.png`;
        await page.screenshot({ path: emptyPath, fullPage: true });
        expectMinScreenshotSize(emptyPath, 10_000);
    });
});
