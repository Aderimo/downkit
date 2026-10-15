import { describe, expect, it } from "vitest";
import {
  autoGrade,
  clippedRatio,
  cubeGrayAxis,
  gradeTables,
  isDefaultGrade,
  levelPoints,
  neutralizeWheel,
  normalizeGrade,
  parseCurve,
  rgbWheel,
  splineAt,
  tableValues,
  wheelRgb,
} from "./colorGrade";
import { isDefaultLook, normalizeLook } from "./clipLook";

describe("renk düzeltme", () => {
  it("değişiklik yoksa düzeltme yok; değerler sınırlanır", () => {
    expect(normalizeGrade({})).toBeUndefined();
    expect(normalizeGrade({ exposure: 5, shadows: { x: 3, y: 4 } })).toMatchObject({
      exposure: 1,
      shadows: { x: 0.6, y: 0.8 },
    });
    expect(normalizeGrade({ lut: { path: "C:/a.png" } })).toBeUndefined();
    expect(normalizeGrade({ lut: { path: "C:/a.cube", name: "a" } })?.lut).toEqual({
      path: "C:/a.cube",
      name: "a",
    });
    expect(isDefaultGrade(undefined)).toBe(true);
    expect(isDefaultLook({ grade: { exposure: 0.3 } as never })).toBe(false);
    expect(normalizeLook({ grade: { tint: 0 } as never })).not.toHaveProperty("grade");
  });

  it("düz eğri saklanmaz, noktalar sıralanır", () => {
    expect(
      parseCurve([
        [0, 0],
        [1, 1],
      ]),
    ).toBeUndefined();
    expect(
      parseCurve([
        [1, 1],
        [0, 0],
        [0.5, 0.7],
      ]),
    ).toEqual([
      [0, 0],
      [0.5, 0.7],
      [1, 1],
    ]);
  });

  it("doğal kübik eğri noktalardan geçer, uçlarda doğrusal", () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.5, 0.7],
      [1, 1],
    ];
    expect(splineAt(pts, 0.5)).toBeCloseTo(0.7);
    expect(splineAt(pts, 0)).toBe(0);
    expect(splineAt(pts, 1)).toBe(1);
    const q = splineAt(pts, 0.25);
    expect(q).toBeGreaterThan(0.25);
    expect(q).toBeLessThan(0.7);
  });

  it("tekerlek ↔ RGB kaydırması gidip gelir, toplamı sıfır", () => {
    const w = { x: 0.3, y: -0.4 };
    const rgb = wheelRgb(w);
    expect(rgb[0] + rgb[1] + rgb[2]).toBeCloseTo(0);
    const back = rgbWheel(rgb);
    expect(back.x).toBeCloseTo(0.3);
    expect(back.y).toBeCloseTo(-0.4);
  });

  it("seviyeler: eksi lift koyuları siyaha, artı gain parlakları beyaza çeker", () => {
    expect(levelPoints({ lift: -1, gamma: 0, gain: 1 })).toEqual([
      [0.15, 0],
      [0.5, 0.5],
      [0.85, 1],
    ]);
    expect(levelPoints({ lift: 1, gamma: 0, gain: -1 })).toEqual([
      [0, 0.15],
      [0.5, 0.5],
      [1, 0.85],
    ]);
  });

  it("tablolar: pozlama aydınlatır, orta ton tekerleği kırmızıya kaydırır", () => {
    const [r0] = gradeTables(undefined);
    expect(r0[128]).toBeCloseTo(128 / 255, 3);
    const [r, g, b] = gradeTables(normalizeGrade({ exposure: 0.1, midtones: { x: 1, y: 0 } }));
    // FFmpeg colorbalance'ta orta tonlar koyu-orta bölgede etkili (gri ~0,1–0,4).
    expect(r[64]).toBeGreaterThan(64 / 255);
    expect(r[64]).toBeGreaterThan(g[64]!);
    expect(b[64]).toBeLessThan(r[64]!);
    expect(tableValues(r).split(" ")).toHaveLength(33);
  });

  it(".cube dosyasının gri ekseni okunur, bozuk dosya null", () => {
    const rows: string[] = [];
    for (let b = 0; b < 2; b++)
      for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g * 0.5} ${b}`);
    const text = `TITLE "t"\nLUT_3D_SIZE 2\n${rows.join("\n")}\n`;
    expect(cubeGrayAxis(text)).toEqual([
      [0, 0, 0],
      [1, 0.5, 1],
    ]);
    expect(cubeGrayAxis("LUT_3D_SIZE 2\n0 0 0\n")).toBeNull();
  });

  it("otomatik düzeltme: mavi kaymalı karanlık kare ısınır ve aydınlanır", () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) px.set([40, 50, 90, 255], i * 4);
    const g = autoGrade(px)!;
    expect(g.exposure).toBeGreaterThan(0);
    // Mavi fazla → orta ton tekerleği maviden uzağa (kırmızı/sarıya) döner.
    const [r, , b] = wheelRgb(g.midtones);
    expect(r).toBeGreaterThan(b);
  });

  it("damlalık: gri pikselde değişiklik yok, renkli pikselde ters yöne", () => {
    expect(neutralizeWheel([128, 128, 128])).toEqual({ x: 0, y: 0 });
    const w = neutralizeWheel([200, 128, 128]);
    expect(w.x).toBeLessThan(0);
  });

  it("patlayan piksel oranı", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255]);
    expect(clippedRatio(px)).toBe(0.5);
  });
});
