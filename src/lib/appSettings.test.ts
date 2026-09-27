import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./appSettings";

describe("ayar geçişleri", () => {
  it("platforma göre klasörleme yeni kurulumda açık", () => {
    expect(normalizeSettings({}).groupByPlatform).toBe(true);
    expect(DEFAULT_SETTINGS.groupByPlatform).toBe(true);
  });

  it("eski (sürümsüz) kayıtta bir kez açılır", () => {
    const old = normalizeSettings({ groupByPlatform: false });
    expect(old.groupByPlatform).toBe(true);
    expect(old.settingsVersion).toBe(DEFAULT_SETTINGS.settingsVersion);
  });

  it("geçişten sonra kullanıcı kapatırsa kapalı kalır", () => {
    const saved = normalizeSettings({ groupByPlatform: false, settingsVersion: 2 });
    expect(saved.groupByPlatform).toBe(false);
  });
});
