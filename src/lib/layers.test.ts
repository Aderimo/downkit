import { describe, expect, it } from "vitest";
import {
  newMusic,
  parseImages,
  parseMusic,
  toImageOverlays,
  toMusicTracks,
  newBlur,
  parseBlurs,
  toBlurRegions,
  blurPosAt,
  setBlurKey,
} from "./layers";

describe("müzik izi", () => {
  it("videoya sığdırılır, sona yumuşak kararma eklenir", () => {
    const m = newMusic("m1", "C:/a/şarkı.mp3", 180, 0, 30);
    expect(m.length).toBe(30);
    expect(m.fadeOut).toBe(2);
    expect(m.name).toBe("şarkı");
  });

  it("zaman çizelgesindeki boşlukta bölünür; açılma başta, kararma sonda kalır", () => {
    const m = { ...newMusic("m1", "a.mp3", 60, 2, null), length: 10, fadeIn: 1, fadeOut: 1 };
    // Parçalar: 0–5 ve 8–20 (aradaki 5–8 zaman çizelgesinde var ama ayrı dosya değil).
    const tracks = toMusicTracks(
      [m],
      [
        { tStart: 0, tEnd: 5 },
        { tStart: 8, tEnd: 20 },
      ],
    );
    expect(tracks).toEqual([
      { path: "a.mp3", start: 2, srcStart: 0, length: 3, volume: 0.6, fadeIn: 1, fadeOut: 0 },
      { path: "a.mp3", start: 5, srcStart: 6, length: 4, volume: 0.6, fadeIn: 0, fadeOut: 1 },
    ]);
  });
});

describe("resim katmanı", () => {
  it("çıktıda görünmeyen resim atlanır", () => {
    const [img] = parseImages([{ id: "i1", path: "logo.png", start: 30, end: 40 }]);
    expect(toImageOverlays([img], [{ tStart: 0, tEnd: 10 }])).toEqual([]);
    expect(toImageOverlays([img], [{ tStart: 25, tEnd: 35 }])[0].ranges).toEqual([[5, 10]]);
  });

  it("bozuk kayıtlar atlanır, değerler sınıra çekilir", () => {
    expect(parseImages([{ path: 3 }, null, { id: "a", path: "x.png", size: 9 }])[0].size).toBe(1);
    const [m] = parseMusic([
      { id: "m", path: "a.mp3", sourceDuration: 20, srcStart: 15, length: 50 },
    ]);
    expect(m.length).toBe(5);
  });
});

describe("gizleme bölgeleri", () => {
  it("kayıttan okunur, kaynağın içine çekilir; çıktı zamanına çevrilir", () => {
    const [b] = parseBlurs([{ id: "b1", start: 2, end: 1, x: 0.9, y: 0, w: 0.3, h: 0.2 }]);
    expect(b.x).toBeCloseTo(0.7);
    expect(b.end).toBeCloseTo(2.2);
    expect(parseBlurs([{ start: 1 }])).toEqual([]);
    const regions = toBlurRegions(
      [{ ...newBlur("b2", 4, 9), pixel: true }],
      [
        { tStart: 0, tEnd: 5 },
        { tStart: 8, tEnd: 12 },
      ],
    );
    expect(regions).toHaveLength(1);
    // Boşluk atlanınca iki parça uç uca gelir: tek aralık olur.
    expect(regions[0].ranges).toEqual([[4, 6]]);
    expect(regions[0].pixel).toBe(true);
  });
});

describe("hareketli gizleme", () => {
  const box = { ...newBlur("b1", 10, 20), x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  it("anahtarlar arasında doğrusal kayar, uçlarda durur", () => {
    const keys = setBlurKey({ ...box, keys: setBlurKey(box, 12, 0, 0.5) }, 16, 0.4, 0.1);
    const moving = { ...box, keys };
    expect(blurPosAt(box, 15)).toEqual({ x: 0.1, y: 0.1 });
    expect(blurPosAt(moving, 11)).toEqual({ x: 0, y: 0.5 });
    expect(blurPosAt(moving, 14).x).toBeCloseTo(0.2);
    expect(blurPosAt(moving, 14).y).toBeCloseTo(0.3);
    expect(blurPosAt(moving, 19)).toEqual({ x: 0.4, y: 0.1 });
    // Aynı ana yeniden konum koymak öncekinin yerine geçer.
    expect(setBlurKey(moving, 12.02, 0.3, 0.3)).toHaveLength(2);
  });

  it("kayıttan okunur ve çıktı saniyesine çevrilir (boşluk atlanır)", () => {
    const [b] = parseBlurs([
      { ...box, keys: [{ t: 6, x: 0.9, y: 0.2 }, { t: 1, x: 0, y: 0 }, "x"] },
    ]);
    expect(b.keys).toEqual([
      { t: 1, x: 0, y: 0 },
      { t: 6, x: 0.8, y: 0.2 },
    ]);
    const [r] = toBlurRegions(
      [b],
      [
        { tStart: 0, tEnd: 12 },
        { tStart: 14, tEnd: 30 },
      ],
    );
    // 11 → 11; 16 → 12 + 2 = 14.
    expect(r.keys).toEqual([
      [11, 0, 0],
      [14, 0.8, 0.2],
    ]);
    expect(toBlurRegions([box], [{ tStart: 0, tEnd: 30 }])[0].keys).toBeUndefined();
  });
});
