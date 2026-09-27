import { expect, test, type Page } from "@playwright/test";

// Klip Düzenleyici: demo sahnesinde 4 klip, imleç 2:10'da (ikinci klibin içinde).
const EDITOR = "/?demo=editor&lang=tr&route=editor";

const clips = (page: Page) => page.locator("[data-clip]");

test.describe("Klip Düzenleyici", () => {
  test("S böler, Delete siler, Ctrl+Z geri alır", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("s");
    await expect(clips(page)).toHaveCount(5);

    await page.keyboard.press("Delete");
    await expect(clips(page)).toHaveCount(4);

    await page.keyboard.press("Control+z");
    await expect(clips(page)).toHaveCount(5);
    await page.keyboard.press("Control+z");
    await expect(clips(page)).toHaveCount(4);
  });

  test("M klibi sessize alır, panelde ses düzeyi ve geçiş görünür", async ({ page }) => {
    await page.goto(EDITOR);
    await expect(page.getByText("Ses düzeyi")).toBeVisible();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Sessize al" }).click();
    await expect(page.getByRole("button", { name: "Sesi aç" })).toBeVisible();
    await page.getByRole("button", { name: "1 sn" }).first().click();
    await expect(page.getByRole("button", { name: "1 sn" }).first()).toHaveClass(/dk-accent/);
  });

  test("bölümlerden böl her bölümü ayrı klip yapar", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(page.getByText("Bölümler (5)")).toBeVisible();
    await page.getByRole("button", { name: "Bölümlerden böl" }).click();
    // 1:24–3:16 klibi "The bullies" (4:22) sınırına kadar; ilk klip bölünmez ama
    // bölüm adını alır, "Final" klibi "The plan"da kalır: toplam klip sayısı artmaz,
    // adlar gelir.
    await expect(page.locator("[data-clip]").filter({ hasText: "Meet Bunny" })).toHaveCount(1);
  });

  test("İndir penceresinde GIF ve dikey çerçeve seçilebilir", async ({ page }) => {
    await page.goto(EDITOR);
    // Dışa aktarma üst çubuktaki düğmeyle ortada açılan pencerede.
    await page.getByRole("button", { name: "Seçilenleri indir" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("tab", { name: "GIF" }).click();
    await expect(page.getByText("Kare hızı")).toBeVisible();

    await page.getByRole("tab", { name: "Video" }).click();
    await page.getByRole("button", { name: "Çerçeve" }).click();
    await page.getByRole("option", { name: /Dikey \(TikTok/ }).click();
    await expect(page.getByRole("slider", { name: "Kırpma konumu" }).first()).toBeVisible();
    await expect(page.getByText("9:16", { exact: true }).first()).toBeVisible();
  });

  test("yazı eklenir, metni değişir, silinir ve geri alınır", async ({ page }) => {
    await page.goto(`${EDITOR}&text=0`);
    await expect(page.locator("[data-text]")).toHaveCount(0);
    await page.getByRole("button", { name: "Yazı ekle" }).click();
    await expect(page.locator("[data-text]")).toHaveCount(1);
    const box = page.getByRole("textbox", { name: "Metin" });
    await box.fill("Merhaba DownKit");
    await expect(page.locator("[data-text]")).toContainText("Merhaba DownKit");
    await box.blur();
    await page.getByRole("button", { name: "Yazıyı sil" }).click();
    await expect(page.locator("[data-text]")).toHaveCount(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-text]")).toContainText("Merhaba DownKit");
  });

  test("filtre seçili klibe uygulanır ve önizlemede görünür", async ({ page }) => {
    await page.goto(EDITOR);
    await page.locator("[data-clip]").first().click();
    await page.getByRole("button", { name: "Filtreler" }).click();
    await page.getByRole("button", { name: /Siyah-beyaz/ }).click();
    await expect(page.getByRole("button", { name: /Siyah-beyaz/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("iz düğmeleriyle katman sessize alınır ve gizlenir", async ({ page }) => {
    await page.goto(EDITOR);
    const mute = page.getByRole("button", { name: "Bu katmanın sesini kapat" }).first();
    await mute.click();
    await expect(
      page.getByRole("button", { name: "Bu katmanın sesini aç" }).first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: /Bu katmanı gizle/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Bu katmanı göster" }).first()).toBeVisible();
  });

  test("metin şablonuyla yazı eklenir", async ({ page }) => {
    await page.goto(EDITOR + "&text=0");
    await expect(page.locator("[data-text]")).toHaveCount(0);
    await page.getByRole("button", { name: "Metin", exact: true }).click();
    await page.getByRole("button", { name: /Büyük başlık/ }).click();
    await expect(page.locator("[data-text]")).toHaveCount(1);
  });
});
