import { describe, expect, it } from "vitest";
import { DEFAULT_SNIP_SETTINGS, normalizeSnipSettings } from "./snipSettings";
import { DEFAULT_HOTKEYS, normalizeRecorderSettings } from "./recorderSettings";

describe("ekran görüntüsü ayarları", () => {
  it("boş ya da bozuk kayıt varsayılanlara döner", () => {
    expect(normalizeSnipSettings({})).toEqual(DEFAULT_SNIP_SETTINGS);
    expect(normalizeSnipSettings(null)).toEqual(DEFAULT_SNIP_SETTINGS);
    expect(normalizeSnipSettings("metin")).toEqual(DEFAULT_SNIP_SETTINGS);
  });

  it("tanınmayan değerler reddedilir, kalite sınırlara çekilir", () => {
    const s = normalizeSnipSettings({
      format: "bmp",
      quality: 400,
      enterAction: "sil",
      delaySeconds: 7,
      translateDirection: "de-tr",
      copyOnSave: "evet",
      outputDir: "",
    });
    expect(s.format).toBe("png");
    expect(s.quality).toBe(100);
    expect(s.enterAction).toBe("edit");
    expect(s.delaySeconds).toBe(0);
    expect(s.translateDirection).toBe("auto");
    expect(s.copyOnSave).toBe(DEFAULT_SNIP_SETTINGS.copyOnSave);
    expect(s.outputDir).toBeNull();
    expect(normalizeSnipSettings({ quality: 12 }).quality).toBe(50);
  });

  it("geçerli seçimler korunur", () => {
    const saved = {
      outputDir: "D:\\Görüntüler",
      format: "webp",
      quality: 80,
      enterAction: "copy",
      copyOnSave: false,
      delaySeconds: 5,
      translateDirection: "en-tr",
      translateOpensEditor: true,
    };
    expect(normalizeSnipSettings(saved)).toEqual(saved);
  });

  it("eski kayıt ayarlarında ekran görüntüsü kısayolları varsayılanla gelir", () => {
    const old = normalizeRecorderSettings({ hotkeys: { record: "Ctrl+Alt+F9" } });
    expect(old.hotkeys.snip).toBe(DEFAULT_HOTKEYS.snip);
    expect(old.hotkeys.snipTranslate).toBe("Alt+Shift+T");
    // Tam ekranın varsayılanı yok (başka programın kısayolunu çalmasın).
    expect(old.hotkeys.snipFull).toBeNull();
    // Kullanıcının kaldırdığı kısayol geri gelmez.
    expect(normalizeRecorderSettings({ hotkeys: { snip: null } }).hotkeys.snip).toBeNull();
  });
});
