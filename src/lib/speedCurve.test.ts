import { describe, expect, it } from "vitest";
import { clipEnd, type SeqClip } from "./sequence";
import {
  applySpeedCurve,
  CURVE_PRESET_IDS,
  CURVE_PRESETS,
  curveDuration,
  curvePieces,
  normalizeCurve,
  speedAt,
} from "./speedCurve";

const clip = (over: Partial<SeqClip> = {}): SeqClip => ({
  id: "a",
  track: 0,
  start: 0,
  srcStart: 0,
  srcEnd: 10,
  speed: 1,
  name: "",
  ...over,
});

describe("hız eğrisi", () => {
  it("noktalar sıralanır, uçlar 0 ve 1'e sabitlenir, hız sınırlanır", () => {
    expect(
      normalizeCurve([
        { x: 0.5, v: 9 },
        { x: 0.2, v: 0.01 },
      ]),
    ).toEqual([
      { x: 0, v: 0.25 },
      { x: 0.2, v: 0.25 },
      { x: 0.5, v: 4 },
      { x: 1, v: 4 },
    ]);
    expect(normalizeCurve([])).toHaveLength(2);
  });

  it("noktalar arasında doğrusal", () => {
    const pts = [
      { x: 0, v: 1 },
      { x: 1, v: 3 },
    ];
    expect(speedAt(pts, 0.5)).toBeCloseTo(2);
    expect(speedAt(pts, 0)).toBe(1);
    expect(speedAt(pts, 1)).toBe(3);
  });

  it("aynı hızdaki komşu parçalar birleşir, aralık eksiksiz kaplanır", () => {
    const pieces = curvePieces(2, 12, [
      { x: 0, v: 1 },
      { x: 1, v: 1 },
    ]);
    expect(pieces).toEqual([{ srcStart: 2, srcEnd: 12, speed: 1 }]);
    const ramp = curvePieces(0, 10, CURVE_PRESETS.hero);
    expect(ramp[0]!.srcStart).toBe(0);
    expect(ramp[ramp.length - 1]!.srcEnd).toBe(10);
    for (let i = 1; i < ramp.length; i++)
      expect(ramp[i]!.srcStart).toBeCloseTo(ramp[i - 1]!.srcEnd);
  });

  it("çok kısa klip tek parça kalır", () => {
    expect(curvePieces(0, 0.1, CURVE_PRESETS.montage)).toHaveLength(1);
  });

  it("uygulanınca parçalar art arda dizilir, sonraki klip süre farkı kadar kayar", () => {
    let n = 0;
    const clips = [
      clip({ fadeIn: 0.5, fadeOut: 0.5 }),
      clip({ id: "b", start: 10, srcStart: 20, srcEnd: 25 }),
    ];
    const out = applySpeedCurve(clips, "a", CURVE_PRESETS.bullet, () => `n${(n += 1)}`);
    const pieces = out.filter((c) => c.id !== "b");
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]!.id).toBe("a");
    expect(pieces[0]!.fadeIn).toBe(0.5);
    expect(pieces[pieces.length - 1]!.fadeOut).toBe(0.5);
    for (let i = 1; i < pieces.length; i++)
      expect(pieces[i]!.start).toBeCloseTo(clipEnd(pieces[i - 1]!));
    const end = clipEnd(pieces[pieces.length - 1]!);
    expect(end).toBeCloseTo(curveDuration(10, CURVE_PRESETS.bullet));
    expect(out.find((c) => c.id === "b")!.start).toBeCloseTo(end);
  });

  it("her hazır eğri geçerli hızlar üretir", () => {
    for (const id of CURVE_PRESET_IDS) {
      for (const p of curvePieces(0, 8, CURVE_PRESETS[id])) {
        expect(p.speed).toBeGreaterThanOrEqual(0.25);
        expect(p.speed).toBeLessThanOrEqual(4);
      }
    }
  });
});
