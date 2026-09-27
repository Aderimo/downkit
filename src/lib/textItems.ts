// Düzenleyicideki yazılar (başlık, alt yazı): zaman çizelgesinde kendi satırında
// durur, dışa aktarımda FFmpeg drawtext ile görüntüye yazılır. Saf fonksiyonlar.

export interface TextItem {
  id: string;
  text: string;
  /** Zaman çizelgesi saniyesi. */
  start: number;
  end: number;
  /** Merkezin konumu (0–1, sol/üst = 0). */
  x: number;
  y: number;
  /** Yazı yüksekliği: görüntünün kısa kenarının oranı. */
  size: number;
  color: string;
  /** Arkasında yarı saydam siyah kutu. */
  box: boolean;
  bold: boolean;
}

/** Dışa aktarıma giden yazı: zamanlar çıktı saniyesi (boşluklar atlanmış). */
export interface TextOverlay {
  text: string;
  ranges: [number, number][];
  x: number;
  y: number;
  size: number;
  color: string;
  box: boolean;
  bold: boolean;
}

export const TEXT_COLORS = ["#ffffff", "#ffd43b", "#000000", "#ff5c5c", "#5b7cff", "#4ade80"];
export const MIN_TEXT_LENGTH = 0.3;
export const DEFAULT_TEXT_SECONDS = 3;
export const TEXT_SIZE = { min: 0.03, max: 0.2 };

export function newText(id: string, at: number, text: string): TextItem {
  return {
    id,
    text,
    start: Math.max(0, at),
    end: Math.max(0, at) + DEFAULT_TEXT_SECONDS,
    x: 0.5,
    y: 0.82,
    size: 0.07,
    color: "#ffffff",
    box: true,
    bold: true,
  };
}

function replace(texts: readonly TextItem[], id: string, next: (t: TextItem) => TextItem) {
  return texts.map((t) => (t.id === id ? next(t) : t));
}

/** Yazıyı `start` anına taşır (süresi değişmez). */
export function moveText(texts: readonly TextItem[], id: string, start: number): TextItem[] {
  return replace(texts, id, (t) => {
    const length = t.end - t.start;
    const s = Math.max(0, start);
    return { ...t, start: s, end: s + length };
  });
}

/** Başını ya da sonunu `time` anına çeker (en kısa MIN_TEXT_LENGTH). */
export function trimText(
  texts: readonly TextItem[],
  id: string,
  edge: "start" | "end",
  time: number,
): TextItem[] {
  return replace(texts, id, (t) =>
    edge === "start"
      ? { ...t, start: Math.min(Math.max(0, time), t.end - MIN_TEXT_LENGTH) }
      : { ...t, end: Math.max(time, t.start + MIN_TEXT_LENGTH) },
  );
}

export function updateText(
  texts: readonly TextItem[],
  id: string,
  patch: Partial<Omit<TextItem, "id">>,
): TextItem[] {
  return replace(texts, id, (t) => {
    const next = { ...t, ...patch };
    next.x = Math.min(1, Math.max(0, next.x));
    next.y = Math.min(1, Math.max(0, next.y));
    next.size = Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, next.size));
    return next;
  });
}

export function deleteTexts(texts: readonly TextItem[], ids: readonly string[]): TextItem[] {
  return texts.filter((t) => !ids.includes(t.id));
}

/** `t` anında görünen yazılar. */
export function textsAt(texts: readonly TextItem[], t: number): TextItem[] {
  return texts.filter((item) => t >= item.start && t < item.end && item.text.trim());
}

/** Zaman çizelgesi aralığı → çıktıdaki aralıklar. Parçalar (klipler ve siyah
 * boşluklar) uç uca eklenir; parçaların dışına düşen kısım çıktıda görünmez. */
export function outputRanges(
  pieces: readonly { tStart: number; tEnd: number }[],
  start: number,
  end: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  for (const s of pieces) {
    const a = Math.max(start, s.tStart);
    const b = Math.min(end, s.tEnd);
    if (b - a > 1e-6) {
      const from = offset + (a - s.tStart);
      const to = offset + (b - s.tStart);
      const last = ranges.at(-1);
      if (last && Math.abs(last[1] - from) < 1e-6) last[1] = to;
      else ranges.push([from, to]);
    }
    offset += s.tEnd - s.tStart;
  }
  return ranges;
}

/** Dışa aktarılacak parçalar için yazılar (çıktıda görünmeyenler atlanır). */
export function toOverlays(
  texts: readonly TextItem[],
  pieces: readonly { tStart: number; tEnd: number }[],
): TextOverlay[] {
  return texts
    .filter((t) => t.text.trim())
    .map((t) => ({
      text: t.text,
      ranges: outputRanges(pieces, t.start, t.end),
      x: t.x,
      y: t.y,
      size: t.size,
      color: t.color,
      box: t.box,
      bold: t.bold,
    }))
    .filter((o) => o.ranges.length > 0);
}
