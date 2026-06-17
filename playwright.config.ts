import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. A dedicated in-memory MongoDB (fixed port 27018) is started in
 * global-setup, which also seeds a whitelisted user + active "Main Collection"
 * and writes an authenticated storageState (a minted NextAuth session cookie).
 * The app is run on port 3100 to avoid clashing with a local dev server.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    storageState: "./e2e/.auth/storageState.json",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MONGO_DB_URI: "mongodb://127.0.0.1:27018/yamtgd-e2e",
      AUTH_SECRET: "e2e-test-secret-do-not-use-in-prod",
      NEXTAUTH_URL: BASE_URL,
      GOOGLE_CLIENT_ID: "e2e-dummy",
      GOOGLE_CLIENT_SECRET: "e2e-dummy",
      // Isolated build dir + dev lock so we don't collide with a running dev server.
      E2E_DIST_DIR: ".next-e2e"
    }
  }
});
