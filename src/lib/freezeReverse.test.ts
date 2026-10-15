import { describe, expect, it } from "vitest";
import {
  clipEnd,
  clipSourceAt,
  flatten,
  insertFreeze,
  MAX_REVERSE_SECONDS,
  setReverse,
  sourceTimeAt,
  splitClip,
  trimEnd,
  trimStart,
  type SeqClip,
} from "./sequence";
import { exportTransform } from "./clipTransform";

const clip = (over: Partial<SeqClip> = {}): SeqClip => ({
  id: "a",
  track: 0,
  start: 0,
  srcStart: 10,
  srcEnd: 16,
  speed: 1,
  name: "",
  ...over,
});

describe("dondurulmuş kare", () => {
  it("klip bölünür, araya kare girer, sonrası kayar", () => {
    let n = 0;
    const clips = [clip(), clip({ id: "b", start: 6, srcStart: 30, srcEnd: 32 })];
    const out = insertFreeze(clips, "a", 2, 2, () => `n${(n += 1)}`);
    const frozen = out.find((c) => c.freezeAt !== undefined)!;
    expect(frozen).toMatchObject({ start: 2, freezeAt: 12, speed: 1 });
    expect(clipEnd(frozen)).toBe(4);
    expect(out.find((c) => c.id === "a")!.srcEnd).toBe(12);
    const tail = out.find((c) => c.start === 4 && c.freezeAt === undefined)!;
    expect(tail.srcStart).toBe(12);
    expect(out.find((c) => c.id === "b")!.start).toBe(8);
  });

  it("klibin kenarında bölmeden başa ya da sona eklenir", () => {
    const out = insertFreeze([clip()], "a", 0, 1, () => "f");
    const frozen = out.find((c) => c.id === "f")!;
    expect(frozen.start).toBe(0);
    expect(frozen.freezeAt).toBe(10);
    expect(out.find((c) => c.id === "a")!.start).toBe(1);
  });

  it("parçası kareyi gösterir, süresi kaynağa bağlı değil", () => {
    const frozen = clip({ freezeAt: 15.9, srcStart: 15.9, srcEnd: 17.9 });
    const [seg] = flatten([frozen]);
    expect(sourceTimeAt(seg!, 1.5)).toBe(15.9);
    expect(seg!.freezeAt).toBe(15.9);
    // Kaynak 16 sn olsa da 5 sn'ye uzatılabilir.
    const longer = trimEnd([frozen], "a", 5, 16)[0]!;
    expect(clipEnd(longer)).toBeCloseTo(5);
    expect(longer.freezeAt).toBe(15.9);
  });

  it("dönüşüm dondurulmuş karede o anki değerinde sabit", () => {
    const tr = exportTransform(
      {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        keys: {
          scale: [
            { t: 10, v: 1 },
            { t: 14, v: 2 },
          ],
        },
      },
      { srcStart: 12, srcEnd: 14, speed: 1, freezeAt: 12 },
    )!;
    expect(tr.scale).toBeCloseTo(1.5);
    expect(tr.keys).toEqual({});
  });
});

describe("ters oynatma", () => {
  it("parçası kaynağı sondan başa gösterir", () => {
    const [seg] = flatten([clip({ reverse: true })]);
    expect(seg!.srcStart).toBe(10);
    expect(seg!.srcEnd).toBe(16);
    expect(sourceTimeAt(seg!, 0)).toBe(16);
    expect(sourceTimeAt(seg!, 4)).toBe(12);
    expect(clipSourceAt(clip({ reverse: true }), 1)).toBe(15);
  });

  it("üst katmanın böldüğü parçalar aynalanır", () => {
    const top = clip({ id: "t", track: 1, start: 2, srcStart: 0, srcEnd: 1 });
    const segs = flatten([clip({ reverse: true }), top]).filter((s) => s.clipId === "a");
    expect(segs.map((s) => [s.tStart, s.srcStart, s.srcEnd])).toEqual([
      [0, 14, 16],
      [3, 10, 13],
    ]);
  });

  it("bölünce ilk parça kaynağın sonunu alır", () => {
    const out = splitClip([clip({ reverse: true })], "a", 2, "b");
    expect(out[0]).toMatchObject({ id: "a", srcStart: 14, srcEnd: 16 });
    expect(out[1]).toMatchObject({ id: "b", start: 2, srcStart: 10, srcEnd: 14 });
  });

  it("kenarlar ters yönde kırpılır", () => {
    const left = trimStart([clip({ reverse: true })], "a", 1)[0]!;
    expect(left).toMatchObject({ start: 1, srcStart: 10, srcEnd: 15 });
    const right = trimEnd([clip({ reverse: true })], "a", 4, 100)[0]!;
    expect(right).toMatchObject({ srcStart: 12, srcEnd: 16 });
    // Sağ kenar kaynağın başına kadar uzar.
    const long = trimEnd([clip({ reverse: true })], "a", 40, 100)[0]!;
    expect(long.srcStart).toBe(0);
  });

  it("uzun klipte açılmaz, dondurulmuş karede açılmaz", () => {
    const long = clip({ srcEnd: 10 + MAX_REVERSE_SECONDS + 1 });
    expect(setReverse([long], "a", true)[0]!.reverse).toBeUndefined();
    expect(setReverse([clip()], "a", true)[0]!.reverse).toBe(true);
    expect(setReverse([clip({ reverse: true })], "a", false)[0]).not.toHaveProperty("reverse");
    expect(setReverse([clip({ freezeAt: 11 })], "a", true)[0]!.reverse).toBeUndefined();
  });

  it("dönüşüm kareleri ters sırada, eğrileri aralıklarıyla taşınır", () => {
    const tr = exportTransform(
      {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        keys: {
          scale: [
            { t: 10, v: 1, ease: "ease" },
            { t: 12, v: 2 },
            { t: 16, v: 3 },
          ],
        },
      },
      { srcStart: 10, srcEnd: 16, speed: 1, reverse: true },
    )!;
    expect(tr.keys.scale).toEqual([
      { t: 0, v: 3 },
      { t: 4, v: 2, ease: "ease" },
      { t: 6, v: 1 },
    ]);
  });
});
