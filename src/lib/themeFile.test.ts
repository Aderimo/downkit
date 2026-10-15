import { describe, expect, it } from "vitest";
import { DEFAULT_BACKGROUND, bakedFilter, normalizeBackground } from "./background";
import { parseThemeFile, toThemeFile } from "./themeFile";
import { customTheme, DEFAULT_CUSTOM_COLORS, mixHex, normalizeCustomColors } from "./themes";

describe("özel tema", () => {
  it("renkler karışır ve geçersiz renk varsayılana döner", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    const c = normalizeCustomColors({ accent: "#ABCDEF", bg: "kırmızı", mode: "light" });
    expect(c.accent).toBe("#abcdef");
    expect(c.bg).toBe(DEFAULT_CUSTOM_COLORS.bg);
    expect(c.mode).toBe("light");
  });

  it("açık kipte gölge yazı rengi, koyuda ikinci vurgu olur", () => {
    expect(customTheme({ ...DEFAULT_CUSTOM_COLORS, mode: "light" }).palette.shadow).toBe(
      DEFAULT_CUSTOM_COLORS.text,
    );
    expect(customTheme(DEFAULT_CUSTOM_COLORS).palette.shadow).toBe(DEFAULT_CUSTOM_COLORS.accent2);
  });
});

describe("arka plan ayarları", () => {
  it("sınırlara çekilir, filtre yalnızca değişen değerleri içerir", () => {
    const b = normalizeBackground({ opacity: 9, blur: -3, fit: "uzat", brightness: 1 });
    expect(b.opacity).toBe(1);
    expect(b.blur).toBe(0);
    expect(b.fit).toBe("cover");
    expect(bakedFilter({ ...b, contrast: 1, saturate: 1 })).toBe("none");
    expect(bakedFilter({ ...DEFAULT_BACKGROUND, blur: 8, brightness: 1 }, 0.5)).toBe("blur(4.0px)");
  });
});

describe("tema dosyası", () => {
  const image = "data:image/jpeg;base64,/9j/AAAA";

  it("dışa aktarılan dosya geri okunur", () => {
    const bg = { ...DEFAULT_BACKGROUND, enabled: true, blur: 12 };
    const parsed = parseThemeFile(
      JSON.parse(JSON.stringify(toThemeFile(DEFAULT_CUSTOM_COLORS, bg, image))),
    );
    expect(parsed).toEqual({ colors: DEFAULT_CUSTOM_COLORS, background: bg, image });
  });

  it("JPEG olmayan resim alınmaz, resimsiz arka plan kapalı gelir", () => {
    const parsed = parseThemeFile({
      type: "theme",
      colors: {},
      background: { enabled: true },
      image: "https://ornek.com/a.jpg",
    });
    expect(parsed?.image).toBeNull();
    expect(parsed?.background.enabled).toBe(false);
    expect(parseThemeFile({ type: "editor-presets" })).toBeNull();
  });
});
