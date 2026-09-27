import { describe, expect, it } from "vitest";
import {
  moveText,
  newText,
  outputRanges,
  textsAt,
  toOverlays,
  trimText,
  updateText,
} from "./textItems";
import type { Segment } from "./sequence";

const seg = (tStart: number, tEnd: number): Segment => ({
  clipId: "a",
  tStart,
  tEnd,
  srcStart: tStart,
  srcEnd: tEnd,
  speed: 1,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
});

describe("yazılar", () => {
  it("taşınınca süresi korunur, kısaltma en kısa sınırda durur", () => {
    const [t] = moveText([newText("t", 2, "Merhaba")], "t", 10);
    expect([t.start, t.end]).toEqual([10, 13]);
    const [trimmed] = trimText([t], "t", "end", 5);
    expect(trimmed.end).toBeCloseTo(10.3);
    const [early] = trimText([t], "t", "start", -4);
    expect(early.start).toBe(0);
  });

  it("konum ve boyut sınırlanır", () => {
    const [t] = updateText([newText("t", 0, "x")], "t", { x: 2, y: -1, size: 5 });
    expect([t.x, t.y, t.size]).toEqual([1, 0, 0.2]);
  });

  it("boşluklar atlandığı için çıktı zamanı kayar", () => {
    // Parçalar: 0–10 ve 20–30 (arada 10 sn boşluk) → çıktı 0–20.
    const segments = [seg(0, 10), seg(20, 30)];
    expect(outputRanges(segments, 8, 22)).toEqual([[8, 12]]);
    expect(outputRanges(segments, 12, 18)).toEqual([]);
    expect(outputRanges(segments, 25, 40)).toEqual([[15, 20]]);
  });

  it("siyah boşluk da çıktıda yer tuttuğu için boşluktaki yazı görünür", () => {
    const pieces = [
      { tStart: 0, tEnd: 10 },
      { tStart: 10, tEnd: 20 },
      { tStart: 20, tEnd: 30 },
    ];
    expect(outputRanges(pieces, 12, 18)).toEqual([[12, 18]]);
    expect(outputRanges(pieces, 8, 22)).toEqual([[8, 22]]);
  });

  it("görünen ve dışa aktarılan yazılar", () => {
    const texts = [newText("a", 0, "Başlık"), { ...newText("b", 12, "Boşlukta"), end: 15 }];
    expect(textsAt(texts, 1).map((t) => t.id)).toEqual(["a"]);
    const overlays = toOverlays(texts, [seg(0, 10), seg(20, 30)]);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ text: "Başlık", ranges: [[0, 3]] });
  });
});
