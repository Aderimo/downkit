import { describe, expect, it } from "vitest";
import { fxCss, fxFrame, hasFx, type FxInput } from "./clipFx";

const base: FxInput = {
  motion: "none",
  strength: 0.25,
  offset: 0,
  total: 4,
  transition: "fade",
  duration: 4,
  fadeIn: 0.5,
  fadeOut: 0.5,
};

describe("klip hareketleri (Rust ffmpeg::fx ile aynı formül)", () => {
  it("yakınlaşma baştan sona 1'den 1+şiddet'e çıkar", () => {
    const fx = { ...base, motion: "zoomIn" as const };
    expect(fxFrame(fx, 0).zoom).toBeCloseTo(1);
    expect(fxFrame(fx, 2).zoom).toBeCloseTo(1.125);
    expect(fxFrame(fx, 4).zoom).toBeCloseTo(1.25);
  });

  it("bölünmüş parçada hareket kaldığı yerden sürer", () => {
    const fx = { ...base, motion: "zoomIn" as const, offset: 2, duration: 2 };
    expect(fxFrame(fx, 0).zoom).toBeCloseTo(1.125);
  });

  it("kaydırma geçişi sağdan girer, sola çıkar; ortada yerinde durur", () => {
    const fx = { ...base, transition: "slide" as const };
    expect(fxFrame(fx, 0).shiftX).toBeCloseTo(1);
    expect(fxFrame(fx, 2).shiftX).toBeCloseTo(0);
    expect(fxFrame(fx, 4).shiftX).toBeCloseTo(-1);
  });

  it("kararma stilinde ve hareketsiz klipte dönüşüm yok", () => {
    expect(hasFx(base)).toBe(false);
    expect(fxCss(fxFrame(base, 1)).transform).toBe("");
    expect(hasFx({ ...base, transition: "blur" })).toBe(true);
    expect(hasFx({ ...base, transition: "blur", fadeIn: 0, fadeOut: 0 })).toBe(false);
  });
});
