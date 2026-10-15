import { describe, expect, it } from "vitest";
import { flatten, handleSourceTime, xfadeAt, type SeqClip } from "./sequence";
import { effectiveSeconds, parseXfade, XFADE_KINDS, xfadeFrame } from "./xfade";

const clip = (
  id: string,
  start: number,
  srcStart: number,
  srcEnd: number,
  extra = {},
): SeqClip => ({
  id,
  track: 0,
  start,
  srcStart,
  srcEnd,
  speed: 1,
  name: "",
  ...extra,
});

describe("klipler arası geçiş", () => {
  it("bitişik iki klibin kesimine oturur, kesimdeki kararmalar kapanır", () => {
    const segments = flatten([
      clip("a", 0, 10, 20, { xfade: { kind: "slideleft", duration: 1 }, fadeOut: 2 }),
      clip("b", 10, 40, 45, { fadeIn: 1, fadeOut: 1 }),
    ]);
    expect(segments[0].xfadeOut).toEqual({ kind: "slideleft", duration: 1 });
    expect(segments[0].fadeOut).toBe(0);
    expect(segments[1].fadeIn).toBe(0);
    // Kesimden uzak kararma yerinde kalır.
    expect(segments[1].fadeOut).toBe(1);
  });

  it("araya boşluk girince ya da kısa klipte süre sınırlanır", () => {
    const apart = flatten([
      clip("a", 0, 0, 5, { xfade: { kind: "fade", duration: 1 } }),
      clip("b", 6, 0, 5),
    ]);
    expect(apart[0].xfadeOut).toBeUndefined();
    const short = flatten([
      clip("a", 0, 0, 5, { xfade: { kind: "fade", duration: 2 } }),
      clip("b", 5, 0, 0.6),
    ]);
    expect(short[0].xfadeOut?.duration).toBeCloseTo(0.6);
    expect(effectiveSeconds({ kind: "fade", duration: 9 }, 10, 10)).toBe(3);
  });

  it("geçiş kesimin iki yanına yarı yarıya yayılır", () => {
    const segments = flatten([
      clip("a", 0, 10, 20, { xfade: { kind: "fade", duration: 2 } }),
      clip("b", 10, 40, 45),
    ]);
    expect(xfadeAt(segments, 8.9)).toBeNull();
    const mid = xfadeAt(segments, 10);
    expect(mid?.progress).toBeCloseTo(0.5);
    expect(xfadeAt(segments, 9)?.progress).toBeCloseTo(0);
    expect(xfadeAt(segments, 11)).toBeNull();
    // Kesimden sonra çıkan klip kaynağın devamından gelir; kesimden önce giren
    // klip kendi başlangıcından öncesinden.
    expect(handleSourceTime(segments[0], 10.5, 100)).toBeCloseTo(20.5);
    expect(handleSourceTime(segments[1], 9.5, 100)).toBeCloseTo(39.5);
    expect(handleSourceTime(segments[1], 9.5, 100)).toBeGreaterThan(0);
  });

  it("her geçişin başı eski, sonu yeni klip", () => {
    for (const kind of XFADE_KINDS) {
      const start = xfadeFrame(kind, 0);
      const end = xfadeFrame(kind, 1);
      // Başta yeni klip görünmez (saydam, kırpılmış ya da dışarıda) ya da altta.
      const hiddenIn =
        start.in.opacity === 0 ||
        !start.in.top ||
        /inset\(0 0 0 100%\)|inset\(0 100% 0 0\)|inset\(100%|inset\(0 0 100%|inset\(50%|inset\(0 50%\)|circle\(0%|translate|polygon\(100% 100%|transparent|0deg/.test(
          `${start.in.clipPath ?? ""} ${start.in.transform ?? ""} ${start.in.mask ?? ""}`,
        );
      expect(hiddenIn, kind).toBe(true);
      expect(end.veil?.opacity ?? 0, kind).toBeLessThan(0.01);
    }
  });

  it("kayıttan gelen geçiş doğrulanır", () => {
    expect(parseXfade({ kind: "wipeleft", duration: 0.8 })).toEqual({
      kind: "wipeleft",
      duration: 0.8,
    });
    expect(parseXfade({ kind: "bogus", duration: 1 })).toBeUndefined();
    expect(parseXfade({ kind: "fade", duration: "x" })).toBeUndefined();
    expect(parseXfade({ kind: "fade", duration: 99 })?.duration).toBe(3);
  });
});

describe("montaj", () => {
  it("ana izde uç uca gelen kliplerin arasına çapraz geçiş konur", async () => {
    const { withMontageXfades } = await import("./editorActions");
    const out = withMontageXfades([
      clip("a", 0, 0, 5),
      clip("b", 5, 0, 5),
      clip("c", 10, 0, 5),
      { ...clip("u", 2, 0, 1), track: 1 },
    ]);
    expect(out.map((c) => c.xfade?.kind ?? null)).toEqual(["fade", "fade", null, null]);
  });
});
