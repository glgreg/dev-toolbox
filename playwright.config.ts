import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const systemChromium = '/usr/bin/chromium';
const useSystemChromium =
  !process.env.CI &&
  !process.env.PLAYWRIGHT_SKIP_SYSTEM_CHROMIUM &&
  existsSync(systemChromium);

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    launchOptions: useSystemChromium
      ? {
          executablePath: systemChromium,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      : {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node test/e2e/server.ts',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
  ],
});
