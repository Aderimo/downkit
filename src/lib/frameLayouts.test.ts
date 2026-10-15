import { describe, expect, it } from "vitest";
import { currentLayout, layoutOptions } from "./frameLayouts";
import {
  defaultSplit,
  parseGradient,
  parseSplit,
  podcastFromFaces,
  slotAspects,
  withStyle,
} from "./splitLayout";
import type { ExportOptions } from "../store/editorStore";

const SRC = 16 / 9;
const base = {
  frame: "9:16",
  frameFit: false,
  frameBlur: false,
  frameGradient: null,
  framePosition: 0.5,
  frameSplit: false,
  split: null,
} as unknown as ExportOptions;

describe("düzen galerisi", () => {
  it("her kart seçeneklere çevrilir ve geri tanınır", () => {
    for (const id of [
      "crop",
      "fit",
      "blur",
      "gradient",
      "stackTop",
      "stackBottom",
      "duo",
      "circle",
      "pip",
    ] as const) {
      const next = { ...base, ...layoutOptions(id, base, SRC) } as ExportOptions;
      expect(currentLayout(next)).toBe(id);
    }
  });

  it("daire ve köşe kamerasında yuvalar kare / 4:3, oyun tam kare", () => {
    expect(slotAspects(0.35, 1080, 1920, "circle")).toEqual({ cam: 1, game: 1080 / 1920 });
    expect(slotAspects(0.35, 1080, 1920, "pip").cam).toBeCloseTo(4 / 3);
    expect(slotAspects(0.35, 1080, 1920, "duo").cam).toBeCloseTo(540 / 672);
    const circle = withStyle(defaultSplit(SRC, 1080, 1920), "circle", SRC, 1080, 1920);
    // Kaynakta kamera kutusu da kare piksel (w * 16/9 = h).
    expect(circle.cam.w * SRC).toBeCloseTo(circle.cam.h);
    expect(circle.spot).toEqual({ x: 0.5, y: 0.8, size: 0.42 });
    expect(circle.ring).toBe("#ffffff");
    const back = withStyle(circle, "stack", SRC, 1080, 1920);
    expect(back.style).toBeUndefined();
  });

  it("kayıttan düzen ve renk geçişi doğrulanır", () => {
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 };
    const p = parseSplit({
      cam: rect,
      game: rect,
      camShare: 0.4,
      style: "pip",
      spot: { x: 2, y: 0.5, size: 0.05 },
      ring: "#zzzzzz",
      cam2: { x: 1 },
    });
    expect(p).toMatchObject({ style: "pip", spot: { x: 1, y: 0.5, size: 0.2 } });
    expect(p?.ring).toBeUndefined();
    expect(p?.cam2).toBeUndefined();
    expect(parseSplit({ cam: rect, game: rect, style: "garip" })?.style).toBeUndefined();
    expect(parseGradient(["#000000", "#ffffff"])).toEqual(["#000000", "#ffffff"]);
    expect(parseGradient(["#000000"])).toBeNull();
    expect(parseGradient("x")).toBeNull();
  });

  it("podcast: iki kişi yüzlerine göre, soldaki üstte; yan yana değilse yerleştirilmez", () => {
    const base = withStyle(defaultSplit(SRC, 1080, 1920), "podcast", SRC, 1080, 1920);
    expect(base).toMatchObject({ style: "podcast", camShare: 0.5, camTop: true });
    const faces: [number, number, number, number][] = [
      [0.22, 0.3, 0.08, 0.14],
      [0.7, 0.28, 0.08, 0.15],
      [0.23, 0.31, 0.08, 0.14],
      [0.69, 0.29, 0.08, 0.15],
    ];
    const placed = podcastFromFaces(base, faces, SRC, 1080, 1920)!;
    const center = (r: { x: number; w: number }) => r.x + r.w / 2;
    expect(center(placed.cam)).toBeCloseTo(0.27, 2);
    expect(center(placed.game)).toBeCloseTo(0.74, 2);
    // Yuva oranı korunur (1080 × 960 → piksel oranı 1.125).
    expect((placed.cam.w * SRC) / placed.cam.h).toBeCloseTo(1.125, 2);
    expect(podcastFromFaces(base, [faces[0]], SRC, 1080, 1920)).toBeNull();
    expect(podcastFromFaces(base, [faces[0], faces[2]], SRC, 1080, 1920)).toBeNull();
  });
});
