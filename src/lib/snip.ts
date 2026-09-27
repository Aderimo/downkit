import type { OcrLine, PixelRect, TranslateLang } from "../types/snip";

/** Çeviri yönü: otomatikte metnin dilinden karar verilir. */
export type TranslateDirection = "auto" | "en-tr" | "tr-en";

// Türkçeye özgü harfler ve İngilizcede geçmeyen sık sözcükler.
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/;
const TURKISH_WORDS = new Set([
  "ve",
  "bir",
  "bu",
  "için",
  "ile",
  "da",
  "de",
  "ne",
  "mi",
  "mı",
  "değil",
  "var",
  "yok",
  "olarak",
  "gibi",
  "daha",
  "çok",
  "ama",
  "ya",
  "şu",
  "ben",
  "sen",
  "biz",
  "siz",
  "onlar",
  "evet",
  "hayır",
  "tamam",
  "lütfen",
]);

/** Metnin dili (yalnız Türkçe/İngilizce ayrımı): Türkçe harf ya da sık Türkçe
 * sözcük oranı belirginse "tr", yoksa "en". */
export function detectLanguage(text: string): TranslateLang {
  const words = text.toLocaleLowerCase("tr").match(/[\p{L}]+/gu) ?? [];
  if (words.length === 0) return "en";
  const letters = words.filter((w) => TURKISH_LETTERS.test(w)).length;
  const common = words.filter((w) => TURKISH_WORDS.has(w)).length;
  return (letters + common) / words.length >= 0.15 ? "tr" : "en";
}

export function resolveDirection(
  direction: TranslateDirection,
  text: string,
): { from: TranslateLang; to: TranslateLang } {
  if (direction === "en-tr") return { from: "en", to: "tr" };
  if (direction === "tr-en") return { from: "tr", to: "en" };
  return detectLanguage(text) === "tr" ? { from: "tr", to: "en" } : { from: "en", to: "tr" };
}

/** OCR motorunun dili: kaynak dil biliniyorsa o (İngilizce motor Türkçe harfleri
 * bozar, Türkçe motor İngilizceyi de okur); otomatikte Windows'un kullanıcı dilleri. */
export function ocrLanguageFor(direction: TranslateDirection): string | null {
  if (direction === "en-tr") return "en";
  if (direction === "tr-en") return "tr";
  return null;
}

/** Görsel çeviride bir kutu: birbirine yakın satırlar tek paragraf olur. */
export interface OcrBlock extends PixelRect {
  text: string;
  /** Satır yüksekliği ortalaması: çevirinin yazı boyutu buna göre seçilir. */
  lineHeight: number;
}

/** OCR satırlarını paragraflara toplar. Aynı sütunda (solları yakın ya da yatayda
 * örtüşen) ve arası satır yüksekliğinden az olan satırlar aynı bloktadır. */
export function groupOcrBlocks(lines: readonly OcrLine[]): OcrBlock[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks: (OcrBlock & { lines: number })[] = [];
  for (const line of sorted) {
    const h = Math.max(1, line.height);
    const block = blocks.find((b) => {
      const gap = line.y - (b.y + b.height);
      const overlaps = line.x < b.x + b.width && line.x + line.width > b.x;
      const aligned = Math.abs(line.x - b.x) < h * 2;
      return gap < h * 0.9 && gap > -h * 0.5 && (overlaps || aligned);
    });
    if (!block) {
      blocks.push({ ...line, text: line.text, lineHeight: h, lines: 1 });
      continue;
    }
    const right = Math.max(block.x + block.width, line.x + line.width);
    const bottom = Math.max(block.y + block.height, line.y + line.height);
    block.x = Math.min(block.x, line.x);
    block.y = Math.min(block.y, line.y);
    block.width = right - block.x;
    block.height = bottom - block.y;
    block.text = `${block.text} ${line.text}`;
    block.lineHeight = (block.lineHeight * block.lines + h) / (block.lines + 1);
    block.lines += 1;
  }
  return blocks.map(({ lines: _lines, ...rest }) => rest);
}

/** OCR sonucunu düz metne çevirir: paragraf içi satırlar boşlukla, paragraflar
 * boş satırla ayrılır (çeviri paragraf yapısını korur). */
export function ocrText(lines: readonly OcrLine[]): string {
  return groupOcrBlocks(lines)
    .map((b) => b.text)
    .join("\n\n");
}

/** Sürükleme (ekran noktaları) → görüntü pikseli dikdörtgeni. `scale`: bir CSS
 * pikselinin kaç görüntü pikseli olduğu. Yön fark etmez, görüntü dışı kırpılır. */
export function selectionToPixels(
  a: { x: number; y: number },
  b: { x: number; y: number },
  scale: number,
  width: number,
  height: number,
): PixelRect {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x1 = clamp(Math.round(Math.min(a.x, b.x) * scale), width);
  const y1 = clamp(Math.round(Math.min(a.y, b.y) * scale), height);
  const x2 = clamp(Math.round(Math.max(a.x, b.x) * scale), width);
  const y2 = clamp(Math.round(Math.max(a.y, b.y) * scale), height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Dosya adı için zaman damgası: "2026-09-27 14.05.33". */
export function snipFileName(prefix: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}
