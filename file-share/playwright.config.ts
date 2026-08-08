import { defineConfig, devices } from '@playwright/test';

// Local runs spawn a dev server on PORT with test credentials.
// Dockerized runs (docker-compose.test.yml) set BASE_URL and provide the
// server themselves. The host must be localhost either way: the production
// container issues Secure session cookies, which browsers (and Playwright's
// request context) only accept over http on localhost.
const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
const baseURL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'test-results/.auth/admin.json',
      },
      dependencies: ['setup'],
      testIgnore: /screenshots\.spec\.ts/,
    },
    // Regenerates the README screenshots; opt-in via `npm run screenshots`.
    ...(process.env.SCREENSHOTS
      ? [
          {
            name: 'screenshots',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 800 },
              deviceScaleFactor: 2,
              storageState: 'test-results/.auth/admin.json',
            },
            dependencies: ['setup'],
            testMatch: /screenshots\.spec\.ts/,
          },
        ]
      : []),
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          SESSION_SECRET: 'playwright-test-secret-at-least-32-chars!',
          ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
          ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'test-password-123',
          UPLOAD_DIR: './.test-uploads',
        },
      },
});
