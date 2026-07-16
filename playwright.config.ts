import { defineConfig, devices } from '@playwright/test';

const backendPort = Number(process.env.E2E_BACKEND_PORT || 3100);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT || 5183);
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

process.env.E2E_BACKEND_PORT = String(backendPort);
process.env.E2E_FRONTEND_PORT = String(frontendPort);
process.env.E2E_API_BASE_URL = `${backendOrigin}/api/v1`;
process.env.VITE_API_PROXY_TARGET = backendOrigin;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: frontendOrigin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm build && node scripts/start-e2e-server.cjs',
      url: `${backendOrigin}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --dir frontend build && pnpm --dir frontend preview:e2e',
      url: `${frontendOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
