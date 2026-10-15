import { describe, expect, it } from "vitest";
import {
  adjacentKey,
  deleteKeysAt,
  easeValue,
  exportTransform,
  isDefaultTransform,
  keyTimes,
  parseTransform,
  propAt,
  seeThrough,
  setEaseAt,
  setProp,
  toggleKey,
  transformCss,
  DEFAULT_TRANSFORM,
  type ClipTransform,
} from "./clipTransform";
import { flatten, layersAt, overlaySegments, splitAt, type SeqClip } from "./sequence";

const base = (patch: Partial<ClipTransform> = {}): ClipTransform => ({
  ...DEFAULT_TRANSFORM,
  ...patch,
});

describe("easing", () => {
  it("stays within 0–1 and hits the ends", () => {
    for (const e of ["linear", "ease", "easeIn", "easeOut"] as const) {
      expect(easeValue(e, 0)).toBe(0);
      expect(easeValue(e, 1)).toBe(1);
      expect(easeValue(e, 0.5)).toBeGreaterThan(0);
    }
    expect(easeValue("hold", 0.9)).toBe(0);
    expect(easeValue("ease", 0.25)).toBeCloseTo(0.15625);
  });
});

describe("keyframes", () => {
  it("interpolates by source time and holds before/after", () => {
    let tr = setProp(undefined, "scale", 1, 10);
    expect(tr.scale).toBe(1);
    tr = toggleKey(tr, "scale", 10);
    tr = setProp(tr, "scale", 2, 12); // kare varken değer yeni kare olur
    expect(tr.keys?.scale).toEqual([
      { t: 10, v: 1 },
      { t: 12, v: 2 },
    ]);
    expect(propAt(tr, "scale", 9)).toBe(1);
    expect(propAt(tr, "scale", 11)).toBe(1.5);
    expect(propAt(tr, "scale", 13)).toBe(2);
    tr = setEaseAt(tr, 10, "ease");
    expect(propAt(tr, "scale", 10.5)).toBeCloseTo(1 + 0.15625);
    tr = setEaseAt(tr, 10, "hold");
    expect(propAt(tr, "scale", 11.9)).toBe(1);
  });

  it("removing the last key keeps the value (no jump)", () => {
    let tr = toggleKey(base({ rotation: 0 }), "rotation", 5);
    tr = setProp(tr, "rotation", 30, 5);
    tr = toggleKey(tr, "rotation", 5);
    expect(tr.keys).toBeUndefined();
    expect(tr.rotation).toBe(30);
  });

  it("deletes and navigates keys across properties", () => {
    let tr = toggleKey(base(), "x", 1);
    tr = toggleKey(tr, "opacity", 1);
    tr = toggleKey(tr, "x", 3);
    expect(keyTimes(tr)).toEqual([1, 3]);
    expect(adjacentKey(tr, 1, 1)).toBe(3);
    expect(adjacentKey(tr, 1, -1)).toBeNull();
    tr = deleteKeysAt(tr, 1);
    expect(keyTimes(tr)).toEqual([3]);
  });

  it("clamps values and reports default transforms", () => {
    expect(setProp(undefined, "scale", 99, 0).scale).toBe(3);
    expect(setProp(undefined, "opacity", -1, 0).opacity).toBe(0);
    expect(isDefaultTransform(undefined)).toBe(true);
    expect(isDefaultTransform(toggleKey(base(), "x", 1))).toBe(true);
    expect(isDefaultTransform(base({ x: 0.1 }))).toBe(false);
    expect(transformCss(DEFAULT_TRANSFORM)).toBeNull();
    expect(
      transformCss({ ...DEFAULT_TRANSFORM, x: 0.25, rotation: 10, scale: 0.5, opacity: 0.8 }),
    ).toEqual({ transform: "translate(25%, 0%) rotate(10deg) scale(0.5)", opacity: 0.8 });
  });
});

describe("see-through", () => {
  it("detects transforms that reveal the layer below", () => {
    expect(seeThrough(base({ scale: 1.5 }))).toBe(false);
    expect(seeThrough(base({ scale: 1.5, x: 0.2 }))).toBe(false);
    expect(seeThrough(base({ scale: 1.5, x: 0.3 }))).toBe(true);
    expect(seeThrough(base({ scale: 0.5 }))).toBe(true);
    expect(seeThrough(base({ opacity: 0.9 }))).toBe(true);
    expect(seeThrough(base({ rotation: 5 }))).toBe(true);
    let keyed = toggleKey(base(), "scale", 0);
    keyed = setProp(keyed, "scale", 0.4, 2);
    expect(seeThrough(keyed)).toBe(true);
  });
});

