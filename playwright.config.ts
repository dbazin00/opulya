import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { testDatabaseUrl } from "./packages/config/test-database.js";
const database = testDatabaseUrl();
if (!new URL(database).pathname.endsWith("/opulya_test"))
  throw new Error("Browser tests require opulya_test");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: process.platform === "win32" ? "msedge" : "chromium",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command:
        "npm exec -- tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts",
      url: "http://localhost:4001/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: database,
        WEB_ORIGIN: "http://localhost:3001",
        API_PORT: "4001",
        NODE_ENV: "test",
        EMAIL_TRANSPORT: "test",
        EMAIL_SENDS_PER_HOUR: "10000",
        EMAIL_SENDS_PER_DAY: "10000",
        EMAIL_TEST_OUTBOX_DIR: fileURLToPath(
          new URL("./.runtime/e2e-mail/", import.meta.url),
        ),
        OPULYA_TEST: "0",
        ALPHA_VANTAGE_API_KEY: "",
      },
    },
    {
      command: "npm run dev --workspace @opulya/web -- --port 3001",
      url: "http://localhost:3001/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_INTERNAL_URL: "http://127.0.0.1:4001",
        NEXT_DIST_DIR: ".next-e2e",
        NODE_ENV: "development",
      },
    },
  ],
});
