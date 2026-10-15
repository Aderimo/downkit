import { describe, expect, it } from "vitest";
import { captionStyle, groupWords, placeChunks, usedRanges } from "./autoCaptions";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("otomatik altyazı", () => {
  it("satırlar noktalamada, duraksamada ve 5 kelimede biter", () => {
    const words = [
      w("Merhaba", 0, 0.4),
      w("arkadaşlar.", 0.45, 1),
      w("Bugün", 1.1, 1.4),
      w("çok", 1.45, 1.6),
      w("güzel", 1.65, 1.9),
      w("bir", 1.95, 2.0),
      w("oyun", 2.05, 2.3),
      w("var", 2.35, 2.5),
      w("sonra", 4, 4.3),
    ];
    const lines = groupWords(words, "line").map((c) => c.text);
    expect(lines).toEqual(["Merhaba arkadaşlar.", "Bugün çok güzel bir oyun", "var", "sonra"]);
    // Kısa boşluk kapanır: ilk satır ikincinin başına kadar sürer.
    expect(groupWords(words, "line")[0].end).toBe(1.1);
  });

  it("kelime kelimede her kelime ayrı, çok kısalar uzatılır", () => {
    const chunks = groupWords([w("Hey", 0, 0.1), w("bak", 2, 2.5)], "word");
    expect(chunks.map((c) => c.text)).toEqual(["Hey", "bak"]);
    expect(chunks[0].end).toBeCloseTo(0.35);
  });

  it("kullanılan bölümler birleşir; parçalar hızlandırılmış kliplere yerleşir", () => {
    const clips = [
      { start: 0, srcStart: 10, srcEnd: 20, speed: 1 },
      { start: 10, srcStart: 20.3, srcEnd: 30, speed: 2 },
      { sourceId: "s2", start: 15, srcStart: 0, srcEnd: 5, speed: 1 },
    ];
    expect(usedRanges(clips, "s1", "s1")).toEqual([{ start: 10, end: 30 }]);
    const placed = placeChunks(
      [
        { text: "a", start: 12, end: 13, words: [{ text: "a", start: 12, end: 13 }] },
        { text: "b", start: 22.3, end: 24.3, words: [{ text: "b", start: 22.3, end: 24.3 }] },
        { text: "dışarıda", start: 40, end: 41, words: [{ text: "dışarıda", start: 40, end: 41 }] },
      ],
      clips,
      "s1",
      "s1",
    );
    expect(placed).toEqual([
      { text: "a", start: 2, end: 3, words: [{ text: "a", start: 2, end: 3 }] },
      // 2× hızlı klipte kelime zamanları da yarıya iner.
      { text: "b", start: 11, end: 12, words: [{ text: "b", start: 11, end: 12 }] },
    ]);
  });

  it("başı kesilen klipte satırın kalan kelimeleri yazılır; donmuş/ters parçaya yazılmaz", () => {
    const chunk = { text: "merhaba dünya", start: 9, end: 11, words: [] };
    const placed = placeChunks(
      [chunk],
      [{ start: 0, srcStart: 10, srcEnd: 20, speed: 1 }],
      "s1",
      "s1",
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].start).toBe(0);
    expect(placed[0].end).toBeCloseTo(1);
    const still = [{ start: 0, srcStart: 10, srcEnd: 20, speed: 1, still: true }];
    expect(placeChunks([chunk], still, "s1", "s1")).toEqual([]);
    expect(usedRanges(still, "s1", "s1")).toEqual([]);
  });

  it("satır başına kelime sınırı ve kelime zamanları korunur", () => {
    const words = ["bir", "iki", "üç", "dört", "beş"].map((text, i) => ({
      text,
      start: i,
      end: i + 0.8,
    }));
    const two = groupWords(words, "line", 2);
    expect(two.map((c) => c.text)).toEqual(["bir iki", "üç dört", "beş"]);
    expect(two[1].words.map((w) => w.start)).toEqual([2, 3]);
  });

  it("kelime kelimede kelimeler zıplayarak gelir", () => {
    expect(captionStyle("word").anim).toBe("pop");
  });
});
