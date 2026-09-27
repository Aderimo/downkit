import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // e2e/: Playwright ile gerçek tarayıcıda çalışan testler (pnpm test:e2e).
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
