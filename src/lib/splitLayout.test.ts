import { describe, expect, it } from "vitest";
import {
  bandShare,
  defaultSplit,
  effectiveSplit,
  fitRect,
  moveRect,
  parseSplit,
  resizeRect,
  slotAspects,
  withShare,
} from "./splitLayout";

const SRC = 16 / 9;
const pixelAspect = (r: { w: number; h: number }) => (r.w / r.h) * SRC;

describe("kamera + oyun düzeni", () => {
  it("bölgeler yuvalarının oranına kilitli ve kaynağın içinde", () => {
    const l = defaultSplit(SRC, 1080, 1920);
    const slots = slotAspects(l.camShare, 1080, 1920);
    expect(pixelAspect(l.cam)).toBeCloseTo(slots.cam, 5);
    expect(pixelAspect(l.game)).toBeCloseTo(slots.game, 5);
    for (const r of [l.cam, l.game]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Kamera sağ üstte.
    expect(l.cam.x).toBeGreaterThan(0.5);
  });

  it("pay değişince oranlar uyarlanır; taşıma ve büyütme sınırda kalır", () => {
    const l = withShare(defaultSplit(SRC, 1080, 1920), 0.5, SRC, 1080, 1920);
    expect(pixelAspect(l.cam)).toBeCloseTo(slotAspects(0.5, 1080, 1920).cam, 5);
    const moved = moveRect(l.cam, 5, 5);
    expect(moved.x + moved.w).toBeCloseTo(1);
    expect(moved.y + moved.h).toBeCloseTo(1);
    const big = resizeRect({ x: 0, y: 0, w: 0.2, h: 0.2 }, 5, 1, SRC);
    expect(big.h).toBeLessThanOrEqual(1);
    expect(pixelAspect(big)).toBeCloseTo(1, 5);
    expect(fitRect({ x: 0, y: 0, w: 1, h: 1 }, 0.5, SRC).h).toBe(1);
  });

  it("kayıttan okunur, bozuksa yok sayılır; boşsa varsayılan kullanılır", () => {
    expect(parseSplit({ cam: { x: 0, y: 0, w: 1 }, game: {} })).toBeNull();
    const p = parseSplit({
      cam: { x: 0, y: 0, w: 0.2, h: 0.2 },
      game: { x: 0, y: 0, w: 0.5, h: 1 },
      camShare: 9,
    });
    expect(p?.camShare).toBe(0.6);
    expect(p?.camTop).toBe(true);
    expect(effectiveSplit(null, SRC, 1080, 1920).camShare).toBe(0.35);
  });
});

describe("middle strip", () => {
  it("leaves room for the game and is parsed from saved projects", () => {
    const base = defaultSplit(16 / 9, 1080, 1920);
    const withBand = withShare(
      { ...base, band: { share: 0.2, color: "#ffd43b" } },
      0.6,
      16 / 9,
      1080,
      1920,
    );
    // Kamera + şerit en çok %70: oyuna en az %30 kalır.
    expect(withBand.camShare).toBeCloseTo(0.5);
    expect(bandShare(withBand)).toBe(0.2);
    expect(bandShare({ ...withBand, style: "circle" })).toBe(0);
    expect(slotAspects(0.35, 1080, 1920, "stack", 0.1).game).toBeCloseTo(1080 / (1920 * 0.55));
    expect(parseSplit({ ...base, band: { share: 0.9, color: "#000000" } })?.band).toEqual({
      share: 0.25,
      color: "#000000",
    });
    expect(parseSplit({ ...base, band: { share: 0.1, color: "red" } })?.band).toBeUndefined();
  });
});
