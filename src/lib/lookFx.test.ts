import { describe, expect, it } from "vitest";
import { fxPreview, glitchOn, mergeFx, normalizeFx, strobeLevel } from "./lookFx";
import { isDefaultLook, normalizeLook } from "./clipLook";
import { effectKey, mergeEffectLook, parseEffects } from "./effectLane";

describe("görünüm efektleri", () => {
  it("geçersiz ve sıfır değerler atılır, şiddet 0–1", () => {
    expect(normalizeFx({ glitch: 2, grain: 0, vhs: -1, bogus: 1, sharpen: 0.333 })).toEqual({
      glitch: 1,
      sharpen: 0.33,
    });
    expect(normalizeFx({ grain: 0 })).toBeUndefined();
    expect(normalizeFx("x")).toBeUndefined();
  });

  it("görünüme katılır; efekt varsa görünüm varsayılan değildir", () => {
    expect(isDefaultLook({ fx: { grain: 0.5 } })).toBe(false);
    expect(isDefaultLook({ fx: { grain: 0 } })).toBe(true);
    expect(normalizeLook({ fx: { vhs: 0.4 } }).fx).toEqual({ vhs: 0.4 });
    expect(normalizeLook({})).not.toHaveProperty("fx");
  });

  it("efekt şeridi klibin efektlerine büyüğünü katar", () => {
    expect(mergeFx({ grain: 0.2, glitch: 0.5 }, { grain: 0.7 })).toEqual({
      grain: 0.7,
      glitch: 0.5,
    });
    const look = mergeEffectLook(normalizeLook({ fx: { grain: 0.2 } }), [
      { id: "e", start: 0, end: 2, look: { fx: { rgbSplit: 0.6 } } },
    ]);
    expect(look?.fx).toEqual({ grain: 0.2, rgbSplit: 0.6 });
  });

  it("kayıttan okunur ve bloğun adı efektten gelir", () => {
    const [item] = parseEffects([{ id: "e", start: 0, end: 2, look: { fx: { vhs: 0.5, x: 1 } } }]);
    expect(item!.look).toEqual({ fx: { vhs: 0.5 } });
    expect(effectKey(item!)).toEqual({ key: "lookFx.names", id: "vhs" });
  });

  it("zamanlı efektler Rust'taki formülle aynı anlarda", () => {
    expect(glitchOn(0.01)).toBe(true);
    expect(glitchOn(0.5)).toBe(false);
    expect(strobeLevel(0.4, 0.01)).toBeCloseTo(0.2);
    expect(strobeLevel(0.4, 0.1)).toBe(0);
  });

  it("önizleme: VHS tarama çizgisi ve gren, ışık sızması katmanı", () => {
    const vhs = fxPreview({ vhs: 1 }, 0.5);
    expect(vhs.scanlines).toBe(1);
    expect(vhs.grain).toBeCloseTo(0.4);
    expect(vhs.filter).toContain("drop-shadow");
    expect(fxPreview({ lightLeak: 1 }, 0).leak).not.toBeNull();
    expect(fxPreview(undefined, 0)).toEqual({
      filter: "",
      transform: "",
      grain: 0,
      scanlines: 0,
      leak: null,
    });
  });
});
