import { defineConfig } from "@playwright/test";

// Yalnız ipucu animasyonlarını kaydetmek için (normal test takımına girmez).
export default defineConfig({
  testDir: ".",
  testMatch: "record.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    channel: process.env.PW_CHANNEL ?? "chrome",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
