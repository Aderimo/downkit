import type { WordTiming } from "./captionStyle";
import type { TextItem } from "./textItems";

// Transkript düzenleyici: satır metnini düzelt (kelime zamanları korunur ya da
// orantılı dağıtılır), anahtar kelimeyi vurgula, kelime sil, tüm altyazıları kaydır.

const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/**
 * Satırın metni değişti. Kelime sayısı aynıysa zamanlar aynen kalır (yalnızca yazı
 * düzelir); değiştiyse satırın süresi yeni kelimelere harf sayısına göre bölünür.
 * Anahtar kelime işaretleri aynı sıradaki kelimede kalır.
 */
export function editLineText(item: TextItem, text: string): TextItem {
  const next = tokens(text);
  if (next.length === 0) return { ...item, text: "" };
  const old = item.words ?? [];
  if (old.length === next.length) {
    return { ...item, text: next.join(" "), words: old.map((w, i) => ({ ...w, text: next[i] })) };
  }
  const total = next.reduce((n, w) => n + w.length, 0) || 1;
  const span = Math.max(0.1, item.end - item.start);
  let cursor = item.start;
  const words: WordTiming[] = next.map((w, i) => {
    const length = (span * w.length) / total;
    const word: WordTiming = { text: w, start: cursor, end: cursor + length * 0.92 };
    if (old[i]?.emph) word.emph = true;
    cursor += length;
    return word;
  });
  return { ...item, text: next.join(" "), words };
}

/** Kelimeyi anahtar kelime yap / geri al (konuşulmasa da vurgu renginde görünür). */
export function toggleEmphasis(item: TextItem, index: number): TextItem {
  if (!item.words?.[index]) return item;
  return {
    ...item,
    words: item.words.map((w, i) => {
      if (i !== index) return w;
      const next = { ...w };
      if (next.emph) delete next.emph;
      else next.emph = true;
      return next;
    }),
  };
}

/** Kelimeyi satırdan siler; satır boşalırsa null. */
export function removeWord(item: TextItem, index: number): TextItem | null {
  const words = (item.words ?? []).filter((_, i) => i !== index);
  if (words.length === 0) return null;
  return {
    ...item,
    text: words.map((w) => w.text).join(" "),
    words,
    start: Math.min(item.start, words[0].start),
  };
}

/** Altyazıları ileri/geri kaydırır (ses ile yazı kaymışsa senkron düzeltme). */
export function shiftCaptions(
  texts: readonly TextItem[],
  ids: readonly string[],
  delta: number,
): TextItem[] {
  return texts.map((t) => {
    if (!ids.includes(t.id)) return t;
    const d = Math.max(-t.start, delta);
    return {
      ...t,
      start: t.start + d,
      end: t.end + d,
      ...(t.words
        ? { words: t.words.map((w) => ({ ...w, start: w.start + d, end: w.end + d })) }
        : {}),
    };
  });
}
