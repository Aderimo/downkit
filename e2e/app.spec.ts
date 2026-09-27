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
    await expect(dialog).toContainText("Adım 1 / 8");
    await dialog.getByRole("button", { name: "İleri" }).click();
    await expect(dialog).toContainText("Adım 2 / 8");
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
});
