import { test, expect } from '@playwright/test';
import { adminApps, adminUsers, adminApiKeys, authConfig, meResponse, VRT_NOW } from './fixtures';
import { setupBaseMocks, mockAdminRoutes, expectMinScreenshotSize } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test.describe('Admin Pages', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        await setupBaseMocks(page, authConfig, meResponse);
        await mockAdminRoutes(page, {
            apps: adminApps,
            users: adminUsers,
            keys: adminApiKeys
        });
    });

    test('apps page', async ({ page }) => {
        await page.goto('/admin/apps');

        // Wait for the admin table to render
        const table = page.locator('.admin-table');
        await expect(table).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(500);

        // Should have 3 app rows
        const rows = page.locator('.admin-table tbody tr');
        await expect(rows).toHaveCount(3);

        // Should show app IDs
        await expect(page.locator('.app-id').first()).toBeVisible();

        // Should show active/inactive badges
        const badges = page.locator('.status-badge');
        await expect(badges.first()).toBeVisible();

        const appsPath = `${SCREENSHOTS_DIR}/admin-apps.png`;
        await page.screenshot({ path: appsPath, fullPage: true });
        expectMinScreenshotSize(appsPath, 10_000);
    });

    test('users page', async ({ page }) => {
        await page.goto('/admin/users');

        const table = page.locator('.admin-table');
        await expect(table).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(500);

        // Should have 3 user rows
        const rows = page.locator('.admin-table tbody tr');
        await expect(rows).toHaveCount(3);

        // Should show admin toggles
        const toggles = page.locator('.toggle-switch');
        await expect(toggles.first()).toBeVisible();

        const usersPath = `${SCREENSHOTS_DIR}/admin-users.png`;
        await page.screenshot({ path: usersPath, fullPage: true });
        expectMinScreenshotSize(usersPath, 10_000);
    });

    test('API keys page', async ({ page }) => {
        await page.goto('/admin/api-keys');

        const table = page.locator('.admin-table');
        await expect(table).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(500);

        // Should have 3 key rows
        const rows = page.locator('.admin-table tbody tr');
        await expect(rows).toHaveCount(3);

        const keysPath = `${SCREENSHOTS_DIR}/admin-api-keys.png`;
        await page.screenshot({ path: keysPath, fullPage: true });
        expectMinScreenshotSize(keysPath, 10_000);
    });
});
