import { describe, expect, it } from "vitest";
import { arrowHead, nextStep, normalizeRect, strokeWidth, wrapLines, type Shape } from "./annotate";

describe("çizim yardımcıları", () => {
  it("ok ucu çizgi yönünde, uca simetrik", () => {
    // Sağa giden yatay ok: kanatlar ucun solunda, biri üstte biri altta.
    const [ax, ay, bx, by] = arrowHead(0, 0, 100, 0, 20);
    expect(ax).toBeLessThan(100);
    expect(bx).toBeCloseTo(ax);
    expect(ay).toBeCloseTo(-by);
    expect(Math.hypot(100 - ax, ay)).toBeCloseTo(20);
  });

  it("ters sürüklenen dikdörtgen normalleşir", () => {
    expect(normalizeRect(50, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 40, h: 30 });
  });

  it("numaralı adım en büyüğün bir fazlası", () => {
    const shapes: Shape[] = [
      { kind: "step", x: 0, y: 0, n: 1, color: "#fff", size: 10 },
      { kind: "step", x: 0, y: 0, n: 3, color: "#fff", size: 10 },
      { kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, color: "#fff", width: 2 },
    ];
    expect(nextStep(shapes)).toBe(4);
    expect(nextStep([])).toBe(1);
  });

  it("kalınlık görüntü boyuna göre ölçeklenir", () => {
    expect(strokeWidth(1, 3840, 2160)).toBeGreaterThan(strokeWidth(1, 800, 600));
    expect(strokeWidth(3, 800, 600)).toBeGreaterThan(strokeWidth(1, 800, 600));
  });

  it("metin genişliğe göre sözcük sınırından sarılır", () => {
    // Her karakter 10 birim.
    const lines = wrapLines("bir iki üç dört", 70, (s) => s.length * 10);
    expect(lines).toEqual(["bir iki", "üç dört"]);
    expect(wrapLines("a\nb", 100, (s) => s.length)).toEqual(["a", "b"]);
  });
});
