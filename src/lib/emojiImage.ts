import { emojiBox, emojiCode } from "./captionEmoji";
import type { ImageOverlayReq } from "./layers";
import { emojiImageWrite } from "./tauri-api";
import { outputRanges, type TextItem } from "./textItems";

// Renkli emoji: tuvalde sistemin renkli emoji yazı tipiyle PNG olarak çizilir.
// Önizleme bu resmi gösterir; dışa aktarmada aynı PNG önbelleğe yazılıp resim
// katmanı olarak bindirilir (FFmpeg'in altyazı çizicisi emojiyi tek renk çizer).

const SIZE = 256;
const FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const dataUrls = new Map<string, string>();
const filePaths = new Map<string, string>();

/** Emojinin PNG veri adresi (tuval yoksa null). Aynı emoji bir kez çizilir. */
export function emojiDataUrl(emoji: string): string | null {
  const cached = dataUrls.get(emoji);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let px = SIZE * 0.8;
  ctx.font = `${px}px ${FONT}`;
  const wide = ctx.measureText(emoji).width;
  if (wide > SIZE * 0.92) {
    px *= (SIZE * 0.92) / wide;
    ctx.font = `${px}px ${FONT}`;
  }
  // Çizilen şeklin kutusuna göre tam ortaya.
  const m = ctx.measureText(emoji);
  const left = m.actualBoundingBoxLeft || m.width / 2;
  const right = m.actualBoundingBoxRight || m.width / 2;
  const up = m.actualBoundingBoxAscent || px * 0.8;
  const down = m.actualBoundingBoxDescent || px * 0.2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(emoji, SIZE / 2 - (right - left) / 2, SIZE / 2 + (up - down) / 2);
  const url = canvas.toDataURL("image/png");
  dataUrls.set(emoji, url);
  return url;
}

/** Yazılardaki emojilerin PNG dosyaları (emoji → yol). Yazılamayan emoji atlanır. */
export async function prepareEmojiFiles(texts: readonly TextItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(texts.flatMap((t) => (t.emoji && t.text.trim() ? [t.emoji] : [])))];
  for (const emoji of wanted) {
    const known = filePaths.get(emoji);
    if (known) {
      out.set(emoji, known);
      continue;
    }
    const url = emojiDataUrl(emoji);
    if (!url) continue;
    try {
      const path = await emojiImageWrite(emojiCode(emoji), url.slice(url.indexOf(",") + 1));
      filePaths.set(emoji, path);
      out.set(emoji, path);
    } catch {
      // Emoji olmadan da dışa aktarılır.
    }
  }
  return out;
}

type Piece = { tStart: number; tEnd: number };

/**
 * Dışa aktarılacak emoji resimleri: yazının göründüğü çıktı aralıklarında, yazının
 * üstünde. Aynı emoji aynı yerdeyse tek resim katmanı olur (FFmpeg'e daha az giriş).
 */
export function emojiOverlays(
  texts: readonly TextItem[],
  pieces: readonly Piece[],
  frame: { width: number; height: number },
  files: ReadonlyMap<string, string>,
): ImageOverlayReq[] {
  const byKey = new Map<string, ImageOverlayReq>();
  for (const t of texts) {
    const path = t.emoji ? files.get(t.emoji) : undefined;
    if (!path || !t.text.trim()) continue;
    const ranges = outputRanges(pieces, t.start, t.end);
    if (ranges.length === 0) continue;
    const box = emojiBox(t, frame);
    const key = `${path}|${box.x.toFixed(4)}|${box.y.toFixed(4)}|${box.size.toFixed(4)}`;
    const found = byKey.get(key);
    if (found) found.ranges.push(...ranges);
    else byKey.set(key, { path, ranges: [...ranges], ...box, opacity: 1 });
  }
  return [...byKey.values()].map((o) => ({
    ...o,
    ranges: [...o.ranges].sort((a, b) => a[0] - b[0]),
  }));
}
