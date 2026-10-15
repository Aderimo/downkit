import { describe, expect, it } from "vitest";
import { limitCut, planResult, planShorten, sentenceScore } from "./shorten";
import { newText, type TextItem } from "./textItems";

/** 10 sn arayla, her biri 4 kelime / 2 sn süren cümleler. */
function line(id: string, text: string, start: number, extra: Partial<TextItem> = {}): TextItem {
  const words = text
    .split(" ")
    .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.45 }));
  return {
    ...newText(id, start, text),
    end: start + words.length * 0.5,
    words,
    auto: true,
    ...extra,
  };
}

describe("hedef süreye kısaltma", () => {
  const texts = [
    line("hook", "bunu kimse bilmiyor ama", 0),
    line("l1", "şimdi şöyle bir şey", 10),
    line("l2", "bu gerçekten çok önemli!", 20),
    line("l3", "neyse devam edelim artık", 30),
    line("l4", "en büyük sır para", 40),
    line("end", "abone olmayı unutma", 50),
  ];

  it("sessizlik ve dolgu yetiyorsa cümle önerilmez", () => {
    const plan = planShorten({
      texts,
      duration: 70,
      markers: [],
      silences: [
        { start: 3, end: 9 },
        { start: 13, end: 19 },
      ],
      fillers: [{ start: 5, end: 6 }],
      target: 60,
    });
    expect(plan.reached).toBe(true);
    expect(plan.sentences).toEqual([]);
    // 12 sn kesilebilir ama hedef 60: yalnızca 10 sn kesilir, video hedeften kısalmaz.
    expect(plan.after).toBeCloseTo(60, 5);
  });

  it("tamamı sessiz video sıfıra inmez; hedefte durur", () => {
    const plan = planShorten({
      texts: [],
      duration: 41,
      markers: [],
      silences: [{ start: 0, end: 41 }],
      fillers: [],
      target: 15,
    });
    expect(plan.after).toBeCloseTo(15, 5);
    expect(plan.reached).toBe(true);
  });

  it("en az önemli cümleler önerilir; kanca ve kapanış korunur", () => {
    const plan = planShorten({
      texts,
      duration: 60,
      markers: [],
      silences: [],
      fillers: [],
      target: 56,
    });
    expect(plan.reached).toBe(true);
    // l1 ve l3 sıradan; l2 ünlemli, l4 anahtar kelimeli ("sır", "para").
    expect(plan.sentences.map((s) => s.textId)).toEqual(["l1", "l3"]);
    // Her cümle 4 kelime: 9.95–12.0 = 2.05 sn (kenarlarda 0.05 pay).
    expect(plan.after).toBeCloseTo(55.9, 5);
    expect(planResult(plan, ["l3"])).toBeGreaterThan(plan.after);
  });

  it("an işareti olan cümle önemli sayılır", () => {
    const marked = sentenceScore(texts[1], [11], 0);
    const plain = sentenceScore(texts[1], [], 0);
    expect(marked - plain).toBe(4);
    expect(sentenceScore(texts[1], [], 2)).toBeLessThan(plain);
  });

  it("hedefe inilemiyorsa söylenir", () => {
    const plan = planShorten({
      texts,
      duration: 60,
      markers: [],
      silences: [],
      fillers: [],
      target: 10,
    });
    expect(plan.reached).toBe(false);
    expect(plan.sentences).toHaveLength(4);
  });
});

describe("kesim sınırı", () => {
  it("en uzun aralıktan başlar, sonuncuyu kısaltır", () => {
    expect(
      limitCut(
        [
          { start: 0, end: 2 },
          { start: 5, end: 10 },
        ],
        20,
        14,
      ),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 10 },
    ]);
    expect(limitCut([{ start: 0, end: 5 }], 10, 20)).toEqual([]);
  });
});
