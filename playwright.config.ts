import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173/api/health', reuseExistingServer: true },
});
