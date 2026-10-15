import { describe, expect, it } from "vitest";
import { AUDIO_FX_PRESETS, normalizeAudioFx } from "./audioFx";

describe("ses onarımı ayarları", () => {
  it("hiçbir şey açık değilse ayar yok sayılır", () => {
    expect(normalizeAudioFx(null)).toBeUndefined();
    expect(normalizeAudioFx({ music: true, low: 0, compress: 0, limit: false })).toBeUndefined();
  });

  it("hazır ayarlar olduğu gibi kalır; eşitleyici alanı eklenmez", () => {
    expect(normalizeAudioFx(AUDIO_FX_PRESETS.speech)).toEqual(AUDIO_FX_PRESETS.speech);
  });

  it("eşitleyici sınırlanır ve yarım dB'e yuvarlanır, tek başına da geçerlidir", () => {
    expect(normalizeAudioFx({ low: 30, mid: -2.26, high: "x" })).toEqual({
      music: false,
      noise: 0,
      wind: false,
      echo: 0,
      enhance: false,
      low: 12,
      mid: -2.5,
    });
  });

  it("sıkıştırma 0–1, sınırlayıcı yalnız true ise açılır", () => {
    const fx = normalizeAudioFx({ compress: 1.7, limit: "evet" });
    expect(fx?.compress).toBe(1);
    expect(fx?.limit).toBeUndefined();
    expect(normalizeAudioFx({ limit: true })?.limit).toBe(true);
  });
});
