import { defineConfig, devices } from "@playwright/test";

const webServerTimeout = Number(process.env.E2E_WEB_SERVER_TIMEOUT_MS ?? 300_000);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: {} }],
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: webServerTimeout,
  },
});
