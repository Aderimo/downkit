import { expect, test, type Page } from "@playwright/test";

// Proje dosyası akışı: Tauri komutları tarayıcıda taklit edilir (dosya sistemi bellekte).
// Aç → eksik dosya penceresi → atla → düzenleyici; Ctrl+S kaydeder; değişiklik
// "kaydedilmedi" işaretini ve otomatik kaydı tetikler.

const PROJECT = {
  schemaVersion: 1,
  app: "DownKit",
  savedAt: "2026-10-09T10:00:00.000Z",
  name: "Turnuva",
  sources: [
    { id: "s1", path: "C:\\Klipler\\oyun.mp4", title: "oyun.mp4" },
    { id: "s2", path: "C:\\Eski\\kamera.mp4", title: "kamera.mp4" },
  ],
  clips: [
    { id: "a", sourceId: "s1", track: 0, start: 0, srcStart: 0, srcEnd: 20, speed: 1, name: "" },
    { id: "b", sourceId: "s1", track: 0, start: 20, srcStart: 30, srcEnd: 50, speed: 1, name: "" },
    { id: "c", sourceId: "s2", track: 1, start: 5, srcStart: 0, srcEnd: 10, speed: 1, name: "" },
  ],
  texts: [],
  images: [],
  music: [],
  blurs: [],
  tracks: {},
  exportOptions: { frame: "9:16" },
};

async function mockTauri(page: Page) {
  await page.addInitScript((project) => {
    localStorage.setItem(
      "downkit.settings",
      JSON.stringify({ setupDone: true, showTutorial: false, pageTours: false }),
    );
    const files: Record<string, string> = {
      "C:\\Projeler\\Turnuva.downkit": JSON.stringify(project),
    };
    const existing = new Set(["C:\\Klipler\\oyun.mp4", "C:\\Projeler\\Turnuva.downkit"]);
    const calls: { cmd: string; args: unknown }[] = [];
    let autosave: string | null = null;
    let callbackId = 0;
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    w.__files = files;
    w.__autosave = () => autosave;
    // Olay dinleyicisi kapatılırken çağrılır (gerçek eklentide var).
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback: (cb: unknown) => {
        callbackId += 1;
        w[`_${callbackId}`] = cb;
        return callbackId;
      },
      convertFileSrc: (p: string) => p,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case "plugin:dialog|open":
            // Klasör seçimi (taslaklar) ya da proje dosyası; test başka dosya da seçtirebilir.
            if (typeof w.__dialogPick === "string") return w.__dialogPick;
            return (args.options as { directory?: boolean } | undefined)?.directory
              ? "C:\\Taslaklar"
              : "C:\\Projeler\\Turnuva.downkit";
          case "plugin:dialog|save": {
            // Kaydetme penceresi önerilen adı Belgeler'e kaydediyormuş gibi.
            const name = (args.options as { defaultPath?: string } | undefined)?.defaultPath ?? "";
            return name.endsWith(".downkit") || !name
              ? "C:\\Projeler\\Turnuva.downkit"
              : `C:\\Belgeler\\${name}`;
          }
          case "editor_face_track": {
            // Kaynak saniyesi: 10. saniyeye kadar yüz solda, sonra sağda (2 kare/sn).
            const out: { t: number; faces: number[][] }[] = [];
            for (const [a, b] of args.ranges as [number, number][]) {
              for (let t = a; t < b; t += 0.5) {
                const cx = t < 10 ? 0.3 : 0.7;
                out.push({ t, faces: [[cx - 0.05, 0.3, 0.1, 0.18]] });
              }
            }
            return out;
          }
          case "editor_cover":
            return (
              "C:" + String.fromCharCode(92) + "Resimler" + String.fromCharCode(92) + "kapak.jpg"
            );
          case "editor_silences":
            // Kaynak saniyesi: oyun.mp4 içinde iki sessiz yer.
            return {
              silences: [
                [5, 8],
                [30, 31.5],
              ],
              voiceTrack: true,
            };
          case "text_file_write":
            files[args.path as string] = args.contents as string;
            return null;
          case "project_read":
            return files[args.path as string];
          case "project_save":
            files[args.path as string] = args.contents as string;
            existing.add(args.path as string);
            return null;
          case "paths_exist":
            return (args.paths as string[]).map((p) => existing.has(p));
          case "autosave_write":
            autosave = args.contents as string;
            return null;
          case "autosave_read":
            return autosave;
          case "autosave_clear":
            autosave = null;
            return null;
          case "open_local_preview": {
            const path = args.path as string;
            return {
              url: "about:blank",
              token: `t-${path}`,
              info: {
                fileName: path.split("\\").pop(),
                filePath: path,
                fileSizeBytes: 1000,
                durationSeconds: 120,
                width: 1920,
                height: 1080,
                fps: 30,
                videoCodec: "h264",
                audioCodec: "aac",
                container: "mp4",
                chapters: [],
              },
            };
          }
          case "motion_templates":
            return [
              {
                id: "lower-third",
                width: 1920,
                height: 1080,
                duration: 6,
                controls: [
                  { name: "Name", kind: "text", value: "Alex Rivera" },
                  { name: "Title", kind: "text", value: "Motion Designer" },
                  { name: "Bar Color", kind: "color", value: "#3d8bff" },
                ],
              },
              {
                id: "vertical-story",
                width: 1080,
                height: 1920,
                duration: 8,
                controls: [{ name: "Headline", kind: "text", value: "NEW" }],
              },
            ];
          case "motion_preview":
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
          case "motion_render": {
            const spec = args.spec as { template: string; values: string[] };
            const vertical = spec.template === "vertical-story";
            return {
              path: `C:\\motion\\${spec.template}-${spec.values.join("_")}.webm`,
              width: vertical ? 1080 : 1920,
              height: vertical ? 1920 : 1080,
              duration: vertical ? 8 : 6,
            };
          }
          case "emoji_image_write":
            calls.push({ cmd, args });
            return `C:\\cache\\${args.name as string}.png`;
          case "plugin:event|listen":
            return 1;
          case "plugin:event|unlisten":
            return null;
          default:
            // Tauri yokmuş gibi: diğer komutlar hata verir (uygulama bunu tarayıcıda da yaşar).
            throw new Error(`taklit edilmeyen komut: ${cmd}`);
        }
      },
    };
  }, PROJECT);
}

