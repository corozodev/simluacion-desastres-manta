import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npm run build:api && npm run start -w @corodev/mock-api',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      env: { HOST: '127.0.0.1', PORT: '3001', NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:5173' },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      env: { VITE_API_MODE: 'mock', VITE_API_BASE_URL: 'http://localhost:3001' },
    },
  ],
});
