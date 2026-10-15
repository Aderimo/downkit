import { describe, expect, it } from "vitest";
import { defaultSelected, findFillers } from "./fillers";
import { cutTimeline } from "./rangeCut";
import { newText, type TextItem } from "./textItems";

/** Kelime zamanlı otomatik altyazı satırı (kelimeler 0.5 sn arayla, 0.4 sn sürer). */
function line(id: string, text: string, start: number): TextItem {
  const words = text
    .split(" ")
    .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
  return { ...newText(id, start, text), end: start + words.length * 0.5, words, auto: true };
}

describe("dolgu kelimeleri", () => {
  it("ses dolguları, söz dolguları ve kekelemeler ayrı türlerde bulunur", () => {
    const texts = [
      line("a", "Iıı bugün yani şey", 0),
      line("b", "bu bu çok Eee, güzel", 3),
      line("c", "um so like this", 6),
    ];
    const hits = findFillers(texts);
    expect(hits.map((h) => [h.word, h.kind])).toEqual([
      ["Iıı", "sound"],
      ["yani", "word"],
      ["şey", "word"],
      ["bu", "repeat"],
      ["Eee,", "sound"],
      ["um", "sound"],
      ["like", "word"],
    ]);
    expect(defaultSelected("sound")).toBe(true);
    expect(defaultSelected("word")).toBe(false);
    // Tekrar çoğu zaman vurgudur ("lan lan"): seçili gelmez.
    expect(defaultSelected("repeat")).toBe(false);
  });

  it("kesim aralığı komşu kelimeye taşmaz; tekrarda ikinci söyleniş kalır", () => {
    const hits = findFillers([line("b", "bu bu çok eee güzel", 3)]);
    const repeat = hits.find((h) => h.kind === "repeat")!;
    expect(repeat.start).toBeCloseTo(2.96);
    expect(repeat.end).toBeCloseTo(3.5);
    const sound = hits.find((h) => h.kind === "sound")!;
    // "çok" 4.0–4.4 biter, "eee" 4.5–4.9, "güzel" 5.0'da başlar.
    expect(sound.start).toBeCloseTo(4.46);
    expect(sound.end).toBeCloseTo(4.94);
  });

  it("otomatik olmayan yazılar ve anlamlı kelimeler dolgu sayılmaz", () => {
    const manual = { ...line("m", "eee yani", 0), auto: false };
    expect(findFillers([manual, line("a", "Ali eve gitti a", 2)])).toEqual([]);
  });

  it("dolgu kesilince altyazıdan da düşer, sonrası kayar", () => {
    const texts = [line("a", "merhaba eee arkadaşlar", 0)];
    const hit = findFillers(texts)[0];
    const clips = [{ id: "c", track: 0, start: 0, srcStart: 0, srcEnd: 10, speed: 1, name: "" }];
    const out = cutTimeline({ clips, texts, images: [], blurs: [], music: [] }, [hit], () => "n");
    expect(out.texts[0].text).toBe("merhaba arkadaşlar");
    expect(out.texts[0].words![1].start).toBeCloseTo(1 - (hit.end - hit.start));
    expect(out.clips).toHaveLength(2);
  });
});
