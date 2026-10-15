import { describe, expect, it } from "vitest";
import {
  applyAutoEmoji,
  carryEmoji,
  clearEmoji,
  emojiBox,
  emojiCode,
  isEmoji,
  suggestEmoji,
} from "./captionEmoji";
import { emojiOverlays } from "./emojiImage";
import { parseProject, serializeProject } from "./projectFile";
import { newText, type TextItem } from "./textItems";

const line = (
  id: string,
  text: string,
  start: number,
  end: number,
  extra: Partial<TextItem> = {},
) => ({
  ...newText(id, start, text),
  end,
  auto: true,
  ...extra,
});

describe("emoji önerisi", () => {
  it("Türkçe eklerle de anahtar kelimeyi bulur", () => {
    expect(suggestEmoji({ text: "Bu ayki paralarımı nereye harcadım" })).toBe("💰");
    expect(suggestEmoji({ text: "Maçı kazandık!" })).toBe("🏆");
    expect(suggestEmoji({ text: "kazancını ikiye katla" })).toBe("💰");
    expect(suggestEmoji({ text: "BU OYUNU HERKES OYNAMALI" })).toBe("🎮");
    expect(suggestEmoji({ text: "Türkiye'de ilk kez" })).toBeNull();
  });

  it("İngilizce kelimeler ve büyük harf", () => {
    expect(suggestEmoji({ text: "THIS IDEA changed everything" })).toBe("💡");
    expect(suggestEmoji({ text: "that was so funny" })).toBe("😂");
  });

  it("tam kelime gerekenler ve yanıltıcı kökler eşleşmez", () => {
    expect(suggestEmoji({ text: "no way" })).toBe("❌");
    expect(suggestEmoji({ text: "nobody knows" })).toBeNull();
    expect(suggestEmoji({ text: "iki paralel çizgi" })).toBeNull();
    expect(suggestEmoji({ text: "o zaman tamam" })).toBeNull();
  });

  it("anahtar kelime (★) işaretli kelime önce gelir", () => {
    const item = {
      text: "para kazanmak için oyun oyna",
      words: [
        { text: "para", start: 0, end: 0.3 },
        { text: "kazanmak", start: 0.3, end: 0.6 },
        { text: "için", start: 0.6, end: 0.8 },
        { text: "oyun", start: 0.8, end: 1, emph: true },
        { text: "oyna", start: 1, end: 1.2 },
      ],
    };
    expect(suggestEmoji(item)).toBe("🎮");
  });
});

describe("otomatik emoji", () => {
  it("yalnız eşleşen satırlara ekler, art arda aynısını tekrarlamaz, elle seçileni korur", () => {
    const texts = [
      line("a", "çok para", 0, 1),
      line("b", "daha çok para", 1, 2),
      line("c", "bugün hava", 2, 3),
      line("d", "komik", 3, 4, { emoji: "⭐" }),
      { ...newText("x", 0, "elle yazılan para"), end: 5 },
    ];
    const out = applyAutoEmoji(texts);
    expect(out.map((t) => t.emoji)).toEqual(["💰", undefined, undefined, "⭐", undefined]);
    // replace: elle seçilen de yeniden önerilir.
    expect(applyAutoEmoji(texts, true)[3].emoji).toBe("😂");
    expect(clearEmoji(out).every((t) => t.emoji === undefined)).toBe(true);
  });

  it("satırlar yeniden bölününce emoji çakışan ilk satıra taşınır", () => {
    const old = [line("a", "çok para kazandım", 0, 2, { emoji: "💰" }), line("b", "sonra", 2, 3)];
    const fresh = [
      line("n1", "çok", 0, 0.6),
      line("n2", "para", 0.6, 1.2),
      line("n3", "kazandım", 1.2, 2),
    ];
    expect(carryEmoji(old, fresh).map((t) => t.emoji)).toEqual(["💰", undefined, undefined]);
  });
});

describe("emoji yardımcıları", () => {
  it("kod noktaları ve doğrulama", () => {
    expect(emojiCode("🔥")).toBe("1f525");
    expect(emojiCode("❤️")).toBe("2764-fe0f");
    expect(isEmoji("🔥")).toBe(true);
    expect(isEmoji("❤️")).toBe(true);
    expect(isEmoji("abc")).toBe(false);
    expect(isEmoji("🔥a")).toBe(false);
    expect(isEmoji(5)).toBe(false);
  });

  it("emoji yazının üstünde; karenin tepesindeyse altında", () => {
    const frame = { width: 1080, height: 1920 };
    const below = emojiBox({ ...newText("a", 0, "merhaba"), y: 0.8, size: 0.07 }, frame);
    expect(below.x).toBe(0.5);
    expect(below.y).toBeLessThan(0.8);
    // 0.07 × 1080 × 1.5 = 113 px genişlik.
    expect(below.size * 1080).toBeCloseTo(113.4, 1);
    const top = emojiBox({ ...newText("a", 0, "merhaba"), y: 0.03, size: 0.07 }, frame);
    expect(top.y).toBeGreaterThan(0.03);
  });

  it("dışa aktarma: aynı emoji aynı yerde tek resim, aralıklar birleşir", () => {
    const texts = [
      line("a", "para", 1, 2, { emoji: "💰" }),
      line("b", "yine para", 5, 6, { emoji: "💰" }),
      line("c", "ateş", 3, 4, { emoji: "🔥" }),
      line("d", "emoji dosyası yok", 7, 8, { emoji: "🎮" }),
    ];
    const files = new Map([
      ["💰", "C:\\cache\\emoji\\1f4b0.png"],
      ["🔥", "C:\\cache\\emoji\\1f525.png"],
    ]);
    const pieces = [{ tStart: 0, tEnd: 10, srcStart: 0, srcEnd: 10, speed: 1, outStart: 0 }];
    const out = emojiOverlays(texts, pieces, { width: 1080, height: 1920 }, files);
    expect(out).toHaveLength(2);
    expect(out[0].path).toContain("1f4b0");
    expect(out[0].ranges).toEqual([
      [1, 2],
      [5, 6],
    ]);
    expect(out[1].ranges).toEqual([[3, 4]]);
  });

  it("proje dosyasında emoji saklanır, bozuk değer atılır", () => {
    const base = {
      sources: [{ id: "s1", path: "C:/a.mp4", title: "a.mp4" }],
      clips: [],
      images: [],
      music: [],
      blurs: [],
      tracks: {},
    };
    const text = serializeProject({
      ...base,
      name: "a",
      texts: [
        line("a", "para", 0, 1, { emoji: "💰" }),
        line("b", "x", 1, 2, { emoji: "<script>" }),
      ],
      exportOptions: {},
    } as never);
    const parsed = parseProject(text);
    expect(parsed.texts[0].emoji).toBe("💰");
    expect(parsed.texts[1].emoji).toBeUndefined();
  });
});
