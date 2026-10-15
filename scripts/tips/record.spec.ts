import { test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// İpucu animasyonları: her araç demo sahnesinde kısaca kullanılır, sayfa videoya
// kaydedilir; encode.mjs ilgili bölgeyi kırpıp public/tips/<araç>.webm yapar.
// Çalıştırma: npx playwright test -c scripts/tips/playwright.tips.config.ts

const OUT = "scripts/tips/raw";
mkdirSync(OUT, { recursive: true });

type Scenario = {
  id: string;
  /** Kırpılacak bölge: bu öğelerin kutularının birleşimi. */
  crop: string[];
  url?: string;
  run: (page: Page) => Promise<void>;
};

const EDITOR = "/?demo=editor&lang=tr&route=editor";
const LEFT = ["[data-tour=editor-add]", "[data-tour=editor-player]"];
const RIGHT = ["[data-tour=editor-player]", "[data-tour=editor-panel]"];
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
/** Aracı açar (zaten açıksa dokunmaz: ikinci tık kapatır). */
async function tool(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

async function captions(page: Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/src/store/editorStore.ts")) as string;
    const { useEditorStore } = await import(/* @vite-ignore */ url);
    const words = (text: string, start: number) =>
      text
        .split(" ")
        .map((w, i) => ({ text: w, start: start + i * 0.45, end: start + i * 0.45 + 0.4 }));
    const make = (id: string, text: string, start: number) => ({
      id,
      text,
      start,
      end: start + 1.9,
      x: 0.5,
      y: 0.75,
      size: 0.07,
      color: "#ffffff",
      box: false,
      bold: true,
      auto: true,
      words: words(text, start),
    });
    useEditorStore
      .getState()
      .applyTexts(() => [
        make("a", "bu oyun gerçekten çok", 4),
        make("b", "zor ama çok eğlenceli", 6),
      ]);
  });
}

