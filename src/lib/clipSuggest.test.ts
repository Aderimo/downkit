import { describe, expect, it } from "vitest";
import { suggestClips, type SuggestInput } from "./clipSuggest";
import { newText, type TextItem } from "./textItems";

/** `start` anından 4 kelimelik, 2 sn süren cümle. */
function line(id: string, text: string, start: number): TextItem {
  const words = text
    .split(" ")
    .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.45 }));
  return { ...newText(id, start, text), end: start + 2, words, auto: true };
}

const base: SuggestInput = {
  duration: 600,
  length: 30,
  count: 3,
  markers: [],
  highlights: [],
  chapters: [],
  lines: [],
};

describe("klip önerileri", () => {
  it("kısa videoda öneri yok", () => {
    expect(suggestClips({ ...base, duration: 40 })).toEqual([]);
  });

  it("an işareti ve heyecanlı an olan yerler önce; öneriler çakışmaz", () => {
    const out = suggestClips({ ...base, markers: [200], highlights: [205, 410] });
    expect(out).toHaveLength(3);
    // İşaret + heyecanlı an: pencere işaretten 9 sn önce başlar.
    expect(out[0]).toMatchObject({ start: 191, end: 221 });
    expect(out[0].reasons).toEqual(expect.arrayContaining(["marker", "highlight"]));
    expect(out[1].start).toBeCloseTo(401);
    for (const a of out) {
      for (const b of out) {
        if (a === b) continue;
        expect(Math.min(a.end, b.end) - Math.max(a.start, b.start)).toBeLessThan(6);
      }
    }
  });

  it("konuşma yoğun bölüm seçilir ve cümle başına/sonuna oturur; başlık ilk cümle", () => {
    const lines: TextItem[] = [];
    // 100–140 sn arası sürekli konuşma, başka yerde yok.
    for (let t = 100.7; t < 140; t += 2.5) lines.push(line(`l${t}`, "bu çok önemli bir", t));
    const out = suggestClips({ ...base, count: 1, lines });
    expect(out).toHaveLength(1);
    const [s] = out;
    expect(lines.some((l) => Math.abs(l.start - s.start) < 1e-6)).toBe(true);
    expect(lines.some((l) => Math.abs(l.end - s.end) < 1e-6)).toBe(true);
    expect(s.end - s.start).toBeGreaterThan(18);
    expect(s.end - s.start).toBeLessThanOrEqual(32);
    expect(s.title).toBe("bu çok önemli bir");
    expect(s.reasons).toContain("speech");
  });

  it("bölüm başı pencere başı olur ve başlığı alır", () => {
    const out = suggestClips({
      ...base,
      count: 1,
      chapters: [{ start: 300, title: "Final" }],
      markers: [310],
    });
    expect(out[0]).toMatchObject({ title: "Final" });
    expect(out[0].reasons).toContain("chapter");
  });
});
