import { describe, expect, it } from "vitest";
import { applyTheme, getTheme, isThemeId, themeVariables, THEMES } from "./themes";
import { normalizeSettings } from "./appSettings";

/** WCAG göreli parlaklık ve kontrast oranı. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("renk temaları", () => {
  it("en az 12 tema var, kimlikleri benzersiz", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.some((t) => t.mode === "light")).toBe(true);
  });

  it.each(THEMES.map((t) => [t.id, t] as const))("%s temasında yazılar okunur", (_, theme) => {
    const p = theme.palette;
    // Ana metin kart ve zemin üzerinde AAA, soluk metin AA (büyük/ikincil yazı).
    expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(3.5);
    // Birincil düğmedeki beyaz yazı vurgu renginde okunur.
    expect(contrast("#ffffff", p.accent)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES.map((t) => [t.id, t] as const))(
    "%s temasında kayıt eylem düğmeleri okunur",
    (_, theme) => {
      const v = themeVariables(theme);
      expect(contrast("#ffffff", v["--dk-edit"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#ffffff", v["--dk-save"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--dk-save-soft-text"], v["--dk-save-soft"])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("değişkenler kök öğeye yazılır, açık temada kip değişir", () => {
    const root = document.createElement("div");
    const theme = applyTheme("snow", root);
    expect(theme.mode).toBe("light");
    expect(root.dataset.mode).toBe("light");
    expect(root.style.getPropertyValue("--dk-bg")).toBe(themeVariables(theme)["--dk-bg"]);
    expect(themeVariables(getTheme("graphite"))["--dk-gradient"]).toContain("linear-gradient");
  });

  it("bilinmeyen tema varsayılana döner", () => {
    expect(isThemeId("yok")).toBe(false);
    expect(getTheme("yok").id).toBe("midnight");
    expect(normalizeSettings({ theme: "yok" }).theme).toBe("midnight");
    expect(normalizeSettings({ theme: "sakura" }).theme).toBe("sakura");
  });
});
