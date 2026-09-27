import { expect, test } from "@playwright/test";

test.describe("Uygulama kabuğu", () => {
  test("kenar çubuğu daraltılır ve yeniden açılınca hatırlanır", async ({ page }) => {
    await page.goto("/?demo=home&lang=tr&route=home");
    await page.getByRole("button", { name: "Menüyü daralt" }).click();
    await expect(page.getByRole("button", { name: "Menüyü genişlet" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Menüyü genişlet" })).toBeVisible();
    await page.getByRole("button", { name: "Menüyü genişlet" }).click();
  });

  test("tema seçilince hemen uygulanır ve yenilemeden sonra korunur", async ({ page }) => {
    await page.goto("/?demo=home&lang=tr&route=settings");
    const html = page.locator("html");
    await page.getByRole("button", { name: /Kar Beyazı/ }).click();
    await expect(html).toHaveAttribute("data-mode", "light");
    await expect(html).toHaveAttribute("data-theme", "snow");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "snow");
    await page.getByRole("button", { name: /Grafit/ }).click();
    await expect(html).toHaveAttribute("data-mode", "dark");
    await expect(page.getByRole("button", { name: /Grafit/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("tanıtım turu açılır, adımlar ilerler ve kapatılır", async ({ page }) => {
    // Demo modunda tur kendiliğinden açılmaz; tur sahnesi doğrudan açar.
    await page.goto("/?demo=tutorial&lang=tr&route=home");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Turu başlat" }).click();
    await expect(dialog).toContainText("Adım 1 / 9");
    await dialog.getByRole("button", { name: "İleri" }).click();
    await expect(dialog).toContainText("Adım 2 / 9");
    await dialog.getByRole("button", { name: "Turu kapat" }).first().click();
    await expect(dialog).toBeHidden();
  });

  test("Ekran Kaydı sayfası: kayıt, anlık tekrar ve kayıtlar görünür", async ({ page }) => {
    await page.goto("/?demo=record&lang=tr&route=record");
    await expect(page.getByRole("heading", { name: "Ekran Kaydı" })).toBeVisible();
    await expect(page.locator('[data-tour="record-main"]')).toContainText("Kaydediliyor");
    await expect(page.locator('[data-tour="record-replay"]')).toContainText("Arabellek 0:30");
    await expect(page.locator('[data-tour="record-library"] button.group')).toHaveCount(5);
    // Durum çubuğu ve kenar çubuğu göstergeleri.
    await expect(page.getByRole("button", { name: /Kayıt 12:34/ })).toBeVisible();
  });

  test("Ekran Görüntüsü sayfası: yakalama, ayarlar ve görüntülerim", async ({ page }) => {
    await page.goto("/?demo=screenshot&lang=tr&route=screenshot");
    await expect(page.getByRole("heading", { name: "Ekran Görüntüsü", exact: true })).toBeVisible();
    const capture = page.locator('[data-tour="snip-capture"]');
    await expect(capture).toContainText("Alan seç");
    await expect(capture).toContainText("Alt + Shift + S");
    await expect(page.locator('[data-tour="snip-hotkeys"]')).toContainText("Hızlı çeviri");
    await expect(page.locator('[data-tour="snip-library"] li')).toHaveCount(6);
    // Ayar değişince kalıcı olur.
    await page.getByRole("switch", { name: "Kaydederken panoya da kopyala" }).click();
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Kaydederken panoya da kopyala" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("Ekran görüntüsü düzenleyicisi: araç seçilir, çizilir, geri alınır", async ({ page }) => {
    await page.goto("/?demo=snipEditor&lang=tr&route=screenshot");
    const canvas = page.locator('[data-tour="snip-editor"] canvas');
    await expect(canvas).toBeVisible();
    const undo = page.getByRole("button", { name: "Geri al" });
    await expect(undo).toBeDisabled();
    // Klavyeyle dikdörtgen aracı, sürükleyerek çizim.
    await page.keyboard.press("r");
    await expect(page.getByRole("button", { name: "Dikdörtgen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await expect(undo).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect(undo).toBeDisabled();
    // Kırpınca çıktı boyutu değişir.
    await page.keyboard.press("c");
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Kırpmayı kaldır" })).toBeVisible();
    await expect(page.locator('[data-tour="snip-tools"]')).not.toContainText("1440 × 900");
  });
});
