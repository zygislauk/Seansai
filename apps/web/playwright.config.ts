import { defineConfig, devices } from '@playwright/test';
import {
  PRODUCTION_PORT,
  RESILIENCE_PORT,
  SNAPSHOT_API_PORT,
  SNAPSHOT_PORT,
} from './tests/e2e/ports.ts';

const isCi = Boolean(process.env.CI);

const snapshotApi = `http://localhost:${String(SNAPSHOT_API_PORT)}/api/v1`;
/** The API answers as soon as it listens, but a snapshot needs every source to have loaded. */
const waitForSnapshotApi = `until curl -sf ${snapshotApi}/health | grep -q lastSuccessAt && ! curl -sf ${snapshotApi}/health | grep -q '"lastSuccessAt":null'; do sleep 1; done`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // No colour transitions, so accessibility scans never see a half-changed colour.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel-7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Development servers over the fixture data: the user-story tests.
      command: 'npm run dev',
      cwd: '../..',
      env: { SOURCES_MODE: 'fixtures' },
      url: 'http://localhost:5173',
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
    {
      // The production build served by the API, as deployed: performance.spec.ts.
      command: 'npm run build -w @seansai/web && node apps/api/src/main.ts',
      cwd: '../..',
      env: { NODE_ENV: 'production', SOURCES_MODE: 'fixtures', PORT: String(PRODUCTION_PORT) },
      url: `http://localhost:${String(PRODUCTION_PORT)}/api/v1/health`,
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
    {
      // The daily snapshot over the fixture data, in its own folder: seo.spec.ts.
      command: `node apps/api/src/main.ts & ${waitForSnapshotApi}; npm run build -w @seansai/web && npm run preview -w @seansai/web -- --port ${String(SNAPSHOT_PORT)} --strictPort & wait`,
      cwd: '../..',
      env: {
        SOURCES_MODE: 'fixtures',
        PORT: String(SNAPSHOT_API_PORT),
        API_PORT: String(SNAPSHOT_API_PORT),
        SNAPSHOT_API_URL: snapshotApi,
        BUILD_OUT_DIR: 'dist-snapshot',
      },
      url: `http://localhost:${String(SNAPSHOT_PORT)}/lt/`,
      reuseExistingServer: !isCi,
      timeout: 180_000,
    },
    {
      // Vue's refresh fails and last succeeded 4 hours ago: resilience.spec.ts (FR-015).
      command: `node apps/api/src/main.ts & npm run dev -w @seansai/web -- --port ${String(RESILIENCE_PORT)} & wait`,
      cwd: '../..',
      env: {
        SOURCES_MODE: 'fixtures',
        FIXTURE_FAIL: 'vue',
        FIXTURE_VUE_LAST_SUCCESS_HOURS: '4',
        PORT: '3001',
        API_PORT: '3001',
      },
      url: `http://localhost:${String(RESILIENCE_PORT)}`,
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
  ],
});
