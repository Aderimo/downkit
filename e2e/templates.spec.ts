import { expect, test } from "@playwright/test";

const EDITOR = "/?demo=editor&lang=tr&route=editor&select=none&t=20&text=0";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "downkit.settings",
      JSON.stringify({ setupDone: true, showTutorial: false, pageTours: false }),
    );
  });
});

const state = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/src/store/editorStore.ts")) as string;
    const { useEditorStore } = await import(/* @vite-ignore */ url);
    const s = useEditorStore.getState();
    return {
      texts: s.texts.map((t: { text: string; tpl?: string }) => ({ text: t.text, tpl: t.tpl })),
      frame: s.exportOptions.frame,
      fit: s.exportOptions.frameFit,
      blur: s.exportOptions.frameBlur,
      progress: s.exportOptions.progressBar,
    };
  });

test("şablon uygulanır, yeniden seçilince yazıları değişir; kanca ve bitiş eklenir, kaldırılır", async ({
  page,
}) => {
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await page.getByRole("button", { name: "Şablonlar", exact: true }).click();
  await page.locator('[data-template="titleQuestion"]').click();
  let s = await state(page);
  expect(s).toMatchObject({
    frame: "9:16",
    fit: true,
    blur: true,
    progress: { color: "#ffd43b", top: false },
  });
  expect(s.texts).toEqual([
    { text: "Başlığını buraya yaz", tpl: "layout" },
    { text: "Sence hangisi?", tpl: "layout" },
  ]);
  // Önizlemede yazılar ve dolan ilerleme çubuğu.
  await expect(page.locator("[data-text]")).toHaveCount(2);
  await expect(page.locator("[data-progress-bar]")).toBeVisible();

  // Aynı türden başka şablon: eskisinin yazıları gider.
  await page.locator('[data-template="quote"]').click();
  s = await state(page);
  expect(s.frame).toBe("1:1");
  expect(s.texts.map((t) => t.text)).toEqual(["“Alıntını buraya yaz”", "— Konuşmacı"]);

  await page.locator('[data-template="hookStop"]').click();
  await page.locator('[data-template="endFollow"]').click();
  s = await state(page);
  expect(s.texts.map((t) => t.tpl)).toEqual(["layout", "layout", "hook", "end"]);
  await page.getByRole("button", { name: "Kanca (ilk saniyeler) yazılarını kaldır" }).click();
  s = await state(page);
  expect(s.texts.map((t) => t.tpl)).toEqual(["layout", "layout", "end"]);

  // İlerleme çubuğu: renk, üst/alt, kapat.
  const controls = page.locator("[data-progress-controls]");
  await controls.getByRole("button", { name: "#4ade80" }).click();
  await controls.getByRole("button", { name: "Altta" }).click();
  s = await state(page);
  expect(s.progress).toMatchObject({ color: "#4ade80", top: true });
  await controls.getByRole("switch", { name: "İlerleme çubuğu" }).click();
  await expect(page.locator("[data-progress-bar]")).toHaveCount(0);
});

test("marka kiti oluşturulur, kaydedilir ve projeye tek tıkla uygulanır", async ({ page }) => {
  await page.goto(EDITOR);
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  // Önce bir şablon: şeritli başlık + soru; ayrıca otomatik altyazı.
  await page.getByRole("button", { name: "Şablonlar", exact: true }).click();
  await page.locator('[data-template="titleQuestion"]').click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/src/store/editorStore.ts")) as string;
    const { useEditorStore } = await import(/* @vite-ignore */ url);
    useEditorStore.getState().applyTexts((texts: unknown[]) => [
      ...texts,
      {
        id: "cap",
        text: "merhaba",
        start: 1,
        end: 2,
        x: 0.5,
        y: 0.8,
        size: 0.07,
        color: "#ffffff",
        box: false,
        bold: true,
        auto: true,
        highlight: { mode: "color", color: "#ffffff" },
      },
    ]);
  });
  await page.getByRole("button", { name: "Hazır ayar", exact: true }).click();
  const section = page.locator("[data-brand-kits]");
  await section.getByRole("button", { name: /Yeni marka kiti/ }).click();
  const form = page.locator("[data-brand-form]");
  await form.getByRole("textbox", { name: "Kit adı" }).fill("Oyun kanalı");
  await form
    .getByRole("group", { name: "Ana renk" })
    .getByRole("button", { name: "#a855f7" })
    .click();
  await form
    .getByRole("group", { name: "Vurgu rengi" })
    .getByRole("button", { name: "#4ade80" })
    .click();
  await form.getByRole("button", { name: "Yazı tipi" }).click();
  await page.getByRole("option", { name: "Impact" }).click();
  await form.getByRole("textbox", { name: /Açılış yazısı/ }).fill("Bugün çok zor bir bölüm");
  await form.getByRole("textbox", { name: /Kapanış yazısı/ }).fill("Abone olmayı unutma");
  // Projede ilerleme çubuğu var: kitte de açık gelir.
  await expect(form.getByRole("switch", { name: /İlerleme çubuğu/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(section.locator('[data-brand-kit="Oyun kanalı"]')).toBeVisible();

  await section.getByRole("button", { name: "Oyun kanalı kitini bu projeye uygula" }).click();
  await expect(section.getByRole("status")).toContainText("Oyun kanalı uygulandı");
  const s = await state(page);
  expect(s.texts.map((t) => t.text)).toEqual([
    "Başlığını buraya yaz",
    "Sence hangisi?",
    "merhaba",
    "Bugün çok zor bir bölüm",
    "Abone olmayı unutma",
  ]);
  expect(s.progress).toMatchObject({ color: "#4ade80" });
  const styled = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/src/store/editorStore.ts")) as string;
    const { useEditorStore } = await import(/* @vite-ignore */ url);
    return useEditorStore
      .getState()
      .texts.map((t: { font?: string; bg?: string; highlight?: { color: string } }) => [
        t.font,
        t.bg ?? null,
        t.highlight?.color ?? null,
      ]);
  });
  // Şeritli başlıklar ana renk, otomatik altyazının vurgusu vurgu rengi; hepsi Impact.
  expect(styled[0]).toEqual(["impact", "#a855f7", null]);
  expect(styled[2]).toEqual(["impact", null, "#4ade80"]);
  // Kit sayfa yenilenince de durur.
  await page.reload();
  await expect(page.locator("[data-clip]").first()).toBeVisible();
  await page.getByRole("button", { name: "Hazır ayar", exact: true }).click();
  await expect(page.locator('[data-brand-kit="Oyun kanalı"]')).toBeVisible();
});
