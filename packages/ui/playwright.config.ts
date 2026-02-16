import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30 * 1000,
    expect: { timeout: 5000 },
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        actionTimeout: 0,
        baseURL: 'http://localhost:8978',
        trace: 'on-first-retry',
        headless: !!process.env.CI,
        video: 'retain-on-failure',
        timezoneId: 'UTC',
        locale: 'en-US'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: ['--font-render-hinting=none', '--disable-font-subpixel-positioning']
                }
            }
        }
    ],
    outputDir: 'test-results/',
    webServer: {
        command: process.env.CI ? 'yarn preview --port 8978' : 'yarn dev',
        port: 8978,
        reuseExistingServer: !process.env.CI
    }
});