const SCENARIOS: Scenario[] = [
  {
    id: "media",
    crop: ["[data-tour=editor-add]", "[data-tour=editor-timeline]"],
    run: async (page) => {
      await tool(page, "Medya");
      await wait(page, 500);
      const card = page.getByTitle("Tıkla: önizle · Sürükle: zaman çizelgesine ekle").first();
      const lane = (await page.locator("[data-clip]").last().boundingBox())!;
      await card.hover();
      await page.mouse.down();
      await page.mouse.move(lane.x + lane.width + 60, lane.y + lane.height / 2, { steps: 25 });
      await wait(page, 300);
      await page.mouse.up();
      await wait(page, 900);
    },
  },
  {
    id: "templates",
    url: `${EDITOR}&select=none&t=20&text=0`,
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Şablonlar");
      await wait(page, 500);
      await page.locator('[data-template="titleQuestion"]').click();
      await wait(page, 900);
      await page.locator('[data-template="hookStop"]').click();
      await wait(page, 900);
    },
  },
  {
    id: "text",
    url: `${EDITOR}&text=0`,
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Metin");
      await wait(page, 600);
      await page.getByRole("button", { name: /Büyük başlık/ }).click();
      await wait(page, 1300);
    },
  },
  {
    id: "music",
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Müzik");
      await wait(page, 1800);
    },
  },
  {
    id: "images",
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Logo");
      await wait(page, 1800);
    },
  },
  {
    id: "transitions",
    url: `${EDITOR}&select=none&t=110`,
    crop: ["[data-tour=editor-add]", "[data-tour=editor-timeline]"],
    run: async (page) => {
      await tool(page, "Geçişler");
      await wait(page, 500);
      await page.getByRole("button", { name: /Çapraz geçiş/ }).click();
      await wait(page, 1400);
    },
  },
  {
    id: "subtitles",
    url: `${EDITOR}&select=none&t=5&text=0`,
    crop: LEFT,
    run: async (page) => {
      await captions(page);
      await tool(page, "Altyazı");
      await wait(page, 500);
      for (const p of ["yellowWord", "boxed", "neon"]) {
        const tile = page.locator(`[data-caption-preset="${p}"]`);
        if (await tile.count()) {
          await tile.click();
          await wait(page, 700);
        }
      }
    },
  },
  {
    id: "autocut",
    url: `${EDITOR}&select=none&t=1`,
    crop: ["[data-tour=editor-add]", "[data-tour=editor-timeline]"],
    run: async (page) => {
      await tool(page, "Kısalt");
      await wait(page, 500);
      await page.getByRole("button", { name: "Klip öner" }).click();
      await wait(page, 1500);
    },
  },
  {
    id: "blur",
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Gizle");
      await wait(page, 500);
      await page.getByRole("button", { name: "Gizlenecek alan ekle" }).click();
      await wait(page, 600);
      await page.getByRole("button", { name: "Pikselli" }).click();
      await wait(page, 900);
    },
  },
  {
    id: "presets",
    crop: LEFT,
    run: async (page) => {
      await tool(page, "Hazır ayar");
      await wait(page, 1800);
    },
  },
  {
    id: "clip",
    crop: RIGHT,
    run: async (page) => {
      await tool(page, "Klip");
      await wait(page, 500);
      await page.getByRole("button", { name: "2×" }).first().click();
      await wait(page, 1300);
    },
  },
  {
    id: "filters",
    crop: RIGHT,
    run: async (page) => {
      await page.locator("[data-clip]").first().click();
      await tool(page, "Filtreler");
      await wait(page, 500);
      await page.getByRole("button", { name: /Siyah-beyaz/ }).click();
      await wait(page, 1300);
    },
  },
  {
    id: "color",
    crop: RIGHT,
    run: async (page) => {
      await tool(page, "Renk");
      await wait(page, 500);
      const slider = page.getByRole("slider").first();
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 15 });
      await page.mouse.up();
      await wait(page, 900);
    },
  },
  {
    id: "effects",
    crop: RIGHT,
    run: async (page) => {
      await tool(page, "Efektler");
      await wait(page, 1800);
    },
  },
];

test.use({ viewport: { width: 1440, height: 900 } });

for (const s of SCENARIOS.filter((x) => !process.env.TIP || x.id === process.env.TIP)) {
  test(`ipucu ${s.id}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "downkit.settings",
        JSON.stringify({ setupDone: true, showTutorial: false, pageTours: false }),
      );
      localStorage.removeItem("downkit.workspaces");
    });
    await page.goto(s.url ?? EDITOR);
    await page.waitForSelector("[data-clip]");
    await wait(page, 900);
    const boxes = await Promise.all(s.crop.map((c) => page.locator(c).first().boundingBox()));
    const valid = boxes.filter((b): b is NonNullable<typeof b> => b !== null);
    const x = Math.floor(Math.min(...valid.map((b) => b.x)));
    const y = Math.floor(Math.min(...valid.map((b) => b.y)));
    const clip = {
      x,
      y,
      width: Math.ceil(Math.max(...valid.map((b) => b.x + b.width)) - x),
      height: Math.ceil(Math.max(...valid.map((b) => b.y + b.height)) - y),
    };
    // Kareler ekran görüntüsüyle (video kaydı ek indirme istiyor).
    const dir = `${OUT}/${s.id}`;
    mkdirSync(dir, { recursive: true });
    let frame = 0;
    let running = true;
    const started = Date.now();
    const capture = (async () => {
      while (running) {
        const buf = await page.screenshot({ clip, animations: "allow" }).catch(() => null);
        if (buf) writeFileSync(`${dir}/${String(frame++).padStart(4, "0")}.png`, buf);
      }
    })();
    await wait(page, 300);
    await s.run(page);
    running = false;
    await capture;
    writeFileSync(
      `${dir}/meta.json`,
      JSON.stringify({ frames: frame, seconds: (Date.now() - started) / 1000 }),
    );
  });
}
