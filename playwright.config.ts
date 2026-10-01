import { defineConfig } from '@playwright/test';

// E2E_STATIC=1 tests the GitHub Pages build (run `npm run build:static` first).
const staticSite = process.env.E2E_STATIC === '1';
const baseURL = staticSite ? 'http://localhost:4173' : 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 45000,
  use: {
    baseURL,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
  },
  webServer: staticSite
    ? { command: 'npx vite preview --mode static --port 4173 --strictPort', url: `${baseURL}/`, reuseExistingServer: true }
    : { command: 'npm run dev', url: `${baseURL}/api/health`, reuseExistingServer: true },
});
