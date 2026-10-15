import { describe, expect, it } from "vitest";
import { followFace } from "./blurTrack";
import { resizeRect } from "./resizeRect";

describe("gizleme kutusu yüzü takip eder", () => {
  const box = { start: 10, end: 14, x: 0.6, y: 0.1, w: 0.2, h: 0.2 };

  it("kutuya en yakın yüzü izler, öbür yüze atlamaz", () => {
    const right = (x: number) => [x, 0.1, 0.1, 0.1] as const;
    const left = [0.05, 0.1, 0.1, 0.1] as const;
    const out = followFace(box, [
      { t: 9, faces: [left] },
      { t: 10, faces: [left, right(0.6)] },
      { t: 11, faces: [left, right(0.65)] },
      { t: 12, faces: [left] },
      { t: 13, faces: [left, right(0.7)] },
    ])!;
    expect(out.w).toBeCloseTo(0.15);
    // Sol yüz tek başına kaldığında (12. sn) uzakta olduğu için alınmaz.
    expect(out.keys.map((k) => k.t)).toEqual([0, 1, 3]);
    expect(out.keys.every((k) => k.x > 0.5)).toBe(true);
  });

  it("yüz yoksa null", () => {
    expect(followFace(box, [{ t: 11, faces: [] }])).toBeNull();
  });
});

describe("gizleme kutusunun tutamaçları", () => {
  const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  it("sol üst köşe sağ alt köşeyi yerinde tutar", () => {
    const n = resizeRect(r, "nw", -0.1, 0.1);
    expect(n.x).toBeCloseTo(0.1);
    expect(n.y).toBeCloseTo(0.3);
    expect(n.x + n.w).toBeCloseTo(0.6);
    expect(n.y + n.h).toBeCloseTo(0.6);
  });
  it("kenar yalnız kendi yönünde değişir, kareden taşmaz", () => {
    expect(resizeRect(r, "e", 0.9, 0.5)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.4 });
    expect(resizeRect(r, "s", 0, -1).h).toBeCloseTo(0.03);
  });
});
