import { expect, test, type Page } from "@playwright/test";

// Klip Düzenleyici: demo sahnesinde 4 klip, imleç 2:10'da (ikinci klibin içinde).
const EDITOR = "/?demo=editor&lang=tr&route=editor";

const clips = (page: Page) => page.locator("[data-clip]");

test.describe("Klip Düzenleyici", () => {
  // Bazı testler yüklü modülleri kaynak listesinden bulur; varsayılan 250 kayıtlık
  // arabellek dolunca geç yüklenen modüller listede görünmez.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
  });

  test("S böler, Delete siler, Ctrl+Z geri alır", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("s");
    await expect(clips(page)).toHaveCount(5);

    // Hiçbir şey seçili değilken Delete bir şey silmez; seçili klip silinir.
    await page.keyboard.press("Delete");
    await expect(clips(page)).toHaveCount(5);
    await clips(page)
      .first()
      .click({ position: { x: 20, y: 30 } });
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
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "GIF" }).click();
    await expect(page.getByText("Kare hızı")).toBeVisible();

    await dialog.getByRole("tab", { name: "Video" }).click();
    await page.getByRole("button", { name: "Çerçeve" }).click();
    await page.getByRole("option", { name: /Dikey kısa video/ }).click();
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

  test("klipler arası geçiş kesime konur, panelde süresi değişir ve kaldırılır", async ({
    page,
  }) => {
    // İmleç ilk kesimde (1:52): seçim yokken geçiş en yakın kesime konur.
    await page.goto(`${EDITOR}&select=none&t=110`);
    await page.getByRole("button", { name: "Geçişler", exact: true }).click();
    await page.getByRole("button", { name: /Çapraz geçiş/ }).click();
    const marker = page.locator("[data-xfade]");
    await expect(marker).toHaveCount(1);
    await marker.click();
    await expect(page.getByText("Sonraki klibe geçiş", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "2 sn" }).last().click();
    await expect(marker).toHaveAttribute("title", /2.0 sn/);
    await page.getByRole("button", { name: "Geçişi kaldır" }).click();
    await expect(marker).toHaveCount(0);
  });

  test("geçiş fareyle sürüklenip klibin kenarına bırakılır", async ({ page }) => {
    // Windows'ta HTML5 sürüklemesi çalışmadığı için sürükleme fare olaylarıyla yapılır.
    await page.goto(`${EDITOR}&select=none&t=10`);
    await page.getByRole("button", { name: "Geçişler", exact: true }).click();
    await expect(page.locator("[data-xfade]")).toHaveCount(0);
    const tile = page.getByRole("button", { name: /Çapraz geçiş/ });
    const target = await clips(page).nth(1).boundingBox();
    if (!target) throw new Error("klip yok");
    await tile.hover();
    await page.mouse.down();
    await page.mouse.move(target.x + 30, target.y + target.height / 2, { steps: 8 });
    await page.mouse.move(target.x + 6, target.y + target.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator("[data-xfade]")).toHaveCount(1);
  });

  test("medya kartı zaman çizelgesine sürüklenince klip eklenir", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    const card = page.getByTitle("Tıkla: önizle · Sürükle: zaman çizelgesine ekle").first();
    const lane = await clips(page).last().boundingBox();
    if (!lane) throw new Error("klip yok");
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(lane.x + lane.width + 60, lane.y + lane.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(clips(page)).toHaveCount(5);
  });

  test("filtre sürüklenip klibe bırakılınca uygulanır ve efekt listesinde görünür", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none`);
    await page.getByRole("button", { name: "Filtreler" }).click();
    const tile = page.getByRole("button", { name: /Siyah-beyaz/ });
    const target = await clips(page).nth(1).boundingBox();
    if (!target) throw new Error("klip yok");
    await tile.hover();
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Klip", exact: true }).click();
    await expect(page.locator("[data-applied-effects]")).toContainText("Siyah-beyaz");
    await page.getByRole("button", { name: /Kaldır: Filtreler/ }).click();
    // Başka efekt kalmayınca liste hiç görünmez.
    await expect(page.locator("[data-applied-effects]")).toHaveCount(0);
  });

  test("yazı şablonu zaman çizelgesine sürüklenince o ana eklenir", async ({ page }) => {
    await page.goto(`${EDITOR}&text=0&select=none`);
    await page.getByRole("button", { name: "Metin", exact: true }).click();
    const tile = page.getByRole("button", { name: /Büyük başlık/ });
    const target = await clips(page).first().boundingBox();
    if (!target) throw new Error("klip yok");
    await tile.hover();
    await page.mouse.down();
    await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("[data-text]")).toHaveCount(1);
  });

  test("ses Ctrl+L ile A1'e ayrılır, iz susturulur, geri alınır", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await clips(page).nth(1).click();
    await page.keyboard.press("Control+l");
    const audio = page.locator('[data-lane="music"][data-audio-lane="0"]');
    await expect(audio).toHaveCount(1);
    await expect(page.locator("[data-applied-effects]")).toContainText("Ses ayrıldı (A1)");
    const mute = page.getByRole("button", { name: "A1 izini sessize al" });
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    // Geri bağla: ses bloğu kalkar, klibin sesi açılır.
    await page.getByRole("button", { name: "Sesi geri bağla" }).click();
    await expect(audio).toHaveCount(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(audio).toHaveCount(1);
  });

  test("Shift+Delete boşluğu kapatır; Ctrl+C/Ctrl+V yapıştırır; Ctrl+G grupla birlikte seçilir", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=0`);
    const lefts = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-clip]")]
          .map((el) => Math.round(el.getBoundingClientRect().left))
          .sort((a, b) => a - b),
      );
    await expect(clips(page)).toHaveCount(4);
    const before = await lefts();
    // Ana izdeki ikinci klip: sil ve boşluğu kapat → üçüncü klip onun yerine gelir.
    await clips(page).nth(1).click();
    await page.keyboard.press("Shift+Delete");
    await expect(clips(page)).toHaveCount(3);
    expect((await lefts()).length).toBe(3);
    expect((await lefts())[1]).toBeLessThan(before[2]);
    // Kopyala / yapıştır: imleç 0'da dolu → ileride ilk boş yere eklenir.
    await clips(page).first().click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(clips(page)).toHaveCount(4);
    // İki klibi grupla: birine tıklayınca ikisi de seçili.
    await clips(page).first().click();
    await clips(page)
      .nth(1)
      .click({ modifiers: ["Shift"] });
    await page.keyboard.press("Control+g");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Escape");
    await clips(page).first().click();
    await expect(page.getByText(/2 klip seçili/)).toBeVisible();
  });

  test("önizlemede ızgara, önce/sonra ve kare adımı; durum çubuğundan işlemler açılır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=10`);
    await page.getByRole("button", { name: "Izgara ve güvenli alan" }).click();
    await expect(page.locator("[data-preview-grid]")).toBeVisible();
    await page.getByRole("button", { name: "Önce / sonra karşılaştır" }).click();
    await expect(page.locator("[data-compare]")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Karşılaştırma çizgisi" })).toBeVisible();
    await page.getByRole("button", { name: "Bir kare ileri" }).click();
    await expect(page.getByText(/^0:10.0[1-9]$/).first()).toBeVisible();
    await page.getByRole("button", { name: /işlem çalışıyor/ }).click();
    await expect(page.locator("[data-jobs-popover]")).toBeVisible();
  });

  test("Ctrl+K araç arama panel açar; basit mod araçları azaltır", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    // Test tarayıcısı Ctrl+K'yi kendi arama kutusu için alıyor; "Diğer" menüsündeki öğe aynı pencereyi açar.
    await page.getByRole("button", { name: "Diğer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Araç ara (Ctrl+K)" }).click();
    const box = page.getByRole("dialog", { name: "Araç ara" });
    await expect(box).toBeVisible();
    // Türkçe harfsiz yazınca da bulur.
    await page.keyboard.type("altyazi");
    await page.keyboard.press("Enter");
    await expect(box).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Altyazı", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Basit mod: logo ve gizleme araçları kalkar, gelişmişte geri gelir.
    await page.getByRole("button", { name: "Basit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Logo", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Gelişmiş", exact: true }).click();
    await expect(page.getByRole("button", { name: "Logo", exact: true })).toBeVisible();
  });

  test("altyazı stüdyosu: stil uygulanır, kelime vurgusu görünür, satır başına kelime yeniden böler", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=5&text=0`);
    await expect(clips(page)).toHaveCount(4);
    // Kelime zamanlı iki otomatik altyazı (gerçek altyazı motorunun çıktısıyla aynı biçim).
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
        y: 0.78,
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
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    await page.locator('[data-caption-preset="yellowWord"]').click();
    // 5. saniyede üçüncü kelime konuşuluyor: önizlemede vurgulu.
    await expect(page.locator("[data-word-active]")).toHaveText("GERÇEKTEN");
    await page.getByRole("button", { name: "1", exact: true }).click();
    await expect(page.locator("[data-text]")).toHaveCount(8);
    await page.getByRole("button", { name: "4", exact: true }).click();
    await expect(page.locator("[data-text]")).toHaveCount(2);
  });

  test("transkript: satır düzeltilir, anahtar kelime işaretlenir, kelime silinir", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=1&text=0`);
    await expect(clips(page)).toHaveCount(4);
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
        y: 0.78,
        size: 0.07,
        color: "#ffffff",
        box: false,
        bold: true,
        auto: true,
        font: "impact",
        words: words(text, start),
      });
      useEditorStore
        .getState()
        .applyTexts(() => [make("a", "bu oyun çok zor", 4), make("b", "ama çok eğlenceli", 6)]);
    });
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    await expect(page.locator("[data-transcript-line]")).toHaveCount(2);
    // Satırı düzelt: kelime sayısı aynı, metin değişir.
    const first = page.locator('[data-transcript-line="a"]');
    await first.getByRole("button", { name: "Satırı düzelt" }).click();
    const input = first.getByRole("textbox", { name: "Satırı düzelt" });
    await input.fill("bu oyun çok kolay");
    await input.press("Enter");
    await expect(first.locator("[data-word-chip]").nth(3)).toHaveText("kolay");
    // Anahtar kelime ve kelime silme.
    await first.locator("[data-word-chip]").nth(2).hover();
    await first.getByRole("button", { name: "Anahtar kelime: çok" }).click();
    await first.locator("[data-word-chip]").nth(0).hover();
    await first.getByRole("button", { name: "Kelimeyi sil: bu" }).click();
    await expect(first.locator("[data-word-chip]")).toHaveCount(3);
    await expect(page.locator('[data-text="a"]')).toContainText("oyun çok kolay");
  });

  test("emoji: anahtar kelimeye göre eklenir, önizlemede görünür, satırdan değiştirilir", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=4.5&text=0`);
    await expect(clips(page)).toHaveCount(4);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      const make = (id: string, text: string, start: number) => ({
        id,
        text,
        start,
        end: start + 1.9,
        x: 0.5,
        y: 0.78,
        size: 0.07,
        color: "#ffffff",
        box: false,
        bold: true,
        auto: true,
      });
      useEditorStore
        .getState()
        .applyTexts(() => [make("a", "bu ay çok para biriktirdim", 4), make("b", "ama sonra", 6)]);
    });
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    await page.getByRole("switch", { name: "Emoji ekle" }).click();
    // Para geçen satırda 💰, diğerinde emoji yok; önizlemede renkli resim olarak.
    const line = page.locator('[data-transcript-line="a"]');
    await expect(line.getByRole("button", { name: "Emoji seç" })).toHaveText("💰");
    await expect(
      page.locator('[data-transcript-line="b"]').getByRole("button", { name: "Emoji seç" }),
    ).toHaveText("");
    const preview = page.locator("img[data-caption-emoji]");
    await expect(preview).toHaveAttribute("data-caption-emoji", "💰");
    await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
    // Satırdan başka emoji seç, sonra kaldır.
    await line.getByRole("button", { name: "Emoji seç" }).click();
    await line.getByRole("button", { name: "🔥" }).click();
    await expect(preview).toHaveAttribute("data-caption-emoji", "🔥");
    await line.getByRole("button", { name: "Emoji seç" }).click();
    await line.getByRole("button", { name: "Emojiyi kaldır" }).click();
    await expect(preview).toHaveCount(0);
    // Geri al: emoji geri gelir.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(preview).toHaveAttribute("data-caption-emoji", "🔥");
  });

  test("dolgu kelimeleri: bulunur, söz dolgusu elle seçilir, silinince altyazı ve klipler kısalır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=1&text=0`);
    await expect(clips(page)).toHaveCount(4);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      const words = (text: string, start: number) =>
        text
          .split(" ")
          .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
      const make = (id: string, text: string, start: number) => ({
        id,
        text,
        start,
        end: start + text.split(" ").length * 0.5,
        x: 0.5,
        y: 0.78,
        size: 0.07,
        color: "#ffffff",
        box: false,
        bold: true,
        auto: true,
        words: words(text, start),
      });
      useEditorStore
        .getState()
        .applyTexts(() => [make("a", "merhaba eee bugün yani", 2), make("b", "bu bu video", 5)]);
    });
    const before = await clips(page).count();
    await page.getByRole("button", { name: "Kısalt", exact: true }).click();
    await expect(page.locator("[data-filler-summary]")).toHaveText(
      "3 dolgu bulundu · 1 tanesi kesilecek",
    );
    // Tekrar ("bu bu") ve söz dolgusu ("yani") seçili gelmez; elle seçilir.
    await expect(page.locator("[data-filler-band]")).toHaveCount(1);
    await page.getByRole("checkbox", { name: /“yani” kelimesini kes/ }).check();
    await page.getByRole("checkbox", { name: /“bu” kelimesini kes/ }).check();
    await expect(page.locator("[data-filler-band]")).toHaveCount(3);
    await page.getByRole("button", { name: /Seçilenleri sil \(3/ }).click();
    await expect(page.locator("[data-filler-summary]")).toHaveText("Dolgu kelimesi bulunamadı.");
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    await expect(page.locator('[data-transcript-line="a"] [data-word-chip]')).toHaveText([
      "merhaba",
      "bugün",
    ]);
    await expect(page.locator('[data-transcript-line="b"] [data-word-chip]')).toHaveText([
      "bu",
      "video",
    ]);
    expect(await clips(page).count()).toBeGreaterThan(before);
    // Geri al: kelimeler geri gelir, transkriptte dolgular işaretli.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator('[data-transcript-line="a"] [data-word-chip]')).toHaveCount(4);
    await expect(page.locator("[data-filler-word]")).toHaveCount(3);
  });

  test("metinden kurgu: sürükleyip seç → kes, Shift+tık → taşı, makasla cümle kes, ara", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=0.5&text=0`);
    await expect(clips(page)).toHaveCount(4);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      const words = (text: string, start: number) =>
        text
          .split(" ")
          .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
      const make = (id: string, text: string, start: number) => ({
        id,
        text,
        start,
        end: start + text.split(" ").length * 0.5,
        x: 0.5,
        y: 0.78,
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
          make("a", "bir iki üç", 2),
          make("b", "dört beş", 5),
          make("c", "altı yedi", 8),
        ]);
    });
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    const chip = (line: string, word: string) =>
      page
        .locator(`[data-transcript-line="${line}"] [data-word-chip]`)
        .filter({ hasText: word })
        .getByRole("button")
        .first();

    // Ara: bulunan kelime işaretlenir.
    await page.getByRole("textbox", { name: "Transkriptte ara" }).fill("DÖRT");
    await expect(page.locator("[data-search-count]")).toHaveText("1 sonuç");
    await expect(page.locator("[data-match]")).toHaveCount(1);
    await page.getByRole("textbox", { name: "Transkriptte ara" }).fill("");

    // Sürükleyerek "iki üç" seç ve videodan kes.
    await chip("a", "iki").hover();
    await page.mouse.down();
    await chip("a", "üç").hover();
    await page.mouse.up();
    await expect(page.locator("[data-transcript-selection]")).toContainText("2 kelime seçili");
    await page.getByRole("button", { name: "Videodan kes", exact: true }).click();
    await expect(page.locator('[data-transcript-line="a"] [data-word-chip]')).toHaveText(["bir"]);
    await expect(page.locator("[data-transcript]").getByRole("status")).toContainText("sn kesildi");

    // Shift+tık ile "dört beş" seç, ilk cümlenin önüne taşı.
    await chip("b", "dört").click();
    await chip("b", "beş").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Taşı", exact: true }).click();
    await page.locator('[data-move-target="a"]').click();
    await expect(page.locator("[data-transcript]").getByRole("status")).toContainText("Taşındı");
    const order = await page
      .locator("[data-transcript-line]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-transcript-line")));
    expect(order).toEqual(["b", "a", "c"]);

    // Makas: son cümleyi kes.
    await page
      .locator('[data-transcript-line="c"]')
      .getByRole("button", { name: "Bu cümleyi videodan kes" })
      .click();
    await expect(page.locator("[data-transcript-line]")).toHaveCount(2);
    // Geri al: cümle geri gelir.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-transcript-line]")).toHaveCount(3);
  });

  test("klip önerileri: işaretli yerler önerilir, biri açılınca yalnız o kalır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=1`);
    await expect(page.locator("[data-marker]")).toHaveCount(4);
    await page.getByRole("button", { name: "Kısalt", exact: true }).click();
    await page.getByRole("button", { name: "Klip öner" }).click();
    const items = page.locator("[data-suggestion]");
    await expect(items).toHaveCount(5);
    await expect(page.locator("[data-suggestion-band]")).toHaveCount(5);
    // İlk öneri bir an işaretini içerir.
    await expect(items.first()).toContainText("işaret");
    await page.getByRole("button", { name: "1. öneriyi aç (geri kalanı kesilir)" }).click();
    await expect(page.locator("[data-shorten-now]")).toHaveText(/^(29|30|31)\.\d sn$/);
    await expect(page.locator("[data-suggestion]")).toHaveCount(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-shorten-now]")).not.toHaveText(/^(29|30|31)\.\d sn$/);
  });

  test("an işaretleri zaman çizelgesinde görünür, tıklayınca oraya gidilir", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none&t=10`);
    await expect(page.locator("[data-marker]")).toHaveCount(4);
    await page.locator('[data-marker="91"]').click();
    await expect(page.getByText("1:31.00", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: /Sonraki an işareti/ }).click();
    await expect(page.getByText("2:20.00", { exact: false }).first()).toBeVisible();
  });

  test("kanal şablonu kaydedilir ve uygulanınca çerçeve geri gelir", async ({ page }) => {
    await page.goto(`${EDITOR}&frame=9:16`);
    await page.getByRole("button", { name: "Hazır ayar", exact: true }).click();
    await expect(page.getByText(/Bu projeden kaydedilecek: çerçeve/)).toBeVisible();
    const name = page.getByPlaceholder("Şablon adı (ör. Kanalım)");
    await name.fill("Kanalım");
    // Şablon adının yanındaki Kaydet (başlıktaki proje Kaydet düğmesi değil).
    await name.locator("xpath=..").getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByRole("button", { name: /Kanalım/ })).toBeVisible();
  });

  test("kamera + oyun düzeni seçilince önizlemede iki kutu ve telefon çıkar", async ({ page }) => {
    await page.goto(`${EDITOR}&frame=9:16`);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("radio", { name: "Kamera üstte" }).click();
    await expect(page.getByText("Kameranın payı")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-split=cam]")).toBeVisible();
    await expect(page.locator("[data-split=game]")).toBeVisible();
    await expect(page.locator("[data-phone-panel] canvas[data-phone-style=stack]")).toBeVisible();
    // Kamera kutusu sürüklenince yeri değişir.
    const cam = page.locator("[data-split=cam]");
    const before = await cam.boundingBox();
    await cam.hover({ position: { x: 20, y: 30 } });
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) - 120, (before?.y ?? 0) + 60, { steps: 5 });
    await page.mouse.up();
    const after = await cam.boundingBox();
    expect(after?.x).toBeLessThan((before?.x ?? 0) - 50);
  });

  test("düzen galerisi: daire kamera, iki kamera, renkli arka plan seçilir ve ayarlanır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&frame=9:16`);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    const gallery = page.getByRole("radiogroup", { name: "Düzen" });
    await expect(gallery.getByRole("radio")).toHaveCount(10);
    // Daire kamera: yer ve çerçeve ayarları çıkar; önizlemede kamera kutusu yuvarlak.
    await gallery.getByRole("radio", { name: "Daire kamera" }).click();
    await expect(gallery.getByRole("radio", { name: "Daire kamera" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page
      .getByRole("group", { name: "Kameranın yeri" })
      .getByRole("button", { name: "Sağ üst" })
      .click();
    await page
      .getByRole("group", { name: "Çerçeve" })
      .getByRole("button", { name: "#ffd43b" })
      .click();
    const split = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      return useEditorStore.getState().exportOptions.split;
    });
    expect(split).toMatchObject({ style: "circle", ring: "#ffd43b", spot: { x: 0.76, y: 0.14 } });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-split=cam]")).toHaveCSS("border-radius", "50%");
    await expect(page.locator("[data-phone-panel] canvas[data-phone-style=circle]")).toBeVisible();
    // İki kamera: ikinci kamera kutusu da çıkar.
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await gallery.getByRole("radio", { name: "İki kamera" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-split=cam2]")).toBeVisible();
    // Renkli arka plan: kamera kutuları kalkar, renk seçilir.
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await gallery.getByRole("radio", { name: "Renkli arka plan" }).click();
    await page
      .getByRole("group", { name: "Arka plan renkleri" })
      .getByRole("button", { name: "#f97316 → #db2777" })
      .click();
    await expect(
      page
        .getByRole("group", { name: "Arka plan renkleri" })
        .getByRole("button", { name: "#f97316 → #db2777" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-split]")).toHaveCount(0);
  });

  test("gizlenecek alan eklenir, tutamaçlardan boyutlanır, hareketli olur ve silinir", async ({
    page,
  }) => {
    await page.goto(EDITOR);
    await page.getByRole("button", { name: "Gizle", exact: true }).click();
    await page.getByRole("button", { name: "Gizlenecek alan ekle" }).click();
    await expect(page.locator("[data-blur]")).toHaveCount(1);
    // Seçili kutunun 8 tutamacı var; sol kenar tutamacı genişletir, sağ kenar yerinde kalır.
    await expect(page.locator("[data-blur-handle]")).toHaveCount(8);
    const before = (await page.locator("[data-blur]").boundingBox())!;
    const west = (await page.locator("[data-blur-handle=w]").boundingBox())!;
    await page.mouse.move(west.x + west.width / 2, west.y + west.height / 2);
    await page.mouse.down();
    await page.mouse.move(west.x - 40, west.y + west.height / 2, { steps: 4 });
    await page.mouse.up();
    const after = (await page.locator("[data-blur]").boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 30);
    expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
    // Başlangıç düğmesi oynatma çizgisinin anını gösterir.
    await expect(page.getByRole("button", { name: /^Başlangıç: / })).toBeVisible();
    await page.getByRole("button", { name: "Hareketli yap" }).click();
    await expect(page.getByRole("button", { name: "Hareketli (1 konum)" })).toBeVisible();
    await page.getByRole("button", { name: "Pikselli" }).click();
    await expect(page.locator("[data-blur][data-blur-mode=pixel]")).toHaveCount(1);
    await page.getByRole("button", { name: "Alanı sil" }).click();
    await expect(page.locator("[data-blur]")).toHaveCount(0);
  });

  test("dönüşüm kutusu: gövde taşır, köşe büyütür, üst tutamaç döndürür", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    const store = (expr: string) =>
      page.evaluate(async (code) => {
        const find = (p: string) =>
          performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((n) => n.includes(p)) as string;
        const { useEditorStore } = await import(
          /* @vite-ignore */ find("/src/store/editorStore.ts")
        );
        const { seekTimeline } = await import(
          /* @vite-ignore */ find("/src/lib/sequencePlayer.ts")
        );
        return new Function("s", "seek", code)(useEditorStore.getState(), seekTimeline);
      }, expr);
    // Üst izdeki klip (1:00–1:12) seçilir, imleç üstüne gelir.
    await store("s.select(['c4']); seek(65);");
    await page
      .locator('[data-panel-section="transform"]')
      .getByRole("button", { name: /Dönüşüm/ })
      .click();
    const move = page.locator("[data-transform-move]");
    await expect(move).toBeVisible();
    const tr = () => store("return s.clips.find((c) => c.id === 'c4').transform ?? null;");
    // Önce panelden %60 boyut (bindirme olur, köşeler kutunun içinde kalır).
    await page
      .locator("[data-transform]")
      .getByRole("spinbutton", { name: "Boyut değeri" })
      .fill("60");
    await expect(page.locator('[data-overlay-clip="c4"]')).toHaveCount(1);
    const box = (await page.locator("[data-transform-box]").boundingBox())!;
    // Gövdeyi sağa sürükle: kutunun genişliğinin %10'u kadar.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.05, cy, { steps: 3 });
    await page.mouse.move(cx + box.width * 0.1, cy, { steps: 3 });
    await page.mouse.up();
    expect((await tr()).x).toBeCloseTo(0.1, 1);
    // Köşeyi merkeze doğru yarı yola: boyut yarıya iner.
    const corner = (await page.locator('[data-transform-scale="2"]').boundingBox())!;
    const kx = corner.x + corner.width / 2;
    const ky = corner.y + corner.height / 2;
    const centerX = cx + box.width * 0.1;
    await page.mouse.move(kx, ky);
    await page.mouse.down();
    await page.mouse.move((kx + centerX) / 2, (ky + cy) / 2, { steps: 4 });
    await page.mouse.up();
    expect((await tr()).scale).toBeCloseTo(0.3, 1);
    // Döndür: tutamacı merkezin sağına taşı (≈90°).
    const handle = (await page.locator("[data-transform-rotate]").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(centerX + box.height * 0.3, cy, { steps: 6 });
    await page.mouse.up();
    expect(Math.abs((await tr()).rotation - 90)).toBeLessThan(8);
    // Geri alma her sürüklemeyi tek adımda geri alır; seçim korunur.
    await page.keyboard.press("Control+z");
    expect((await tr()).rotation).toBe(0);
    await page.keyboard.press("Control+z");
    expect((await tr()).scale).toBeCloseTo(0.6, 2);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    expect(await tr()).toBeNull();
    await expect(page.locator("[data-transform]")).toBeVisible();
  });

  test("yakınlaştırma bölgesi videoda sürüklenir ve köşesinden büyütülür", async ({ page }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    const run = (code: string) =>
      page.evaluate(async (src) => {
        const find = (p: string) =>
          performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((n) => n.includes(p)) as string;
        const { useEditorStore } = await import(
          /* @vite-ignore */ find("/src/store/editorStore.ts")
        );
        const { seekTimeline } = await import(
          /* @vite-ignore */ find("/src/lib/sequencePlayer.ts")
        );
        const zoom = await import(/* @vite-ignore */ find("/src/lib/zoomActions.ts"));
        return new Function("s", "seek", "zoom", src)(
          useEditorStore.getState(),
          seekTimeline,
          zoom,
        );
      }, code);
    await run("seek(20); zoom.addZoomAtPlayhead();");
    const box = page.locator("[data-zoom-box]");
    await expect(box).toBeVisible();
    const span = () => run("return s.clips.find((c) => c.zooms)?.zooms[0];");
    const b = (await box.boundingBox())!;
    const host = (await page.locator("[data-zoom-box]").evaluate((el) => {
      const r = el.parentElement!.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }))!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - host.w * 0.1, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    expect((await span()).x).toBeCloseTo(0.4, 1);
    // Köşeden içeri: bölge küçülür (yakınlık artar), en çok 3×.
    const handle = (await page.locator("[data-zoom-size]").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - host.w * 0.1 + 5, b.y + b.height / 2 + 5, {
      steps: 4,
    });
    await page.mouse.up();
    expect((await span()).size).toBeCloseTo(1 / 3, 2);
    // Oynatırken kutu kalkar.
    await page.keyboard.press("Space");
    await expect(box).toHaveCount(0);
  });

  test("telefonda düzen: kamera üstte + şerit, çizgi sürüklenir, yer değişir, daire kamera ve yazı taşınır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=20`);
    await expect(clips(page)).toHaveCount(4);
    const phone = page.locator("[data-phone-panel]");
    await phone.getByRole("button", { name: "Dikey (9:16) yap" }).click();
    await phone.getByRole("combobox", { name: "Düzen" }).selectOption("stackTop");
    await phone.getByRole("button", { name: "Orta şerit (logo, başlık)" }).click();
    const split = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        const o = useEditorStore.getState().exportOptions;
        return { split: o.split, frameSplit: o.frameSplit };
      });
    expect((await split()).split).toMatchObject({ camTop: true, band: { share: 0.1 } });
    const editor = phone.locator("[data-phone-editor]");
    const box = (await editor.boundingBox())!;
    // Kamera çizgisini aşağı sürükle: pay %45.
    const cam = (await phone.locator('[data-phone-divider="cam"]').boundingBox())!;
    await page.mouse.move(cam.x + cam.width / 3, cam.y + cam.height / 2);
    await page.mouse.down();
    await page.mouse.move(cam.x + cam.width / 3, box.y + box.height * 0.45, { steps: 4 });
    await page.mouse.up();
    expect((await split()).split.camShare).toBeCloseTo(0.45, 1);
    // Şerit çizgisi: kalınlık %15.
    const band = (await phone.locator('[data-phone-divider="band"]').boundingBox())!;
    await page.mouse.move(band.x + band.width / 3, band.y + band.height / 2);
    await page.mouse.down();
    await page.mouse.move(band.x + band.width / 3, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    expect((await split()).split.band.share).toBeCloseTo(0.15, 1);
    // Yer değiştir: kamera alta.
    await phone.getByRole("button", { name: "Kamerayı üste / alta al" }).click();
    expect((await split()).split.camTop).toBe(false);

    // Daire kamera: sürükleyip taşı.
    await phone.getByRole("combobox", { name: "Düzen" }).selectOption("circle");
    const spot = (await phone.locator("[data-phone-spot]").boundingBox())!;
    const before = (await split()).split.spot;
    await page.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await page.mouse.down();
    await page.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2 - box.height * 0.3, {
      steps: 4,
    });
    await page.mouse.up();
    expect((await split()).split.spot.y).toBeCloseTo(before.y - 0.3, 1);

    // Yazı ekle ve telefonda taşı.
    await page.getByRole("button", { name: "Yazı ekle" }).click();
    const text = phone.locator("[data-phone-text]").first();
    await expect(text).toBeVisible();
    const tb = (await text.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 - box.height * 0.5, {
      steps: 4,
    });
    await page.mouse.up();
    const y = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      const s = useEditorStore.getState();
      return s.texts.find((t: { id: string }) => t.id === s.selectedTextId)?.y;
    });
    expect(y).toBeCloseTo(0.82 - 0.5, 1);
  });

  test("efekt şeridi: karta tıklayınca imleçte bloğa düşer, seçiliyken değişir, taşınır, silinir, boş yere bırakılır", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&t=20`);
    await expect(clips(page)).toHaveCount(4);
    const state = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        const s = useEditorStore.getState();
        return {
          effects: s.effects as { start: number; end: number; look?: { filter?: string } }[],
          looks: s.clips.map((c: { look?: { filter?: string } }) => c.look?.filter ?? null),
          clips: s.clips.length as number,
        };
      });
    await page.getByRole("button", { name: "Filtreler", exact: true }).click();
    await page.locator('[data-filter-card="bw"]').click();
    let s = await state();
    expect(s.effects).toMatchObject([{ start: 20, end: 23, look: { filter: "bw" } }]);
    expect(s.looks).toEqual([null, null, null, null]);
    const block = page.locator('[data-lane="effect"]');
    await expect(block).toHaveCount(1);
    // Blok seçiliyken başka karta tıklamak aynı bloğu değiştirir.
    await page.locator('[data-filter-card="sepia"]').click();
    s = await state();
    expect(s.effects).toHaveLength(1);
    expect(s.effects[0].look?.filter).toBe("sepia");
    // Şeritte sağa taşı.
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    s = await state();
    expect(s.effects[0].start).toBeGreaterThan(20);
    expect(s.effects[0].end - s.effects[0].start).toBeCloseTo(3, 5);
    // Delete: seçili blok silinir, imleçteki klip silinmez.
    await block.click();
    await page.keyboard.press("Delete");
    s = await state();
    expect(s.effects).toHaveLength(0);
    expect(s.clips).toBe(4);
    // Kartı zaman çizelgesinin boş yerine (cetvele) sürükle: o anda blok.
    const card = (await page.locator('[data-filter-card="vivid"]').boundingBox())!;
    const ruler = (await page.locator('[data-tour="editor-timeline"] [data-ruler]').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(ruler.x + ruler.width * 0.3, ruler.y + ruler.height / 2, { steps: 6 });
    await page.mouse.up();
    s = await state();
    expect(s.effects).toHaveLength(1);
    expect(s.effects[0].look?.filter).toBe("vivid");
  });

  test("geçişler: tıklayınca imlece en yakın kesime / klip ucuna konur, işaret başka kesime taşınır, piksel gerçekten pikselleşir", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none`);
    await expect(clips(page)).toHaveCount(4);
    const run = (code: string) =>
      page.evaluate(async (src) => {
        const find = (p: string) =>
          performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((n) => n.includes(p)) as string;
        const { useEditorStore } = await import(
          /* @vite-ignore */ find("/src/store/editorStore.ts")
        );
        const { seekTimeline } = await import(
          /* @vite-ignore */ find("/src/lib/sequencePlayer.ts")
        );
        return new Function("s", "seek", src)(useEditorStore.getState(), seekTimeline);
      }, code);
    // Uç uca üç klip; üçüncü seçili, imleç ilk kesimin yanında.
    await run(`
      s.apply(() => [
        { id: "a", track: 0, start: 0, srcStart: 0, srcEnd: 10, speed: 1, name: "" },
        { id: "b", track: 0, start: 10, srcStart: 20, srcEnd: 30, speed: 1, name: "" },
        { id: "c", track: 0, start: 20, srcStart: 40, srcEnd: 50, speed: 1, name: "" },
      ]);
      s.select(["c"]);
      seek(9);
    `);
    await page.getByRole("button", { name: "Geçişler", exact: true }).click();
    await page.locator('[data-xfade-tile="fade"]').click();
    const xf = () => run("return s.clips.map((c) => [c.id, c.xfade?.kind ?? null]);");
    expect(await xf()).toEqual([
      ["a", "fade"],
      ["b", null],
      ["c", null],
    ]);
    // İşareti ikinci kesime (20. sn) sürükle.
    const marker = (await page.locator('[data-xfade="a"]').boundingBox())!;
    const clipC = (await page.locator('[data-clip="c"]').boundingBox())!;
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    await page.mouse.move(clipC.x + 2, marker.y + marker.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(await xf()).toEqual([
      ["a", null],
      ["b", "fade"],
      ["c", null],
    ]);
    // Açılma kartı: imlece en yakın klip başına (c, 20. sn).
    await run("seek(21);");
    await page.locator('[data-edge-tile="fadeIn"]').click();
    expect(await run("return s.clips.map((c) => c.fadeIn ?? 0);")).toEqual([0, 0, 0.8]);
    // Stil kartı (yakınlaşarak) en yakın uca (c'nin sonu) süre ve stil verir.
    await run("seek(29.5);");
    await page.locator('[data-edge-tile="zoom"]').click();
    expect(await run("return [s.clips[2].transition, s.clips[2].fadeOut];")).toEqual(["zoom", 0.8]);
    // Dönme yönü iki ayrı kartta, adları açık.
    await expect(page.locator('[data-edge-tile="spin"]')).toContainText("saat yönünde");
    await expect(page.locator('[data-edge-tile="spinCcw"]')).toContainText("saat yönünün tersine");
    await expect(page.locator('[data-xfade-tile="radialccw"]')).toContainText(
      "Saat yönünün tersine",
    );
    // Piksel kartı üstüne gelince SVG süzgeciyle pikselleşir (bulanık değil).
    await page.locator('[data-xfade-tile="pixelize"]').hover();
    await expect
      .poll(() =>
        page
          .locator('[data-xfade-tile="pixelize"] div div')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.filter).join(" ")),
      )
      .toContain('url("#dk-px-');
    await expect(page.locator("filter#dk-px-8")).toHaveCount(1);
  });

  test("yardım baloncuğu sağ kenarda da geniş ve ekranın içinde; altyazı paneli boşken sade", async ({
    page,
  }) => {
    await page.goto(`${EDITOR}&select=none&text=0`);
    await expect(clips(page)).toHaveCount(4);
    // Özellikler (sağ sütun) başlığındaki "?".
    await page.getByRole("button", { name: "Nasıl kullanılır: yardım" }).hover();
    const tip = page.locator('[role="tooltip"]');
    await expect(tip.locator("[data-tip-detail]")).toBeVisible();
    const box = (await tip.boundingBox())!;
    const view = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(270);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    // Kare'ye yakın: yüksekliği genişliğinin katlarca üstünde değil.
    expect(box.height).toBeLessThan(box.width * 2);
    await page.mouse.move(5, 5);

    // Altyazı paneli: altyazı yokken animasyon ve tek düğme; ayarlar ve dosyadan ekleme katlı.
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    const auto = page.locator("[data-auto-captions]");
    await expect(auto.locator("[data-captions-demo]")).toBeVisible();
    await expect(auto.getByRole("button", { name: "Altyazı oluştur" })).toBeVisible();
    await expect(auto.getByRole("button", { name: "Konuşma dili" })).toBeHidden();
    await expect(page.locator("[data-caption-studio]")).toHaveCount(0);
    await auto.locator("[data-captions-settings] summary").click();
    await expect(auto.getByRole("button", { name: "Konuşma dili" })).toBeVisible();
  });

  test("imleçte yavaş çekim klibi üçe böler ve geri alınır", async ({ page }) => {
    await page.goto(EDITOR);
    await expect(clips(page)).toHaveCount(4);
    await page.getByRole("button", { name: "İmleçte yavaş çekim" }).click();
    await expect(clips(page)).toHaveCount(6);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(clips(page)).toHaveCount(4);
  });
});
