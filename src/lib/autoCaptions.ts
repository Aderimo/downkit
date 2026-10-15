// Otomatik altyazı: konuşma bilgisayarda yazıya dökülür (Rust `commands::captions`),
// kelimeler satırlara ya da tek tek kelimelere bölünüp zaman çizelgesine yazı olarak
// eklenir. Bölme ve zaman eşleme saf fonksiyonlar.

import type { TextItem } from "./textItems";

export interface CaptionWord {
  text: string;
  /** Kaynak saniyesi. */
  start: number;
  end: number;
  /** Anahtar kelime (yeniden bölünce korunur). */
  emph?: boolean;
}

export type CaptionMode = "line" | "word";

/** Bir satır en fazla bu kadar kelime ve süre; noktalama ya da uzun duraksamada biter. */
const LINE_WORDS = 5;
const LINE_SECONDS = 2.8;
const PAUSE_SECONDS = 0.6;
const MIN_SECONDS = 0.35;

export interface CaptionChunk {
  text: string;
  start: number;
  end: number;
  /** Satırdaki kelimeler ve zamanları (konuşulan kelimenin vurgusu için). */
  words: CaptionWord[];
}

/** Kelimeleri satırlara (ya da tek kelimelere) böler; aradaki küçük boşluklar kapanır
 * ki altyazı göz kırpmasın. */
export function groupWords(
  words: readonly CaptionWord[],
  mode: CaptionMode,
  maxWords = LINE_WORDS,
): CaptionChunk[] {
  const sorted = [...words]
    .filter((w) => w.text.trim() && Number.isFinite(w.start) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const chunks: CaptionChunk[] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.map((w) => w.text.trim()).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current.map((w) => ({
        text: w.text.trim(),
        start: w.start,
        end: w.end,
        ...(w.emph ? { emph: true } : {}),
      })),
    });
    current = [];
  };
  for (const word of sorted) {
    if (mode === "word") {
      current = [word];
      flush();
      continue;
    }
    const last = current[current.length - 1];
    const tooLong =
      current.length >= Math.max(1, maxWords) ||
      (current[0] && word.end - current[0].start > LINE_SECONDS);
    const paused = last && word.start - last.end > PAUSE_SECONDS;
    if (tooLong || paused) flush();
    current.push(word);
    if (/[.!?…]$/.test(word.text.trim())) flush();
  }
  flush();
  // Ardışık parçalar arasındaki kısa boşluk kapanır; çok kısa parçalar uzatılır.
  for (let i = 0; i < chunks.length; i += 1) {
    const next = chunks[i + 1];
    const c = chunks[i];
    if (next && next.start - c.end < 0.3) c.end = next.start;
    if (c.end - c.start < MIN_SECONDS)
      c.end = next ? Math.min(next.start, c.start + MIN_SECONDS) : c.start + MIN_SECONDS;
  }
  return chunks;
}

interface ClipLike {
  sourceId?: string;
  start: number;
  srcStart: number;
  srcEnd: number;
  speed: number;
  /** Donmuş kare ya da ters oynayan parça: konuşma duyulmaz, altyazı yazılmaz. */
  still?: boolean;
}

/** Kaynağın zaman çizelgesinde kullanılan bölümleri (çakışanlar birleşir). */
export function usedRanges(
  clips: readonly ClipLike[],
  sourceId: string,
  firstSourceId: string | undefined,
): { start: number; end: number }[] {
  const ranges = clips
    .filter((c) => (c.sourceId ?? firstSourceId) === sourceId && !c.still)
    .map((c) => ({ start: c.srcStart, end: c.srcEnd }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.5) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Kaynak saniyesindeki parçayı, onu içeren her klipte zaman çizelgesi saniyesine çevirir. */
export function placeChunks(
  chunks: readonly CaptionChunk[],
  clips: readonly ClipLike[],
  sourceId: string,
  firstSourceId: string | undefined,
): CaptionChunk[] {
  const out: CaptionChunk[] = [];
  for (const c of clips) {
    if ((c.sourceId ?? firstSourceId) !== sourceId || c.still) continue;
    for (const chunk of chunks) {
      // Klibin başında kesilen satırın klipte kalan kelimeleri de yazılır.
      if (chunk.end <= c.srcStart + 0.05 || chunk.start >= c.srcEnd) continue;
      const start = c.start + (Math.max(chunk.start, c.srcStart) - c.srcStart) / c.speed;
      const end = c.start + (Math.min(chunk.end, c.srcEnd) - c.srcStart) / c.speed;
      if (end - start > 0.1) {
        // Kelimeler de zaman çizelgesine çevrilir; klibin dışına düşenler atlanır.
        const words = chunk.words
          .filter((w) => w.end > c.srcStart && w.start < c.srcEnd)
          .map((w) => ({
            text: w.text,
            start: c.start + (Math.max(w.start, c.srcStart) - c.srcStart) / c.speed,
            end: c.start + (Math.min(w.end, c.srcEnd) - c.srcStart) / c.speed,
          }));
        out.push({ text: words.map((w) => w.text).join(" ") || chunk.text, start, end, words });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Altyazı görünümü: satırda altta beyaz konturlu; kelime kelimede ortada büyük sarı. */
export function captionStyle(
  mode: CaptionMode,
): Pick<TextItem, "x" | "y" | "size" | "color" | "box" | "bold" | "style" | "anim"> {
  return mode === "word"
    ? {
        x: 0.5,
        y: 0.68,
        size: 0.1,
        color: "#ffd43b",
        box: false,
        bold: true,
        style: "outline",
        anim: "pop",
      }
    : {
        x: 0.5,
        y: 0.8,
        size: 0.06,
        color: "#ffffff",
        box: false,
        bold: true,
        style: "outline",
        anim: "none",
      };
}
