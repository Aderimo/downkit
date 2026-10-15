import { describe, expect, it } from "vitest";
import { parseProgressBar, templateById, templateTexts } from "./reelTemplates";

let n = 0;
const id = () => `t${++n}`;

describe("Reels şablonları", () => {
  it("yazılar video süresine göre zamanlanır: tüm video, baştan, sondan", () => {
    const full = templateTexts(templateById("titleQuestion")!, 40, id, (k) => k);
    expect(full.map((t) => [t.text, t.start, t.end, t.tpl])).toEqual([
      ["title", 0, 40, "layout"],
      ["question", 0, 40, "layout"],
    ]);
    const hook = templateTexts(templateById("hookSecret")!, 40, id, (k) => k);
    expect([hook[0].start, hook[0].end, hook[0].anim]).toEqual([0, 3, "pop"]);
    const end = templateTexts(templateById("endFollow")!, 40, id, (k) => k);
    expect([end[0].start, end[0].end, end[0].tpl]).toEqual([37, 40, "end"]);
    // Kısa videoda bitiş yazısı başa taşmaz.
    const short = templateTexts(templateById("endFull")!, 2, id, (k) => k);
    expect(short[0].start).toBe(0);
  });

  it("ilerleme çubuğu kaydı doğrulanır", () => {
    expect(parseProgressBar({ color: "#ffd43b", height: 1, top: true })).toEqual({
      color: "#ffd43b",
      height: 0.06,
      top: true,
    });
    expect(parseProgressBar({ color: "sarı" })).toBeNull();
    expect(parseProgressBar(null)).toBeNull();
  });
});
