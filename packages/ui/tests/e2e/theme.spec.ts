import { test, expect } from '@playwright/test';

import { sessions, authConfig, meResponse, VRT_NOW, adminApps, rrwebEvents, consoleLogs } from './fixtures';
import { setupBaseMocks, mockSessionListRoutes, mockAdminRoutes, mockSessionDetailRoutes } from './helpers';

test.describe('Theme', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.install({ time: VRT_NOW });
        await page.emulateMedia({ colorScheme: 'light' });
        await setupBaseMocks(page, authConfig, meResponse);
        await mockSessionListRoutes(page, sessions);
        await page.goto('/');
        await expect(page.locator('.session-table')).toBeVisible();
    });

    test('persists explicit themes and follows system changes', async ({ page }) => {
        await expect(page.locator('html')).not.toHaveClass(/dark/);
        await page.screenshot({ path: 'screenshots/session-list-light.png', fullPage: true });
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.reload();
        await expect(page.locator('.session-table')).toBeVisible();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({ path: 'screenshots/session-list-dark.png', fullPage: true });

        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
        await expect(page.locator('html')).not.toHaveClass(/dark/);
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.reload();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(page.locator('html')).not.toHaveClass(/dark/);

        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).not.toHaveClass(/dark/);
    });

    test('supports keyboard selection, dismissal, and admin navigation', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'Theme', exact: true });
        await trigger.focus();
        await trigger.press('ArrowDown');
        await expect(page.getByRole('menuitemradio', { name: 'System', exact: true })).toBeFocused();
        await page.keyboard.press('End');
        await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('html')).toHaveClass(/dark/);
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await trigger.press('ArrowDown');
        await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expect(page.getByRole('menu')).toHaveCount(0);
        await trigger.click();
        await page.getByRole('heading', { name: 'Sessions', exact: true }).click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await page.getByRole('button', { name: 'Admin', exact: true }).focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: 'Apps', exact: true })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: 'Users', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Admin', exact: true })).toBeFocused();
    });

    test('keeps the theme control accessible on narrow screens', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const trigger = page.getByRole('button', { name: 'Theme', exact: true });
        await expect(trigger).toBeVisible();
        await trigger.click();
        await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeInViewport();
        await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.screenshot({ path: 'screenshots/session-list-mobile-dark.png', fullPage: true });
    });

    test('themes teleported dropdowns and form modals', async ({ page }) => {
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
        const appFilter = page.getByRole('textbox', { name: 'Any App', exact: true });
        const placeholderColor = await appFilter.evaluate(input => getComputedStyle(input, '::placeholder').color);
        expect(placeholderColor).toBe('rgb(139, 144, 156)');
        await appFilter.click();
        const options = page.locator('.vf-smart-select-options');
        await expect(options).toBeVisible();
        await expect(options).toHaveCSS('background-color', 'rgb(19, 20, 24)');
        await expect(options).toHaveCSS('color', 'rgb(236, 236, 240)');

        await mockAdminRoutes(page, { apps: adminApps });
        await page.goto('/admin/apps');
        await page.getByRole('button', { name: 'Create App', exact: true }).click();
        const modal = page.locator('.vf-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toHaveCSS('background-color', 'rgb(19, 20, 24)');
        await expect(modal.locator('input').first()).toHaveCSS('color', 'rgb(236, 236, 240)');
        await page.screenshot({ path: 'screenshots/admin-create-app-dark.png', fullPage: true });
    });

    test('themes replay controls without changing the recorded page', async ({ page }) => {
        await mockSessionDetailRoutes(page, { session: sessions[0]!, events: rrwebEvents, logs: consoleLogs });
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
        await page.goto(`/sessions/${sessions[0]!.id}`);
        await expect(page.locator('.rr-controller')).toBeVisible();
        await expect(page.locator('.rr-controller')).toHaveCSS('background-color', 'rgb(19, 20, 24)');
        await expect(page.locator('.rr-timeline__time').first()).toHaveCSS('color', 'rgb(174, 178, 189)');
        await expect(page.locator('.rr-controller__btns button svg').first()).toHaveCSS('fill', 'rgb(174, 178, 189)');
        await expect(page.frameLocator('.replayer-wrapper iframe').getByText('Welcome back, Jane')).toBeVisible();
        await page.screenshot({ path: 'screenshots/session-detail-dark.png', fullPage: true });
    });
});
