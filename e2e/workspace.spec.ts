import { expect, test, type Page } from "@playwright/test";

// Çalışma alanı: paneller kapatılıp geri açılır, sürüklenip yerleştirilir, hazır düzenler
// arasında geçilir; kendi düzen kaydedilir, yeniden açılışta korunur ve silinir.

const EDITOR = "/?demo=editor&lang=tr&route=editor";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "downkit.settings",
      JSON.stringify({ setupDone: true, showTutorial: false, pageTours: false }),
    );
  });
});

const tab = (page: Page, id: string) => page.locator(`[data-tab-panel-id="${id}"]`);

async function openLayoutMenu(page: Page) {
  await page.locator("[data-tour=editor-workspace]").click();
  return page.getByRole("menu", { name: "Düzen" });
}

test("panel kapatılır, Düzen menüsünden geri açılır; Video ve Zaman çizelgesi kapatılamaz", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await expect(page.locator("[data-phone-panel]")).toBeVisible();
  // Sabit panellerin sekmesinde kapatma düğmesi yok.
  await expect(tab(page, "viewer").locator(".dv-default-tab-action")).toHaveCount(0);
  await expect(tab(page, "timeline").locator(".dv-default-tab-action")).toHaveCount(0);

  await tab(page, "phone").locator(".dv-default-tab-action").click();
  await expect(page.locator("[data-phone-panel]")).toHaveCount(0);
  let menu = await openLayoutMenu(page);
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "Telefon", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await menu.getByRole("menuitemcheckbox", { name: "Telefon", exact: true }).click();
  await expect(page.locator("[data-phone-panel]")).toBeVisible();
  // Oynatma çubuğundaki telefon düğmesi de aynı paneli açıp kapatır.
  await page.getByRole("button", { name: "Telefonda nasıl görünür" }).click();
  await expect(page.locator("[data-phone-panel]")).toHaveCount(0);
  await page.getByRole("button", { name: "Telefonda nasıl görünür" }).click();
  await expect(page.locator("[data-phone-panel]")).toBeVisible();
  menu = await openLayoutMenu(page);
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "Telefon", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
});

test("hazır düzenler arasında geçilir: Odak'ta yalnız video ve zaman çizelgesi", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  let menu = await openLayoutMenu(page);
  await menu.getByRole("menuitemcheckbox", { name: "Odak" }).click();
  await expect(tab(page, "tools")).toHaveCount(0);
  await expect(tab(page, "inspector")).toHaveCount(0);
  await expect(tab(page, "viewer")).toBeVisible();
  await expect(page.locator("[data-tour=editor-workspace]")).toContainText("Odak");
  menu = await openLayoutMenu(page);
  await menu.getByRole("menuitemcheckbox", { name: "Sinema" }).click();
  await expect(tab(page, "tools")).toBeVisible();
  await expect(tab(page, "inspector")).toBeVisible();
  await expect(tab(page, "phone")).toBeVisible();
  // Adım adım: üstte adımlar çıkar, Altyazı adımı aracı açar.
  menu = await openLayoutMenu(page);
  await menu.getByRole("menuitemcheckbox", { name: "Adım adım" }).click();
  const steps = page.locator("[data-simple-steps]");
  await expect(steps).toBeVisible();
  await steps.getByRole("button", { name: /Altyazı/ }).click();
  await expect(page.getByRole("button", { name: "Altyazı", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("kendi düzeni kaydedilir, sayfa yenilenince korunur, yeniden adlandırılır ve silinir", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await tab(page, "inspector").locator(".dv-default-tab-action").click();
  await expect(tab(page, "inspector")).toHaveCount(0);
  let menu = await openLayoutMenu(page);
  await menu.getByRole("menuitem", { name: "Şu anki düzeni kaydet…" }).click();
  // Boş adla kaydedilmez.
  await menu.getByRole("button", { name: "Kaydet" }).click();
  await expect(menu.getByText("Bir ad yaz.")).toBeVisible();
  await menu.getByRole("textbox", { name: "Düzen adı" }).fill("Altyazı işi");
  await menu.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator("[data-tour=editor-workspace]")).toContainText("Altyazı işi");

  await page.reload();
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await expect(page.locator("[data-tour=editor-workspace]")).toContainText("Altyazı işi");
  await expect(tab(page, "inspector")).toHaveCount(0);

  menu = await openLayoutMenu(page);
  await menu.getByRole("button", { name: "Altyazı işi adını değiştir" }).click();
  await menu.getByRole("textbox", { name: "Düzen adı" }).fill("Kısa iş");
  await menu.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator("[data-tour=editor-workspace]")).toContainText("Kısa iş");

  menu = await openLayoutMenu(page);
  await menu.getByRole("button", { name: "Kısa iş düzenini sil" }).click();
  await expect(page.locator("[data-tour=editor-workspace]")).toContainText("Sinema");
  await expect(tab(page, "inspector")).toBeVisible();
});

test("sekme sürüklenip başka grubun ortasına bırakılınca orada sekme olur; sıfırla eski yerine döndürür", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  const phoneTab = tab(page, "phone");
  const viewerContent = page.locator("[data-tour=editor-player]");
  const from = (await phoneTab.boundingBox())!;
  const to = (await viewerContent.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  // Telefon artık Video ile aynı grupta (iki sekme yan yana, aynı başlık çubuğunda).
  const viewerTabBox = (await tab(page, "viewer").boundingBox())!;
  const phoneTabBox = (await phoneTab.boundingBox())!;
  expect(Math.abs(viewerTabBox.y - phoneTabBox.y)).toBeLessThan(3);
  expect(phoneTabBox.x - viewerTabBox.x).toBeLessThan(200);

  const menu = await openLayoutMenu(page);
  await menu.getByRole("menuitem", { name: "Kaydedilen hâline sıfırla" }).click();
  const after = (await phoneTab.boundingBox())!;
  expect(after.x).toBeGreaterThan(viewerTabBox.x + 300);
});

test("araç simgesinin üzerinde bekleyince önce adı, sonra açıklaması görünür", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await page.getByRole("button", { name: "Kısalt", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText("Kısalt", { timeout: 1200 });
  await expect(tip.locator("[data-tip-detail]")).toContainText("Sessizlikleri", { timeout: 2500 });
  // Örnek animasyon yüklenip oynar.
  const video = tip.locator("video");
  await expect(video).toHaveAttribute("src", "/tips/autocut.webm");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.mouse.move(700, 450);
  await expect(tip).toHaveCount(0);
});

test("dar pencerede telefon video ile aynı grupta sekme olur, taşma yok", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("downkit.workspaces"));
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  const viewerTabBox = (await tab(page, "viewer").boundingBox())!;
  const phoneTabBox = (await tab(page, "phone").boundingBox())!;
  expect(Math.abs(viewerTabBox.y - phoneTabBox.y)).toBeLessThan(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
