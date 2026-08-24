import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./node_modules/.cache/playwright-results",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  projects: [
    {
      name: "chromium-320x844",
      use: {
        ...devices["Desktop Chrome"],
        viewport: {width: 320, height: 844},
      },
    },
    {
      name: "chromium-390x844",
      use: {
        ...devices["Desktop Chrome"],
        viewport: {width: 390, height: 844},
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
});
