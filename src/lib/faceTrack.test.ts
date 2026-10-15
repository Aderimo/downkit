import { describe, expect, it } from "vitest";
import {
  buildTrack,
  cropAxis,
  faceCenters,
  fillAndMedian,
  outputTrack,
  parseFrameTrack,
  simplify,
  trackAt,
  type FaceSample,
} from "./faceTrack";
import type { ExportPiece, Segment } from "./sequence";

const W = 16 / 9;
const V = 9 / 16;
/** Yüz kutusu: merkez x, genişlik 0.1. */
const face = (cx: number, size = 0.1): [number, number, number, number] => [
  cx - size / 2,
  0.3,
  size,
  size * 1.6,
];

describe("yüz takibi", () => {
  it("yataydan dikeye: kırpma payı 9/16 ÷ 16/9", () => {
    const a = cropAxis(W, V);
    expect(a.horizontal).toBe(true);
    expect(a.share).toBeCloseTo(0.3164, 3);
  });

  it("en büyük yüz seçilir; önceki yüze yakın, yeterince büyük olan tercih edilir", () => {
    const samples: FaceSample[] = [
      { t: 0, faces: [face(0.3, 0.12), face(0.8, 0.1)] },
      { t: 0.5, faces: [face(0.8, 0.13), face(0.31, 0.12)] },
      { t: 1, faces: [] },
    ];
    expect(faceCenters(samples, true)).toEqual([0.3, 0.31, null]);
  });

  it("boşluklar dolar, tek karelik sıçrama medyanla silinir", () => {
    expect(fillAndMedian([null, 0.5, 0.5, 0.9, 0.5, 0.5, null])).toEqual([
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    ]);
    expect(fillAndMedian([null, null])).toBeNull();
  });

  it("yüz ölü bölgede kaldıkça kadraj durur; uzaklaşınca sınırlı hızla kayar", () => {
    // 0–10 sn yüz 0.5'te, sonra 0.8'e geçer (2 kare/sn).
    const samples: FaceSample[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 2;
      const cx = t < 10 ? 0.5 + (i % 2 ? 0.01 : -0.01) : 0.8;
      samples.push({ t, faces: [face(cx)] });
    }
    const result = buildTrack(samples, W, V)!;
    expect(result.coverage).toBe(1);
    const at = (t: number) => trackAt(result.track, t);
    // İlk kare 0.49: (0.49 − 0.158) / 0.684 ≈ 0.485; yüz ±0.01 oynasa da kadraj durur.
    expect(at(0)).toBeCloseTo(0.485, 2);
    expect(at(5)).toBe(at(0));
    expect(at(9.5)).toBe(at(0));
    // Hedef: (0.8 − 0.158) / 0.684 ≈ 0.94; hız 0.6/sn → yaklaşık 0.75 sn'de varır.
    expect(at(10.25)).toBeLessThan(0.9);
    expect(at(12)).toBeCloseTo(0.939, 2);
    // Sadeleşmiş iz az noktalı.
    expect(result.track.length).toBeLessThan(8);
  });

  it("dikey kaynakta ya da hiç yüz yoksa iz yok", () => {
    expect(buildTrack([{ t: 0, faces: [face(0.5)] }], V, V)).toBeNull();
    expect(
      buildTrack(
        [
          { t: 0, faces: [] },
          { t: 1, faces: [] },
        ],
        W,
        V,
      ),
    ).toBeNull();
  });

  it("sadeleştirme düz çizgideki noktaları atar", () => {
    expect(
      simplify(
        [
          [0, 0],
          [1, 0.5],
          [2, 1],
          [3, 1],
        ],
        0.01,
      ),
    ).toEqual([
      [0, 0],
      [2, 1],
      [3, 1],
    ]);
  });

  it("çıktı izi: kaynak saniyesi çıktıya çevrilir, hız ve kesimler hesaba katılır", () => {
    const seg = (srcStart: number, srcEnd: number, speed: number, sourceId = "s1"): Segment => ({
      clipId: "c",
      sourceId,
      tStart: 0,
      tEnd: 0,
      srcStart,
      srcEnd,
      speed,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    });
    const pieces: ExportPiece[] = [
      { kind: "clip", tStart: 0, tEnd: 10, segment: seg(0, 10, 1) },
      { kind: "gap", tStart: 10, tEnd: 12 },
      { kind: "clip", tStart: 12, tEnd: 17, segment: seg(20, 30, 2) },
      { kind: "clip", tStart: 17, tEnd: 20, segment: seg(0, 3, 1, "s2") },
    ];
    const track: [number, number][] = [
      [0, 0.2],
      [10, 0.4],
      [20, 0.6],
      [30, 1],
    ];
    const out = outputTrack(
      pieces,
      { "a.mp4": track },
      (id) => (id === "s2" ? undefined : "a.mp4"),
      0.5,
    );
    expect(trackAt(out, 5)).toBeCloseTo(0.3);
    // Boşlukta önceki değer.
    expect(trackAt(out, 11)).toBeCloseTo(0.4);
    // İkinci parça 2x hızlı: çıktı 14.5 → kaynak 25 → 0.8.
    expect(trackAt(out, 14.5)).toBeCloseTo(0.8);
    // İzi olmayan kaynak: sabit 0.5.
    expect(trackAt(out, 18.5)).toBeCloseTo(0.5);
  });

  it("kayıttan gelen iz doğrulanır", () => {
    expect(
      parseFrameTrack({
        "a.mp4": [
          [0, 0.5],
          [1, 2],
          ["x", 1],
        ],
      }),
    ).toEqual({
      "a.mp4": [
        [0, 0.5],
        [1, 1],
      ],
    });
    expect(parseFrameTrack({ "a.mp4": [] })).toBeNull();
    expect(parseFrameTrack([1])).toBeNull();
  });
});