test.describe("Proje dosyası", () => {
  test("eksik dosyalı proje açılır, kaydedilir, değişiklik otomatik kaydedilir", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await expect(page.getByText("Son projeler")).toBeVisible();

    await page.getByRole("button", { name: "Proje aç…" }).click();
    const dialog = page.getByRole("dialog", { name: "Bazı dosyalar bulunamadı" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("kamera.mp4").first()).toBeVisible();
    const open = dialog.getByRole("button", { name: "Projeyi aç" });
    await expect(open).toBeDisabled();
    await dialog.getByRole("button", { name: "Atla" }).click();
    await open.click();

    // Atlanan kaynağın klibi düşer; diğer iki klip ve dikey çerçeve geri gelir.
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await expect(page.getByText("Turnuva").first()).toBeVisible();

    // Kaynak atlandığı için proje değişti sayılır: Ctrl+S ile kaydedilir.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("button", { name: "Kaydedildi" })).toBeVisible();
    const saved = await page.evaluate(
      () =>
        (window as unknown as { __files: Record<string, string> }).__files[
          "C:\\Projeler\\Turnuva.downkit"
        ],
    );
    const parsed = JSON.parse(saved) as {
      sources: unknown[];
      clips: unknown[];
      exportOptions: { frame: string };
    };
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.clips).toHaveLength(2);
    expect(parsed.exportOptions.frame).toBe("9:16");

    // Değişiklik: "Kaydet" geri gelir, kaydedilmemiş işareti çıkar, kurtarma dosyası yazılır.
    await page.locator("[data-clip]").first().click();
    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: "Kaydet", exact: true })).toBeVisible();
    await expect(page.getByLabel("Kaydedilmemiş değişiklik var")).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const text = (window as unknown as { __autosave: () => string | null }).__autosave();
          return text ? (JSON.parse(text) as { clips: unknown[]; dirty: boolean }) : null;
        }),
      )
      .toMatchObject({ dirty: true, clips: expect.any(Array) });
  });

  test("Proje aç penceresinden seçilen video düzenleyicide açılır", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript(() => {
      (window as unknown as { __dialogPick: string }).__dialogPick = "C:\\Klipler\\oyun.mp4";
    });
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    const filters = await page.evaluate(() => {
      const calls = (window as unknown as { __calls: { cmd: string; args: unknown }[] }).__calls;
      const open = calls.find((c) => c.cmd === "plugin:dialog|open");
      return (open?.args as { options: { filters: { extensions: string[] }[] } }).options.filters;
    });
    expect(filters[0].extensions).toEqual(expect.arrayContaining(["downkit", "mp4", "mkv"]));
  });

  test("bozuk proje dosyası anlaşılır hata verir", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript(() => {
      (window as unknown as { __files: Record<string, string> }).__files[
        "C:\\Projeler\\Turnuva.downkit"
      ] = "{bozuk";
    });
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.getByText("Bu dosya bozuk ya da bir DownKit projesi değil.")).toBeVisible();
  });

  test("kurtarma kaydı açılışta sunulur ve açılır", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as Record<string, unknown>;
      const recovery = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: project.clips.slice(0, 2),
        dirty: true,
        projectPath: "C:\\Projeler\\Turnuva.downkit",
      });
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = async (cmd, args) =>
        cmd === "autosave_read" ? recovery : original(cmd, args);
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await expect(page.getByText("Kaydedilmemiş değişiklikler kurtarıldı")).toBeVisible();
    await page.getByRole("button", { name: "Devam et" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await expect(page.getByLabel("Kaydedilmemiş değişiklik var")).toBeVisible();
  });

  test("altyazılar SRT olarak kaydedilir; büyük harf stili dosyaya da geçer", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      const withCaptions = {
        ...project,
        sources: [project.sources[0]],
        clips: project.clips.slice(0, 2),
        texts: [
          {
            id: "c1",
            text: "merhaba dünya",
            start: 1,
            end: 2.5,
            x: 0.5,
            y: 0.8,
            size: 0.07,
            color: "#ffffff",
            box: false,
            bold: true,
            auto: true,
            font: "impact",
            upper: true,
          },
          {
            id: "c2",
            text: "ikinci satır",
            start: 3,
            end: 4,
            x: 0.5,
            y: 0.8,
            size: 0.07,
            color: "#ffffff",
            box: false,
            bold: true,
            auto: true,
            font: "impact",
            upper: true,
          },
        ],
      };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify(withCaptions);
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Altyazı", exact: true }).click();
    await page.getByRole("button", { name: "SRT kaydet" }).click();
    await expect(page.getByText(/kaydedildi\./)).toBeVisible();
    const srt = await page.evaluate(() => {
      const files = (window as unknown as { __files: Record<string, string> }).__files;
      const key = Object.keys(files).find((k) => k.endsWith(".srt")) ?? "";
      return files[key];
    });
    expect(srt).toBe(
      "1\n00:00:01,000 --> 00:00:02,500\nMERHABA DÜNYA\n\n2\n00:00:03,000 --> 00:00:04,000\nİKİNCİ SATIR\n",
    );
  });

  test("sessizlikler bulunur, gözden geçirilir ve tek tıkla silinir", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Atla" }).click();
    await page.getByRole("button", { name: "Projeyi aç" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);

    await page.getByRole("button", { name: "Kısalt", exact: true }).click();
    await page.getByRole("button", { name: "Sessizlikleri bul" }).click();
    // 5–8 sn (a klibi) ve 30–31.5 sn (b klibi, zaman çizelgesinde 20–21.5); kenarlarda 0.12 sn pay.
    await expect(page.locator("[data-silence-summary]")).toHaveText(
      "2 sessizlik · video 4.0 sn kısalır",
    );
    await expect(page.getByText(/Ayrı mikrofon izine bakıldı/)).toBeVisible();
    await expect(page.locator("[data-silence-band]")).toHaveCount(2);

    // Birini "kalsın" yap: özet ve bant güncellenir; sonra geri al.
    await page.getByRole("checkbox", { name: /0:20\.1 sessizliğini kes/ }).uncheck();
    await expect(page.locator("[data-silence-summary]")).toHaveText(
      "1 sessizlik · video 2.8 sn kısalır",
    );
    await page.getByRole("checkbox", { name: /0:20\.1 sessizliğini kes/ }).check();

    await page.getByRole("button", { name: /^Sessizlikleri sil \(/ }).click();
    await expect(page.locator("[data-autocut]").getByRole("status")).toHaveText(
      "4.0 sn kısaldı. Geri almak için Ctrl+Z.",
    );
    await expect(page.locator("[data-clip]")).toHaveCount(4);
    await expect(page.locator("[data-silence-summary]")).toHaveText("Kesilecek sessizlik yok.");

    // Geri al: iki klip ve iki sessizlik geri gelir.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await expect(page.locator("[data-silence-band]")).toHaveCount(2);
    const calls = await page.evaluate(() =>
      (
        window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }
      ).__calls.filter((c) => c.cmd === "editor_silences"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      path: "C:\\Klipler\\oyun.mp4",
      noiseDb: -38,
      minSeconds: 0.6,
      voice: true,
    });
  });

  test("hedef süreye indir: sessizlik + en az önemli cümleler planlanır ve uygulanır", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      const line = (id: string, text: string, start: number) => ({
        id,
        text,
        start,
        end: start + 2,
        x: 0.5,
        y: 0.8,
        size: 0.07,
        color: "#ffffff",
        box: false,
        bold: true,
        auto: true,
        words: text
          .split(" ")
          .map((t, i) => ({ text: t, start: start + i * 0.5, end: start + i * 0.5 + 0.45 })),
      });
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: project.clips.slice(0, 2),
        texts: [
          line("hook", "bunu kimse bilmiyor ama", 1),
          line("l1", "şimdi şöyle devam edelim", 9),
          line("l2", "neyse konuya dönelim artık", 15),
          line("l3", "biraz daha anlatayım size", 25),
          line("end", "abone olmayı unutma", 33),
        ],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Kısalt", exact: true }).click();
    await expect(page.locator("[data-shorten-now]")).toHaveText("40.0 sn");
    await page
      .getByRole("group", { name: "Hedef süre" })
      .getByRole("button", { name: "30 sn" })
      .click();
    await page.getByRole("button", { name: "30 sn altına indir" }).click();
    const plan = page.locator("[data-shorten-plan]");
    await expect(plan).toContainText("Sessizlikler (2)");
    // Kanca (ilk) ve kapanış (son) cümlesi korunur; ortadaki üç cümle önerilir.
    await expect(page.locator("[data-shorten-sentence]")).toHaveCount(3);
    await expect(page.locator("[data-sentence-band]")).toHaveCount(3);
    await expect(page.locator("[data-shorten-result]")).toHaveText("40.0 sn → 29.8 sn");
    // Bir cümleyi bırakınca hedefe inilmez, uyarı çıkar.
    await page.getByRole("checkbox", { name: /Bu cümleyi kes: neyse/ }).uncheck();
    await expect(page.locator("[data-shorten-result]")).toContainText("daha çok cümle seç");
    await page.getByRole("checkbox", { name: /Bu cümleyi kes: neyse/ }).check();
    await page.getByRole("button", { name: "Uygula (29.8 sn)" }).click();
    await expect(page.locator("[data-shorten-now]")).toHaveText("29.8 sn");
    await expect(page.locator("[data-shorten]").getByRole("status")).toContainText("sn kısaldı");
    await expect(page.getByText("Video zaten 30 saniyenin altında.")).toBeVisible();
  });

  test("klip önerileri ayrı dikey taslak projeler olarak kaydedilir", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Atla" }).click();
    await page.getByRole("button", { name: "Projeyi aç" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Kısalt", exact: true }).click();
    await page.getByRole("group", { name: "Klip" }).getByRole("button", { name: "15 sn" }).click();
    await page.getByRole("button", { name: "Klip öner" }).click();
    const count = await page.locator("[data-suggestion]").count();
    expect(count).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Hepsini dikey taslak olarak kaydet" }).click();
    await expect(page.locator("[data-suggest]").getByRole("status")).toContainText(
      `${count} taslak proje kaydedildi`,
    );
    const drafts = await page.evaluate(() => {
      const files = (window as unknown as { __files: Record<string, string> }).__files;
      return Object.entries(files)
        .filter(([k]) => k.startsWith("C:" + String.fromCharCode(92) + "Taslaklar"))
        .map(([k, v]) => ({ path: k, data: JSON.parse(v) }));
    });
    expect(drafts).toHaveLength(count);
    expect(drafts[0].path).toBe(
      "C:" +
        String.fromCharCode(92) +
        "Taslaklar" +
        String.fromCharCode(92) +
        "Turnuva - 1.downkit",
    );
    for (const d of drafts) {
      expect(d.data.exportOptions.frame).toBe("9:16");
      const end = Math.max(
        ...d.data.clips.map(
          (c: { start: number; srcStart: number; srcEnd: number; speed: number }) =>
            c.start + (c.srcEnd - c.srcStart) / c.speed,
        ),
      );
      expect(end).toBeLessThanOrEqual(17);
      expect(end).toBeGreaterThan(7);
    }
  });

  test("yüzü takip et: kırpma kadrajı yüzü izler, kapatınca elle konuma döner", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Atla" }).click();
    await page.getByRole("button", { name: "Projeyi aç" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    const follow = page.locator("[data-face-follow]");
    await follow.getByRole("button", { name: "Başlat" }).click();
    await expect(page.locator("[data-face-status]")).toHaveText(
      "Yüz takibi açık · yüz bulunan kareler: %100.",
    );
    await page.keyboard.press("Escape");
    // Önizleme videosu bu ortamda açılmaz: konum düzenleyicinin kendi hesabından okunur.
    const at = (t: number) =>
      page.evaluate(async (time) => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/lib/faceActions.ts")) as string;
        const { currentCropPosition } = await import(/* @vite-ignore */ url);
        return Math.round(currentCropPosition(time) * 100);
      }, t);
    // Yüz solda (0.3) → konum ≈ %21; 15. saniyede sağda (0.7) → ≈ %79.
    expect(await at(5)).toBe(21);
    expect(await at(15)).toBe(79);
    // İkinci klip (kaynak 30–50) de sağdaki yüzü izler.
    expect(await at(25)).toBe(79);
    const calls = await page.evaluate(() =>
      (
        window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }
      ).__calls.filter((c) => c.cmd === "editor_face_track"),
    );
    expect(calls[0].args).toMatchObject({
      ranges: [
        [0, 20],
        [30, 50],
      ],
      width: 1920,
      height: 1080,
    });
    // Kapat: elle konum (%50) geri gelir.
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await follow.getByRole("button", { name: "Kapat" }).click();
    await page.keyboard.press("Escape");
    expect(await at(15)).toBe(50);
  });

  test("podcast düzeni: iki kişi yüzlerine göre yerleşir", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Atla" }).click();
    await page.getByRole("button", { name: "Projeyi aç" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("radio", { name: "Podcast (2 kişi)" }).click();
    await page.getByRole("button", { name: "Yüzlere göre yerleştir" }).click();
    await expect(page.locator("[data-podcast-controls]").getByRole("status")).toHaveText(
      "İki kişi yüzlerine göre yerleştirildi.",
    );
    const split = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      return useEditorStore.getState().exportOptions.split;
    });
    // Sahte algılayıcıda yüzler x = 0.3 ve 0.7.
    expect(split.style).toBe("podcast");
    expect(split.cam.x + split.cam.w / 2).toBeCloseTo(0.3, 1);
    expect(split.game.x + split.game.w / 2).toBeCloseTo(0.7, 1);
  });

  test("kapak görseli imleçteki kareden, videonun düzeni ve başlıkla kaydedilir", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Atla" }).click();
    await page.getByRole("button", { name: "Projeyi aç" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    // İmleç ikinci klipte (zaman çizelgesi 25 sn = kaynak 35 sn).
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/playerStore.ts")) as string;
      const { usePlayerStore } = await import(/* @vite-ignore */ url);
      usePlayerStore.setState({ currentTime: 25 });
    });
    await page.getByRole("button", { name: "Şablonlar", exact: true }).click();
    const cover = page.locator("[data-cover]");
    await cover.getByRole("textbox", { name: "Kapak başlığı" }).fill("Final maçı");
    await cover.getByRole("button", { name: "Bant" }).click();
    await cover.getByRole("button", { name: "İmleçteki kareden kapak kaydet" }).click();
    await expect(cover.getByRole("status")).toHaveText("kapak.jpg kaydedildi.");
    const call = await page.evaluate(
      () =>
        (
          window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }
        ).__calls.find((c) => c.cmd === "editor_cover")?.args,
    );
    expect(call).toMatchObject({
      path: "C:\\Klipler\\oyun.mp4",
      seconds: 35,
      frame: { width: 1080, height: 1920 },
    });
    expect(String(call?.assScript)).toContain("Final maçı");
    expect(String(call?.assScript)).toContain("Style: Box");
  });
  test("çoklu biçim: üç biçim seçilir, yazı 16:9'da ayrı yerleşir, her biçim ayrı dosya olur", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: project.clips.slice(0, 2),
        texts: [
          {
            id: "t1",
            text: "Başlık",
            start: 1,
            end: 6,
            x: 0.5,
            y: 0.8,
            size: 0.07,
            color: "#ffffff",
            box: true,
            bold: true,
          },
        ],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    const multi = page.locator("[data-multi-format]");
    await expect(multi.getByRole("button", { name: /önizlenen biçim/ })).toBeDisabled();
    await multi.getByRole("button", { name: "Kare gönderi", exact: true }).click();
    await multi.getByRole("button", { name: "Yatay video", exact: true }).click();
    await expect(page.getByRole("button", { name: "3 dosyayı dışa aktar" })).toBeVisible();
    // 16:9'a geç ve yazıyı orada üste taşı: 9:16'daki yeri korunur.
    await multi
      .getByRole("button", { name: "Yatay video biçiminde önizle ve yazıları yerleştir" })
      .click();
    await page.keyboard.press("Escape");
    await page.locator("[data-text]").first().click();
    await page.getByRole("button", { name: "Üst", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "3 dosyayı dışa aktar" }).click();
    const requests = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        type R = {
          outputName: string;
          frame: { width: number; height: number };
          texts: { y: number }[];
        };
        return (useJobsStore.getState().jobs as { request: R }[])
          .map((j) => ({
            name: j.request.outputName,
            size: [j.request.frame.width, j.request.frame.height],
            y: j.request.texts[0]?.y,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    await expect.poll(async () => (await requests()).length).toBe(3);
    // 1:1 hiç yerleştirilmedi: son düzenlenen (16:9) konumu izler.
    expect(await requests()).toEqual([
      { name: "oyun (16x9)", size: [1920, 1080], y: 0.12 },
      { name: "oyun (1x1)", size: [1080, 1080], y: 0.12 },
      { name: "oyun (9x16)", size: [1080, 1920], y: 0.8 },
    ]);
    // Konumlar projeye kaydedilir.
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("button", { name: "Kaydedildi" })).toBeVisible();
    const saved = JSON.parse(
      await page.evaluate(
        () =>
          (window as unknown as { __files: Record<string, string> }).__files[
            "C:\\Projeler\\Turnuva.downkit"
          ],
      ),
    ) as {
      texts: { y: number; at: Record<string, { y: number }> }[];
      exportOptions: Record<string, unknown>;
    };
    expect(saved.texts[0].y).toBe(0.12);
    expect(saved.texts[0].at["9:16"].y).toBe(0.8);
    expect(saved.exportOptions).toMatchObject({ frame: "16:9", alsoFrames: ["9:16", "1:1"] });
    // Eşitle: önizlenen biçimdeki konum her biçimde kullanılır.
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await multi.getByRole("button", { name: "Yazı konumları bütün biçimlerde aynı olsun" }).click();
    await expect(
      multi.getByRole("button", { name: "Yazı konumları bütün biçimlerde aynı olsun" }),
    ).toHaveCount(0);
    await multi
      .getByRole("button", {
        name: "Dikey kısa video biçiminde önizle ve yazıları yerleştir",
      })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Üst", exact: true })).toHaveClass(/dk-accent/);
  });
  test("dönüşüm: üst izdeki klip küçültülüp bindirilir, anahtar karelerle canlanır, dışa aktarılır", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [
          {
            id: "a",
            sourceId: "s1",
            track: 0,
            start: 0,
            srcStart: 0,
            srcEnd: 20,
            speed: 1,
            name: "",
          },
          {
            id: "p",
            sourceId: "s1",
            track: 1,
            start: 5,
            srcStart: 40,
            srcEnd: 50,
            speed: 1,
            name: "",
          },
        ],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    const seek = (time: number) =>
      page.evaluate(async (t) => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/lib/sequencePlayer.ts")) as string;
        const { seekTimeline } = await import(/* @vite-ignore */ url);
        seekTimeline(t);
      }, time);
    await page.locator('[data-clip="p"]').click();
    await seek(6);
    const section = page.locator('[data-panel-section="transform"]');
    await section.getByRole("button", { name: /Dönüşüm/ }).click();
    const box = page.locator("[data-transform]");
    // Boyut %40, yatay %30: üst izdeki klip alttakinin üstüne biner.
    await box.getByRole("spinbutton", { name: "Boyut değeri" }).fill("40");
    await box.getByRole("spinbutton", { name: "Yatay değeri" }).fill("30");
    // Görünürlüğü zamana bağla: 6. sn %100, 9. sn %20.
    await box.getByRole("button", { name: "Görünürlük: imleçte anahtar kare ekle" }).click();
    await seek(9);
    await box.getByRole("spinbutton", { name: "Görünürlük değeri" }).fill("20");
    await expect(
      box.getByRole("button", { name: "Görünürlük: imleçteki anahtar kareyi sil" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText("◆ 2")).toBeVisible();
    // Önceki kareye git: imleç 6. saniyeye döner.
    await box.getByRole("button", { name: "Önceki anahtar kare" }).click();
    await expect(
      box.getByRole("button", { name: "Görünürlük: imleçteki anahtar kareyi sil" }),
    ).toBeVisible();
    // Geri al: son değer değişikliği geri gelir.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+z");
    await expect(section.getByText("◆ 1")).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(section.getByText("◆ 2")).toBeVisible();

    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as {
      clips: { start: number; end: number }[];
      overlays: { source: number; at: number; clip: Record<string, unknown> }[];
    };
    // Ana iz tek parça (alttaki klip kesilmez), bindirme 5. saniyede.
    expect(req.clips.map((c) => [c.start, c.end])).toEqual([[0, 20]]);
    expect(req.overlays).toHaveLength(1);
    expect(req.overlays[0]).toMatchObject({
      source: 0,
      at: 5,
      clip: {
        start: 40,
        end: 50,
        transform: {
          x: 0.3,
          scale: 0.4,
          keys: {
            opacity: [
              { t: 1, v: 1 },
              { t: 4, v: 0.2 },
            ],
          },
        },
      },
    });
  });
  test("zamanlı yakınlaştırma: imleçte eklenir, süreleri ayarlanır, bant taşınır, dışa aktarılır", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/lib/sequencePlayer.ts")) as string;
      const { seekTimeline } = await import(/* @vite-ignore */ url);
      seekTimeline(4);
    });
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    const section = page.locator("[data-zoom-section]");
    await section.getByRole("button", { name: "İmleçte yakınlaştır" }).click();
    const editor = page.locator("[data-zoom-editor]");
    await expect(editor).toBeVisible();
    // Yaklaşma anında, geri açılma 1000 ms; başlangıç 5. saniye.
    await editor
      .getByRole("group", { name: "Yaklaşma süresi" })
      .getByRole("button", { name: "Anında" })
      .click();
    await editor
      .getByRole("group", { name: "Geri açılma süresi" })
      .getByRole("button", { name: "1000 ms" })
      .click();
    await editor.getByRole("spinbutton", { name: "Başlangıç (sn)" }).fill("5");
    await expect(editor.getByRole("spinbutton", { name: "Bitiş (sn)" })).toHaveValue("6");
    await editor.getByRole("spinbutton", { name: "Bitiş (sn)" }).fill("8");
    await expect(page.locator("[data-zoom-band]")).toHaveCount(1);
    const state = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        return useEditorStore.getState().clips[0].zooms;
      });
    expect(await state()).toMatchObject([{ start: 5, end: 8, inMs: 0, outMs: 1000, size: 0.6 }]);
    // Bandı sağa sürükle: süre korunur.
    const band = (await page.locator("[data-zoom-band]").boundingBox())!;
    await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
    await page.mouse.down();
    await page.mouse.move(band.x + band.width / 2 + 20, band.y + band.height / 2, { steps: 4 });
    await page.mouse.up();
    const moved = (await state())[0];
    expect(moved.start).toBeGreaterThan(5);
    expect(moved.end - moved.start).toBeCloseTo(3, 5);

    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as {
      clips: { zoom: { keys: { scale: { t: number; v: number }[] } } }[];
    };
    const keys = req.clips[0].zoom.keys.scale;
    expect(keys[0]).toMatchObject({ t: Number(moved.start.toFixed(4)), v: 1 });
    expect(keys.at(-1)).toMatchObject({ t: Number(moved.end.toFixed(4)), v: 1 });
    expect(Math.max(...keys.map((k) => k.v))).toBeCloseTo(1 / 0.6, 4);
  });

  test("hız eğrisi: hazır eğri klibi parçalara böler, hareket bulanıklığı dışa aktarılır", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    const curve = page.getByTestId("speed-curve");
    await curve.locator('[data-curve="hero"]').click();
    // 20 sn'lik klip kahraman eğrisiyle kısalır (hızlı giriş/çıkış, ortada yavaş).
    await expect(curve.getByTestId("curve-duration")).toContainText("20 sn →");
    await curve.getByRole("switch", { name: "Hareket bulanıklığı" }).click();
    await curve.getByTestId("apply-curve").click();
    const clips = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        return useEditorStore.getState().clips as { speed: number; motionBlur?: boolean }[];
      });
    const after = await clips();
    expect(after.length).toBeGreaterThan(2);
    expect(new Set(after.map((c) => c.speed)).size).toBeGreaterThan(1);
    expect(after.every((c) => c.motionBlur === true)).toBe(true);
    await expect(page.locator("[data-clip]")).toHaveCount(after.length);

    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as { clips: { speed: number; motionBlur?: boolean }[] };
    expect(req.clips.length).toBe(after.length);
    expect(req.clips.every((c) => c.motionBlur === true)).toBe(true);
  });

  test("dondurulmuş kare ve ters oynatma dışa aktarma isteğine girer", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [{ ...project.clips[0], srcEnd: 8 }],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/lib/sequencePlayer.ts")) as string;
      const { seekTimeline } = await import(/* @vite-ignore */ url);
      seekTimeline(3);
    });
    await page.locator('[data-clip="a"]').click({ position: { x: 20, y: 40 } });
    await page.getByRole("switch", { name: "Ters oynat" }).click();
    await page.getByTestId("freeze-frame").click();
    await expect(page.locator("[data-clip]")).toHaveCount(3);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as {
      clips: { start: number; end: number; freezeAt?: number; reverse?: boolean }[];
    };
    // Ters klipte imleç 3. saniyede kaynağın 5. saniyesi: ilk parça 8→5, kare 5'te, sonra 5→0.
    expect(req.clips.map((c) => [c.start, c.end, c.freezeAt ?? null, c.reverse ?? false])).toEqual([
      [5, 8, null, true],
      [5, 7, 5, false],
      [0, 5, null, true],
    ]);
  });

  test("görünüm efekti: kart şeride düşer, şiddeti ayarlanır, dışa aktarmaya girer", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.getByRole("button", { name: "Efektler", exact: true }).click();
    const browser = page.locator("[data-fx-browser]");
    await browser.getByRole("textbox", { name: "Efekt ara" }).fill("tarama");
    await expect(browser.locator("[data-fx-card]")).toHaveCount(1);
    await browser.locator('[data-fx-card="vhs"]').click();
    await page.getByRole("slider", { name: "VHS şiddeti" }).fill("0.3");
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as { clips: { look?: { fx?: { vhs?: number } } }[] };
    // Blok 0–3 sn: ilk parça VHS'li, gerisi düz.
    expect(req.clips[0].look?.fx).toEqual({ vhs: 0.3 });
    expect(req.clips.at(-1)!.look?.fx).toBeUndefined();
  });

  test("çıkartma: renk ve yazıyla imleçte resim katmanına eklenir", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.getByRole("button", { name: "Logo", exact: true }).click();
    const stickers = page.locator("[data-stickers]");
    await stickers.getByRole("radio", { name: "#ff3b5c" }).click();
    await stickers.getByRole("textbox").fill("Yeni bölüm");
    await stickers.locator('[data-sticker="tag"]').click();
    await stickers.locator('[data-sticker="arrowRight"]').click();
    const images = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        return useEditorStore.getState().images as { path: string; name: string; end: number }[];
      });
    await expect.poll(async () => (await images()).length).toBe(2);
    const [tag, arrow] = await images();
    expect(tag!.name).toBe("Yeni bölüm");
    expect(tag!.path).toMatch(/cache.*5c-[0-9a-f]+\.png$/);
    expect(arrow!.path).not.toBe(tag!.path);
    expect(tag!.end).toBe(3);
  });

  test("hareketli başlık: şablon seçilir, metin yazılır, imleçte katman olur, güncellenir", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.getByRole("button", { name: "Hareketli başlık", exact: true }).click();
    await page.locator('[data-motion-template="lower-third"]').click();
    // Türkçe varsayılan metin gelir; değiştirilir.
    const name = page.getByRole("textbox", { name: "Ad" });
    await expect(name).toHaveValue("Ayşe Yılmaz");
    await name.fill("Deniz Kaya");
    await page.getByRole("button", { name: "Videoya ekle" }).click();
    const images = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        return useEditorStore.getState().images as {
          path: string;
          name: string;
          start: number;
          end: number;
          size: number;
          motion?: { template: string; values: string[]; background: boolean };
        }[];
      });
    await expect.poll(async () => (await images()).length).toBe(1);
    const [item] = await images();
    expect(item!.name).toBe("Alt bant");
    expect(item!.path).toMatch(/lower-third-Deniz Kaya_İçerik Üreticisi_#3d8bff.webm$/);
    expect(item!.end - item!.start).toBe(6);
    expect(item!.size).toBe(1);
    expect(item!.motion).toEqual({
      template: "lower-third",
      values: ["Deniz Kaya", "İçerik Üreticisi", "#3d8bff"],
      background: false,
    });
    // Düzenle → metni değiştir → aynı katman yeni dosyayla güncellenir.
    await page.getByRole("button", { name: "Başlığı düzenle" }).click();
    await page.getByRole("textbox", { name: "Başlık" }).fill("Editör");
    await page.getByRole("button", { name: "Güncelle" }).click();
    await expect.poll(async () => (await images())[0]?.motion?.values[1]).toBe("Editör");
    expect((await images()).length).toBe(1);
    // Dikey şablon yatay videoda yüksekliğe sığar.
    await page.locator('[data-motion-template="vertical-story"]').click();
    await page.getByRole("button", { name: "Videoya ekle" }).click();
    await expect.poll(async () => (await images()).length).toBe(2);
    expect((await images())[1]!.size).toBeCloseTo(1080 / 1920 / (1920 / 1080), 3);
  });

  test("renk düzeltme: tekerlek, seviye ve eğri dışa aktarma isteğine girer", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    await page.getByRole("button", { name: "Renk", exact: true }).click();
    const panel = page.locator("[data-grade-panel]");
    await panel.getByRole("slider", { name: "Pozlama" }).fill("0.5");
    await panel.getByRole("slider", { name: "Koyular" }).fill("-0.5");
    // Orta ton tekerleğinin sağ kenarına (kırmızı) tıkla.
    const wheel = (await panel.getByRole("slider", { name: "Orta tonlar" }).boundingBox())!;
    await page.mouse.click(wheel.x + wheel.width - 2, wheel.y + wheel.height / 2);
    // Eğriye ortadan yukarıda bir nokta ekle.
    const curve = (await panel.locator("[data-grade-curve]").boundingBox())!;
    await page.mouse.dblclick(curve.x + curve.width / 2, curve.y + curve.height * 0.3);
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as {
      clips: {
        look?: {
          grade?: {
            exposure: number;
            lift: number;
            midtones: { x: number; y: number };
            curve?: [number, number][];
          };
        };
      }[];
    };
    const grade = req.clips[0].look!.grade!;
    expect(grade.exposure).toBe(0.5);
    expect(grade.lift).toBe(-0.5);
    expect(grade.midtones.x).toBeGreaterThan(0.8);
    expect(grade.curve).toHaveLength(3);
    expect(grade.curve![1]![1]).toBeGreaterThan(0.5);
  });

  test("ses onarımı ve sosyal medya ses seviyesi dışa aktarma isteğine girer", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        exportOptions: { frame: "original" },
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    const repair = page.locator("[data-audio-repair]");
    await repair.getByRole("radio", { name: "Konuşma" }).click();
    await repair.getByRole("slider", { name: "Gürültü" }).fill("0.8");
    await repair.getByRole("button", { name: "Eşitleyici ve dinamik" }).click();
    await repair.getByRole("slider", { name: "Bas" }).fill("3");
    await repair.getByRole("slider", { name: "Tiz" }).fill("-4.5");
    await repair.getByRole("switch", { name: /Sınırlayıcı/ }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).click();
    await page.getByRole("switch", { name: "Sosyal medya ses seviyesi" }).click();
    await page.getByRole("button", { name: "Dışa aktar", exact: true }).last().click();
    const request = async () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/jobsStore.ts")) as string;
        const { useJobsStore } = await import(/* @vite-ignore */ url);
        const jobs = useJobsStore.getState().jobs as { request: Record<string, unknown> }[];
        return jobs[0]?.request ?? null;
      });
    await expect.poll(request).not.toBeNull();
    const req = (await request()) as {
      loudness: number | null;
      clips: { audioFx?: Record<string, unknown> }[];
    };
    expect(req.loudness).toBe(-14);
    expect(req.clips[0].audioFx).toEqual({
      music: false,
      noise: 0.8,
      wind: true,
      echo: 0.3,
      enhance: true,
      low: 3,
      high: -4.5,
      limit: true,
    });
  });

  test("görünüm efekti herkese açık: tıklayınca eklenir, kilit penceresi yok", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.getByRole("button", { name: "Efektler", exact: true }).click();
    await page.locator('[data-fx-card="vhs"]').click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-lane="effect"][data-lane-item]')).toHaveCount(1);
  });

  test("renk ayarı yalnızca tıklanan klibe yazılır (Ctrl+A sonrası tıklama seçimi daraltır)", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: [project.clips[0], project.clips[1]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    await page.keyboard.press("Control+a");
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    await page.getByRole("button", { name: "Renk", exact: true }).click();
    await page.locator("[data-grade-panel]").getByRole("slider", { name: "Pozlama" }).fill("0.5");
    const grades = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      return (
        useEditorStore.getState().clips as { id: string; look?: { grade?: { exposure: number } } }[]
      ).map((c) => [c.id, c.look?.grade?.exposure ?? null]);
    });
    expect(grades).toEqual([
      ["a", 0.5],
      ["b", null],
    ]);
  });

  test("kaydırıcı odaktayken ok tuşu tek adım yazar, Ctrl+Z geri alır, Ctrl+Y yineler", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: [project.clips[0]],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(1);
    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    await page.getByRole("button", { name: "Renk", exact: true }).click();
    const slider = page.locator("[data-grade-panel]").getByRole("slider", { name: "Pozlama" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const exposure = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        return useEditorStore.getState().clips[0].look?.grade?.exposure ?? null;
      });
    await expect.poll(exposure).toBeCloseTo(0.04, 5);
    await page.keyboard.press("Control+z");
    await expect.poll(exposure).toBeCloseTo(0.02, 5);
    await page.keyboard.press("Control+y");
    await expect.poll(exposure).toBeCloseTo(0.04, 5);
  });

  test("Ctrl+A klipleri ve blokları seçer, Delete hepsini tek adımda siler; kutu seçimi çalışır", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: [project.clips[0], project.clips[1]],
        texts: [
          {
            id: "t1",
            text: "Merhaba",
            start: 1,
            end: 3,
            x: 0.5,
            y: 0.5,
            size: 0.07,
            color: "#ffffff",
            box: false,
            bold: true,
          },
        ],
        effects: [{ id: "e1", start: 2, end: 4, look: { blur: 0.4 } }],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    const state = () =>
      page.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((n) => n.includes("/src/store/editorStore.ts")) as string;
        const { useEditorStore } = await import(/* @vite-ignore */ url);
        const s = useEditorStore.getState();
        return {
          clips: s.clips.length,
          texts: s.texts.length,
          effects: s.effects.length,
          selected: s.selectedIds.length,
        };
      });
    // Kutu seçimi: izlerin boş yerinden başlayıp ilk klibin üstünden geçen dikdörtgen.
    const clip = (await page.locator('[data-clip="a"]').boundingBox())!;
    const mid = clip.x + Math.min(clip.width / 2, 40);
    await page.mouse.move(mid - 5, clip.y + clip.height + 6);
    await page.mouse.down();
    await page.mouse.move(mid + 5, clip.y + clip.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await state()).selected).toBe(1);

    await page.locator('[data-clip="a"]').click({ position: { x: 30, y: 40 } });
    await page.keyboard.press("Control+a");
    // İki klip, yazı ve efekt bloğu seçili görünür (beyaz çerçeve).
    await expect(page.locator('[class*="0_0_0_2px_white"]')).toHaveCount(4);
    await page.keyboard.press("Delete");
    await expect.poll(state).toEqual({ clips: 0, texts: 0, effects: 0, selected: 0 });
    await page.keyboard.press("Control+z");
    await expect.poll(state).toMatchObject({ clips: 2, texts: 1, effects: 1 });
  });

  test("ana izden klip silinince sonraki klip, yazı ve efekt birlikte kayar", async ({ page }) => {
    await mockTauri(page);
    await page.addInitScript((project) => {
      const w = window as unknown as { __files: Record<string, string> };
      w.__files["C:\\Projeler\\Turnuva.downkit"] = JSON.stringify({
        ...project,
        sources: [project.sources[0]],
        clips: [project.clips[0], project.clips[1]],
        texts: [
          {
            id: "t1",
            text: "İkinci",
            start: 22,
            end: 25,
            x: 0.5,
            y: 0.5,
            size: 0.07,
            color: "#ffffff",
            box: false,
            bold: true,
          },
        ],
        effects: [{ id: "e1", start: 21, end: 24, look: { blur: 0.4 } }],
      });
    }, PROJECT);
    await page.goto("/?lang=tr&route=editor");
    await page.getByRole("button", { name: "Proje aç…" }).click();
    await expect(page.locator("[data-clip]")).toHaveCount(2);
    await page.locator('[data-clip="a"]').click({ position: { x: 20, y: 40 } });
    await page.keyboard.press("Delete");
    const state = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/src/store/editorStore.ts")) as string;
      const { useEditorStore } = await import(/* @vite-ignore */ url);
      const s = useEditorStore.getState();
      return { clip: s.clips[0].start, text: s.texts[0].start, effect: s.effects[0].start };
    });
    expect(state).toEqual({ clip: 0, text: 2, effect: 1 });
  });
});
