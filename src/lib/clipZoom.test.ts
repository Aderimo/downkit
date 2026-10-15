import { describe, expect, it } from "vitest";
import {
  clampZoom,
  defaultPan,
  newZoom,
  orderedZooms,
  parseZooms,
  placeZoom,
  zoomFactor,
  zoomTransform,
  type ZoomSpan,
} from "./clipZoom";
import { propAt } from "./clipTransform";

const zoom = (patch: Partial<ZoomSpan> = {}): ZoomSpan => ({ ...newZoom("z", 10, 14), ...patch });

describe("zoom spans", () => {
  it("ramps in, holds, ramps out (times in source seconds, ramps in output ms)", () => {
    const tr = zoomTransform([zoom({ size: 0.5, inMs: 500, outMs: 1000 })], 1)!;
    expect(propAt(tr, "scale", 9)).toBe(1);
    expect(propAt(tr, "scale", 10)).toBe(1);
    expect(propAt(tr, "scale", 10.25)).toBeCloseTo(1.5);
    expect(propAt(tr, "scale", 10.5)).toBe(2);
    expect(propAt(tr, "scale", 12.9)).toBe(2);
    expect(propAt(tr, "scale", 13.5)).toBeCloseTo(1.5);
    expect(propAt(tr, "scale", 14)).toBe(1);
    expect(propAt(tr, "scale", 20)).toBe(1);
    // Ortadaki bölge: kayma yok.
    expect(propAt(tr, "x", 12)).toBe(0);
  });

  it("moves the region centre to the middle without showing black edges", () => {
    // 2×, sağ üst köşe: merkez (0.75, 0.25) → kayma en çok (2−1)/2 = 0.5.
    const tr = zoomTransform([zoom({ size: 0.5, x: 0.75, y: 0.25 })], 1)!;
    expect(propAt(tr, "x", 12)).toBeCloseTo(-0.5);
    expect(propAt(tr, "y", 12)).toBeCloseTo(0.5);
    // Merkez kenara taşamaz: clampZoom bölgeyi içeri çeker.
    expect(clampZoom(zoom({ size: 0.5, x: 0.95, y: 0 }))).toMatchObject({ x: 0.75, y: 0.25 });
  });

  it("instant zoom uses a one-frame step; ramps scale with clip speed and fit the span", () => {
    const instant = zoomTransform([zoom({ inMs: 0, outMs: 0 })], 1)!;
    expect(propAt(instant, "scale", 10.02)).toBeCloseTo(zoomFactor({ size: 0.6 }));
    // 2× hızlı klipte 500 ms çıktı = 1 sn kaynak.
    const fast = zoomTransform([zoom({ size: 0.5, inMs: 500, outMs: 0 })], 2)!;
    expect(propAt(fast, "scale", 10.5)).toBeCloseTo(1.5);
    // Süreler aralıktan uzunsa orantılı kısalır (tepe noktası ortada).
    const short = zoomTransform(
      [zoom({ start: 10, end: 11, size: 0.5, inMs: 3000, outMs: 3000 })],
      1,
    )!;
    expect(propAt(short, "scale", 10.5)).toBe(2);
  });

  it("orders spans, pushes overlaps apart and keeps neighbours when placing", () => {
    const a = zoom({ id: "a", start: 0, end: 4 });
    const b = zoom({ id: "b", start: 3, end: 6 });
    expect(orderedZooms([b, a]).map((z) => [z.id, z.start, z.end])).toEqual([
      ["a", 0, 4],
      ["b", 4, 6],
    ]);
    const placed = placeZoom([a, { ...b, start: 8, end: 10 }], "b", 2, 5, { min: 0, max: 20 });
    expect(placed.find((z) => z.id === "b")).toMatchObject({ start: 4, end: 7 });
    // Taşıma süreyi korur; kenardan uzatma yalnız o kenarı sınırlar.
    expect(placeZoom([a], "a", 18, 23, { min: 0, max: 20 })[0]).toMatchObject({
      start: 15,
      end: 20,
    });
    expect(placeZoom([a], "a", 0, 23, { min: 0, max: 20 }, "resize")[0]).toMatchObject({
      start: 0,
      end: 20,
    });
    const next = { ...b, start: 8, end: 10 };
    expect(placeZoom([a, next], "a", 0, 9, { min: 0, max: 20 }, "resize")[0]).toMatchObject({
      start: 0,
      end: 8,
    });
  });

  it("adjacent spans share one boundary key; parse drops broken spans", () => {
    const tr = zoomTransform(
      [zoom({ id: "a", start: 0, end: 2 }), zoom({ id: "b", start: 2, end: 4 })],
      1,
    )!;
    const times = tr.keys!.scale!.map((k) => k.t);
    expect(new Set(times).size).toBe(times.length);
    expect(parseZooms("x")).toBeUndefined();
    expect(parseZooms([{ id: "a", start: 1, end: 0 }])).toBeUndefined();
    expect(parseZooms([{ id: "a", start: 1, end: 3, size: 9 }])).toEqual([
      { id: "a", start: 1, end: 3, x: 0.5, y: 0.5, size: 0.95, inMs: 300, outMs: 300 },
    ]);
  });

  it("kaydır ve yakınlaştır: bekleme boyunca başlangıç bölgesinden bitiş bölgesine kayar", () => {
    const z: ZoomSpan = {
      ...newZoom("k", 0, 4),
      x: 0.4,
      size: 0.8,
      inMs: 0,
      outMs: 0,
      pan: { x: 0.65, y: 0.5, size: 0.5 },
    };
    const tr = zoomTransform([z], 1);
    // Başta 1,25×, sonda 2× ve görüntü sola kaymış (bölge sağda).
    expect(propAt(tr, "scale", 0.05)).toBeCloseTo(1.25, 1);
    expect(propAt(tr, "scale", 3.9)).toBeGreaterThan(1.9);
    expect(propAt(tr, "x", 3.9)).toBeLessThan(0);
    expect(propAt(tr, "x", 0.05)).toBeGreaterThan(0);
    // Ortada ikisinin arasında.
    const mid = propAt(tr, "scale", 2);
    expect(mid).toBeGreaterThan(1.3);
    expect(mid).toBeLessThan(1.95);
    // Aralık dışında olduğu gibi.
    expect(propAt(tr, "scale", 4.5)).toBe(1);
  });

  it("bitiş bölgesi sınırlanır, kayıttan geri okunur, varsayılanı görüntünün içinde", () => {
    const z = clampZoom({ ...newZoom("a", 0, 2), pan: { x: 2, y: -1, size: 0.1 } });
    expect(z.pan).toEqual({ x: 1 - 1 / 6, y: 1 / 6, size: 1 / 3 });
    expect(
      parseZooms([{ ...newZoom("a", 0, 2), pan: { x: 0.3, y: 0.4, size: 0.5 } }])![0].pan,
    ).toEqual({
      x: 0.3,
      y: 0.4,
      size: 0.5,
    });
    const p = defaultPan({ x: 0.9, y: 0.5, size: 0.6 });
    expect(p.x - p.size / 2).toBeGreaterThanOrEqual(0);
    expect(p.x + p.size / 2).toBeLessThanOrEqual(1);
  });
});
