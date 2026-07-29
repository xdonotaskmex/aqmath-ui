// Playwright config for AQMath UI visual regression tests.
//
// Starts the zero-dependency static server (tests/static-server.cjs) and runs
// full-page screenshot snapshots of the 5 key routes in Chromium at a fixed
// viewport. Baselines live in tests/visual.spec.cjs-snapshots/.
//
//   npm install
//   npm run setup            # one-time: download the Chromium browser
//   npm run test:update      # create/refresh baseline screenshots
//   npm test                 # compare against baselines (CI mode)
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: {
    // Small pixel tolerance absorbs sub-pixel font/AA differences across machines.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
      // The landing and docs routes are very tall (~13,500px). Capturing a
      // ~19-megapixel full-page frame twice for the stability check does not fit
      // in the 5s default, so a stable page can still time out. Give it room.
      timeout: 30_000,
    },
  },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Use the same Node binary running Playwright so the server starts even when
    // `node` is not on PATH (e.g. a fresh shell right after installing Node).
    command: `"${process.execPath}" tests/static-server.cjs`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