describe("export", () => {
  it("converts keys to piece seconds, keeping the neighbours that shape the curve", () => {
    let tr = toggleKey(base(), "scale", 2);
    tr = setProp(tr, "scale", 2, 6);
    tr = setProp(tr, "scale", 3, 20);
    const req = exportTransform(tr, { srcStart: 4, srcEnd: 8, speed: 2 })!;
    // 2 sn önce (çıktıda -1), 6 sn içeride (1), 20 sn sonra (8).
    expect(req.keys.scale).toEqual([
      { t: -1, v: 1 },
      { t: 1, v: 2 },
      { t: 8, v: 3 },
    ]);
    expect(exportTransform(base(), { srcStart: 0, srcEnd: 1, speed: 1 })).toBeNull();
  });

  it("parses saved transforms and drops broken keys", () => {
    expect(parseTransform(null)).toBeUndefined();
    expect(parseTransform({ x: 0, scale: 1 })).toBeUndefined();
    expect(
      parseTransform({
        scale: 9,
        keys: { x: [{ t: 2, v: 0.5, ease: "ease" }, { t: "bad" }, { t: 1, v: 0, ease: "nope" }] },
      }),
    ).toEqual({
      ...DEFAULT_TRANSFORM,
      scale: 3,
      keys: {
        x: [
          { t: 1, v: 0 },
          { t: 2, v: 0.5, ease: "ease" },
        ],
      },
    });
  });
});

const clip = (
  id: string,
  track: number,
  start: number,
  length: number,
  patch: Partial<SeqClip> = {},
) =>
  ({
    id,
    track,
    start,
    srcStart: 100 + start,
    srcEnd: 100 + start + length,
    speed: 1,
    name: "",
    ...patch,
  }) as SeqClip;

describe("layers", () => {
  const pip = clip("pip", 1, 2, 4, { transform: base({ scale: 0.4, x: 0.3 }), fadeIn: 0.5 });
  const cover = clip("cover", 1, 8, 2);
  const main = clip("main", 0, 0, 7);

  it("a see-through upper clip overlays the clip below, an opaque one covers it", () => {
    expect(layersAt([main, pip], 3)).toEqual({ base: main, overlays: [pip] });
    expect(layersAt([main, pip], 1)).toEqual({ base: main, overlays: [] });
    // Altında görüntü yok: kendisi ana görüntü (siyah zemin üstünde).
    expect(layersAt([main, pip], 6.5).base).toBe(main);
    expect(layersAt([pip], 3)).toEqual({ base: pip, overlays: [] });
    expect(layersAt([main, cover], 8.5).base).toBe(cover);
  });

  it("flatten keeps the lower clip under an overlay and lists overlay segments", () => {
    const clips = [main, pip, cover];
    const segments = flatten(clips);
    expect(segments.map((s) => [s.clipId, s.tStart, s.tEnd])).toEqual([
      ["main", 0, 7],
      ["cover", 8, 10],
    ]);
    const overlays = overlaySegments(clips);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({
      clipId: "pip",
      track: 1,
      tStart: 2,
      tEnd: 6,
      srcStart: 102,
      srcEnd: 106,
      fadeIn: 0.5,
    });
    // Gizli izdeki bindirme yok sayılır.
    expect(overlaySegments(clips, { 1: { hidden: true } })).toEqual([]);
  });

  it("an overlay past the end of the clip below becomes the main picture there", () => {
    const long = clip("pip", 1, 5, 4, { transform: base({ scale: 0.5 }) });
    const segments = flatten([main, long]);
    expect(segments.map((s) => [s.clipId, s.tStart, s.tEnd])).toEqual([
      ["main", 0, 7],
      ["pip", 7, 9],
    ]);
    expect(overlaySegments([main, long]).map((s) => [s.tStart, s.tEnd])).toEqual([[5, 7]]);
  });

  it("splitting keeps keyframes on the same source frames", () => {
    let tr = toggleKey(base(), "scale", 101);
    tr = setProp(tr, "scale", 2, 105);
    const keyed = clip("k", 0, 0, 6, { transform: tr });
    const parts = splitAt([keyed], 3, ["k"], () => "k2");
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(p.transform).toBe(tr);
    // İkinci parçanın başı kaynak 103: değer aynı.
    expect(propAt(parts[1].transform, "scale", parts[1].srcStart)).toBe(1.5);
  });
});
