import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  groupOcrBlocks,
  ocrLanguageFor,
  ocrText,
  resolveDirection,
  selectionToPixels,
  snipFileName,
} from "./snip";
import type { OcrLine } from "../types/snip";

const line = (text: string, x: number, y: number, width = 300, height = 20): OcrLine => ({
  text,
  x,
  y,
  width,
  height,
});

describe("dil tespiti ve çeviri yönü", () => {
  it("Türkçe harf ya da sık sözcük varsa Türkçe", () => {
    expect(detectLanguage("Değişiklikleri kaydetmek ister misiniz?")).toBe("tr");
    expect(detectLanguage("Bu bir deneme ve bu da ikinci")).toBe("tr");
    expect(detectLanguage("Please save your changes before closing.")).toBe("en");
    expect(detectLanguage("")).toBe("en");
  });

  it("otomatik yön metnin dilinden, elle seçilen olduğu gibi", () => {
    expect(resolveDirection("auto", "Merhaba dünya, nasılsın?")).toEqual({ from: "tr", to: "en" });
    expect(resolveDirection("auto", "Hello world")).toEqual({ from: "en", to: "tr" });
    expect(resolveDirection("tr-en", "Hello")).toEqual({ from: "tr", to: "en" });
  });

  it("OCR dili kaynak dile göre, otomatikte Windows'a bırakılır", () => {
    expect(ocrLanguageFor("en-tr")).toBe("en");
    expect(ocrLanguageFor("tr-en")).toBe("tr");
    expect(ocrLanguageFor("auto")).toBeNull();
  });
});

describe("OCR satırlarını paragraflara toplama", () => {
  it("alt alta yakın satırlar tek blok, uzak olan ayrı", () => {
    const blocks = groupOcrBlocks([
      line("Please save your", 20, 20),
      line("changes before closing.", 20, 44),
      line("Cancel", 20, 140, 80),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      "Please save your changes before closing.",
      "Cancel",
    ]);
    expect(blocks[0].height).toBe(44);
  });

  it("aynı yükseklikteki iki sütun karışmaz", () => {
    const blocks = groupOcrBlocks([
      line("Sol sütun", 20, 20, 200),
      line("Sağ sütun", 600, 20, 200),
      line("sol devam", 20, 44, 200),
    ]);
    expect(blocks.map((b) => b.text)).toEqual(["Sol sütun sol devam", "Sağ sütun"]);
  });

  it("düz metinde paragraflar boş satırla ayrılır", () => {
    expect(ocrText([line("A", 0, 0), line("B", 0, 22), line("C", 0, 200)])).toBe("A B\n\nC");
  });
});

describe("seçim ve dosya adı", () => {
  it("ters yöne sürükleme de aynı dikdörtgeni verir, ölçek uygulanır", () => {
    expect(selectionToPixels({ x: 50, y: 40 }, { x: 10, y: 10 }, 1.5, 1000, 1000)).toEqual({
      x: 15,
      y: 15,
      width: 60,
      height: 45,
    });
  });

  it("görüntü dışına taşan seçim kırpılır", () => {
    expect(selectionToPixels({ x: -20, y: 90 }, { x: 30, y: 200 }, 1, 100, 100)).toEqual({
      x: 0,
      y: 90,
      width: 30,
      height: 10,
    });
  });

  it("dosya adı sıralanabilir zaman damgası taşır", () => {
    expect(snipFileName("Ekran görüntüsü", new Date(2026, 8, 27, 9, 5, 3))).toBe(
      "Ekran görüntüsü 2026-09-27 09.05.03",
    );
  });
});
