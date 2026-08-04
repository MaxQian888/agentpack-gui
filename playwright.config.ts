import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E config for the agentpack web build (`pnpm dev`).
 *
 * The desktop runtime (Tauri) is not available in a browser, so `isTauri()` is
 * false here: side-effectful actions (Run, save/load, installs) surface a
 * "run the desktop app" toast instead of touching the system. These specs
 * therefore exercise the full UI surface — navigation, selection, i18n, theme,
 * forms and validation — which is the bulk of the user journey.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    locale: "en-US",
  },

  projects: [
    {
      name: "main-app",
      testIgnore: /e2e\/docs\//,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "docs-site",
      testMatch: /e2e\/docs\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3001" },
    },
  ],

  webServer: [
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm docs:dev",
      url: "http://localhost:3001/docs",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
})
