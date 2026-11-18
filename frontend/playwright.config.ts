import { defineConfig } from "@playwright/test";

const externalURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: externalURL ?? "http://127.0.0.1:8000",
    viewport: { width: 1440, height: 1050 },
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    trace: "retain-on-failure",
  },
  webServer: externalURL
    ? undefined
    : {
        command:
          "uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1",
        cwd: "..",
        url: "http://127.0.0.1:8000/health",
        reuseExistingServer: true,
      },
});
