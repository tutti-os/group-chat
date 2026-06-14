import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8799);
const baseURL = `http://127.0.0.1:${port}`;
const chromeExecutablePath =
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        launchOptions: {
          executablePath: chromeExecutablePath,
        },
      },
    },
  ],
  webServer: {
    command: `rm -rf .group-chat/e2e && mkdir -p .group-chat/e2e && GROUP_CHAT_HOME="$PWD/.group-chat/e2e" PORT=${port} HOST=127.0.0.1 pnpm --filter @group-chat/server exec tsx src/main.ts`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
