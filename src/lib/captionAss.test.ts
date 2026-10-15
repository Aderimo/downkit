import { describe, expect, it } from "vitest";
import { assAlpha, assColor, assEscape, assTime, buildAss } from "./captionAss";
import { applyLook, CAPTION_PRESETS, presetById } from "./captionPresets";
import { activeWord, clearRichLook, displayText, isRichText, parseRichStyle } from "./captionStyle";
import { regroupCaptions } from "./captionActions";
import type { TextItem } from "./textItems";

const frame = { width: 1080, height: 1920 };
const base: TextItem = {
  id: "t",
  text: "bu şehir çok güzel",
  start: 1,
  end: 3,
  x: 0.5,
  y: 0.7,
  size: 0.08,
  color: "#ffffff",
  box: false,
  bold: true,
};
const words = [
  { text: "bu", start: 1, end: 1.3 },
  { text: "şehir", start: 1.4, end: 1.9 },
  { text: "çok", start: 2, end: 2.3 },
  { text: "güzel", start: 2.4, end: 2.9 },
];

describe("ASS altyazı", () => {
  it("renk, zaman ve kaçış", () => {
    expect(assColor("#ff8000")).toBe("&H0080FF&");
    expect(assAlpha(0)).toBe("&HFF&");
    expect(assAlpha(1)).toBe("&H00&");
    expect(assTime(3725.456)).toBe("1:02:05.46");
    expect(assEscape("a{b}\\c\nd")).toBe("a｛b｝⧵c\\Nd");
  });

  it("zengin olmayan yazılar ASS'e girmez", () => {
    expect(buildAss([base], [{ tStart: 0, tEnd: 10 }], frame)).toBeNull();
    expect(isRichText(base)).toBe(false);
    expect(isRichText({ ...base, font: "impact" })).toBe(true);
  });

  it("kelime vurgusunda her kelime ayrı olay, vurgulu kelime renkli", () => {
    const t = {
      ...base,
      font: "impact" as const,
      highlight: { mode: "color" as const, color: "#ffd43b" },
      words,
    };
    const ass = buildAss([t], [{ tStart: 0, tEnd: 10 }], frame) ?? "";
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(4);
    // İlk olay satırın başından, ikincisi ikinci kelimeden başlar; son olay satırın sonunda biter.
    expect(events[0]).toContain("0:00:01.00,0:00:01.40");
    expect(events[1]).toContain("0:00:01.40,0:00:02.00");
    expect(events[3]).toContain("0:00:02.40,0:00:03.00");
    expect(events[1]).toContain("{\\c&H3BD4FF&}şehir");
    expect(ass).toContain("\\fnImpact");
    expect(ass).toContain("PlayResX: 1080");
  });

  it("zamanlar çıktı saniyesine çevrilir; kesilen kısımdaki kelime düşer", () => {
    const t = {
      ...base,
      font: "impact" as const,
      highlight: { mode: "color" as const, color: "#ffd43b" },
      words,
    };
    // 0–1.5 ve 2.2–5 tutuldu: 1.5–2.2 arası (çok'un başı) kesildi.
    const ass =
      buildAss(
        [t],
        [
          { tStart: 0, tEnd: 1.5 },
          { tStart: 2.2, tEnd: 5 },
        ],
        frame,
      ) ?? "";
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // "çok" 2.0–2.4 → yalnızca 2.2–2.4 kalır: çıktıda 1.50–1.70.
    expect(events.some((e) => e.includes("0:00:01.50,0:00:01.70"))).toBe(true);
    expect(events.every((e) => !e.includes("0:00:02.20"))).toBe(true);
  });

  it("arka planlı yazıda kutu ayrı katmanda çizilir", () => {
    const ass =
      buildAss(
        [{ ...base, font: "segoe", bg: "#e11d48", bgOpacity: 1 }],
        [{ tStart: 0, tEnd: 10 }],
        frame,
      ) ?? "";
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:03.00,Box,");
    expect(ass).toContain("Dialogue: 1,0:00:01.00,0:00:03.00,Default,");
    expect(ass).toContain("\\3c&H481DE1&\\3a&H00&");
  });
});

describe("altyazı stilleri", () => {
  it("24 hazır stil, kimlikler benzersiz", () => {
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(CAPTION_PRESETS.map((p) => p.id)).size).toBe(CAPTION_PRESETS.length);
  });

  it("stil uygulanınca metin, zaman ve kelimeler korunur, eski alanlar silinir", () => {
    const withGlow = applyLook({ ...base, words }, presetById("neonPurple").look);
    expect(withGlow.glow).toBeGreaterThan(0);
    const back = applyLook(withGlow, presetById("classic").look);
    expect(back.glow).toBeUndefined();
    expect(back.words).toEqual(words);
    expect([back.text, back.start, back.end]).toEqual([base.text, base.start, base.end]);
  });

  it("büyük harf Türkçe kurallarıyla; konuşulan kelime", () => {
    expect(displayText("istanbul ılık", true)).toBe("İSTANBUL ILIK");
    expect(activeWord(words, 0.5)).toBe(-1);
    expect(activeWord(words, 1.35)).toBe(0);
    expect(activeWord(words, 2.05)).toBe(2);
  });

  it("bozuk stil alanları atılır", () => {
    expect(
      parseRichStyle({
        font: "yok",
        stroke: 9,
        bg: "kırmızı",
        highlight: { mode: "x", color: "#fff" },
      }),
    ).toEqual({
      stroke: 0.25,
    });
  });

  it("satır başına kelime değişince altyazılar kelime zamanlarıyla yeniden bölünür", () => {
    let n = 0;
    const autos: TextItem[] = [
      {
        ...base,
        id: "a",
        text: "bu şehir",
        start: 1,
        end: 1.9,
        auto: true,
        font: "impact",
        words: words.slice(0, 2),
      },
      {
        ...base,
        id: "b",
        text: "çok güzel",
        start: 2,
        end: 2.9,
        auto: true,
        font: "impact",
        words: words.slice(2),
      },
      { ...base, id: "elle", text: "Başlık", start: 0, end: 5 },
    ];
    const one = regroupCaptions(autos, 1, () => `n${(n += 1)}`);
    expect(one.filter((t) => t.auto).map((t) => t.text)).toEqual(["bu", "şehir", "çok", "güzel"]);
    expect(one.find((t) => t.id === "elle")).toBeTruthy();
    const four = regroupCaptions(one, 4, () => `n${(n += 1)}`);
    expect(four.filter((t) => t.auto).map((t) => t.text)).toEqual(["bu şehir çok güzel"]);
    expect(four.find((t) => t.auto)?.font).toBe("impact");
  });

  it("yeniden bölünce her satır kendi stilini korur; altyazı stili kaldırılabilir", () => {
    let n = 0;
    const autos: TextItem[] = [
      {
        ...base,
        id: "a",
        text: "bu şehir",
        start: 1,
        end: 1.9,
        auto: true,
        font: "impact",
        words: words.slice(0, 2),
      },
      {
        ...base,
        id: "b",
        text: "çok güzel",
        start: 2,
        end: 2.9,
        auto: true,
        font: "georgia",
        words: words.slice(2),
      },
    ];
    const one = regroupCaptions(autos, 1, () => `n${(n += 1)}`);
    expect(one.map((t) => t.font)).toEqual(["impact", "impact", "georgia", "georgia"]);
    const plain = { ...one[0], ...clearRichLook() };
    expect(isRichText(plain)).toBe(false);
    expect(plain.words).toEqual(one[0].words);
  });
});
