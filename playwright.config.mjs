import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, workers: 1,
  use: { browserName: 'chromium', headless: true, baseURL: 'http://127.0.0.1:4178' },
  webServer: { command: 'node tests/browser/server.mjs', url: 'http://127.0.0.1:4178', reuseExistingServer: false },
});
