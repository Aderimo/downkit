import { defineConfig } from "@playwright/test";

// Arayüz akışlarını gerçek tarayıcıda dener (Tauri olmadan, ?demo= sahneleriyle).
// Bilgisayardaki tarayıcı kullanılır; ayrıca tarayıcı indirmek gerekmez. Edge 155
// (Ekim 2026) otomasyonda sayfaları çökertiyor: varsayılan Chrome, PW_CHANNEL=msedge
// ile Edge'e dönülür.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  // Vite dev sunucusu paralel yüklerde ilk derlemeyi yaparken yavaşlayabilir;
  // varsayılan 5 sn'lik bekleme yetmeyip testler haksız yere kırılmasın.
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    channel: process.env.PW_CHANNEL ?? "chrome",
    viewport: { width: 1440, height: 900 },
    locale: "tr-TR",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
