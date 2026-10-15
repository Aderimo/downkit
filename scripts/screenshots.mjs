// README ve sürüm sayfası için ekran görüntüleri (iki dil). Tanıtım sahneleri
// tarayıcıda Tauri olmadan çizilir; önce `pnpm dev` çalışmalı.
// Kullanım: node scripts/screenshots.mjs  →  docs/screenshots/{en,tr}/*.png
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.DOWNKIT_URL ?? "http://localhost:1420";
const SHOTS = [
  { name: "download", query: "demo=home&route=download" },
  { name: "editor", query: "demo=editor&route=editor" },
  { name: "record", query: "demo=record&route=record" },
  { name: "screenshot", query: "demo=screenshot&route=screenshot" },
  { name: "snip-editor", query: "demo=snipEditor&route=screenshot" },
  { name: "settings", query: "demo=home&route=settings" },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
for (const lang of ["en", "tr"]) {
  mkdirSync(`docs/screenshots/${lang}`, { recursive: true });
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: lang === "tr" ? "tr-TR" : "en-US",
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "downkit.settings",
        JSON.stringify({ setupDone: true, showTutorial: false, pageTours: false }),
      );
    });
    await page.goto(`${BASE}/?${shot.query}&lang=${lang}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/screenshots/${lang}/${shot.name}.png` });
    await page.close();
    console.log(`${lang}/${shot.name}.png`);
  }
}
await browser.close();
