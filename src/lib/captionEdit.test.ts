import { describe, expect, it } from "vitest";
import { editLineText, removeWord, shiftCaptions, toggleEmphasis } from "./captionEdit";
import { buildAss } from "./captionAss";
import type { TextItem } from "./textItems";

const line: TextItem = {
  id: "a",
  text: "bu oyun çok zor",
  start: 2,
  end: 4,
  x: 0.5,
  y: 0.8,
  size: 0.07,
  color: "#ffffff",
  box: false,
  bold: true,
  auto: true,
  font: "impact",
  words: [
    { text: "bu", start: 2, end: 2.3 },
    { text: "oyun", start: 2.4, end: 2.9 },
    { text: "çok", start: 3, end: 3.3 },
    { text: "zor", start: 3.4, end: 3.9 },
  ],
};

describe("transkript düzenleyici", () => {
  it("kelime sayısı aynıysa zamanlar korunur, yazı düzelir", () => {
    const fixed = editLineText(line, "bu oyun çok zor!");
    expect(fixed.text).toBe("bu oyun çok zor!");
    expect(fixed.words?.map((w) => w.start)).toEqual([2, 2.4, 3, 3.4]);
    expect(fixed.words?.[3].text).toBe("zor!");
  });

  it("kelime sayısı değişince satırın süresi harf sayısına göre dağıtılır", () => {
    const fixed = editLineText(line, "bu oyun gerçekten çok zor");
    expect(fixed.words).toHaveLength(5);
    expect(fixed.words?.[0].start).toBe(2);
    expect(fixed.words?.at(-1)?.end).toBeLessThanOrEqual(4);
    const starts = fixed.words?.map((w) => w.start) ?? [];
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("anahtar kelime işaretlenir ve dışa aktarmada renkli çizilir", () => {
    const marked = toggleEmphasis(line, 2);
    expect(marked.words?.[2].emph).toBe(true);
    expect(toggleEmphasis(marked, 2).words?.[2].emph).toBeUndefined();
    const ass = buildAss([marked], [{ tStart: 0, tEnd: 10 }], { width: 1080, height: 1920 }) ?? "";
    expect(ass).toContain("{\\c&H3BD4FF&}çok{\\c&HFFFFFF&}");
  });

  it("kelime silinir; satır boşalırsa kalkar", () => {
    const shorter = removeWord(line, 0);
    expect(shorter?.text).toBe("oyun çok zor");
    expect(removeWord({ ...line, words: [line.words![0]] }, 0)).toBeNull();
  });

  it("altyazılar kelimeleriyle birlikte kaydırılır, 0'ın altına inmez", () => {
    const shifted = shiftCaptions([line], ["a"], 0.5)[0];
    expect([shifted.start, shifted.end, shifted.words?.[0].start]).toEqual([2.5, 4.5, 2.5]);
    expect(shiftCaptions([line], ["a"], -10)[0].start).toBe(0);
  });
});
