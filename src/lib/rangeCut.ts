import type { EffectItem } from "./effectLane";
import type { BlurItem, ImageItem, MusicItem } from "./layers";
import { clipEnd, type SeqClip } from "./sequence";
import type { TextItem } from "./textItems";

// Zaman çizelgesinden aralık kesme (sessizlik, dolgu kelimesi, seçili cümle…): bütün
// izlerde o aralık çıkar ve sonrası sola kayar (ripple). Kliplerin ve videodan
// ayrılmış seslerin kaynak aralıkları bölünür; altyazıların kelimeleri, resimler ve
// gizleme bölgeleri aynı ölçüde kayar. Müzik kesilmez: yalnızca başladığı an kayar.

export interface TimeRange {
  start: number;
  end: number;
}

const EPS = 1e-6;
/** Kesimden sonra bundan kısa kalan parça atılır. */
const MIN_PIECE = 0.05;

/** Aralıkları sıralar, çakışanları birleştirir, boşları atar. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start > EPS)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export const rangesDuration = (ranges: readonly TimeRange[]) =>
  ranges.reduce((n, r) => n + (r.end - r.start), 0);

/** Kesimden sonra `t` anının yeni yeri (kesilen aralığın içindeyse aralığın başı). */
export function mapTime(ranges: readonly TimeRange[], t: number): number {
  let removed = 0;
  for (const r of ranges) {
    if (t <= r.start) break;
    removed += Math.min(t, r.end) - r.start;
  }
  return t - removed;
}

/** [a, b] aralığından kesilenler çıkınca kalan parçalar (zaman çizelgesi saniyesi). */
export function keptPieces(ranges: readonly TimeRange[], a: number, b: number): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = a;
  for (const r of ranges) {
    if (r.end <= cursor) continue;
    if (r.start >= b) break;
    if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, b) });
    cursor = Math.max(cursor, r.end);
    if (cursor >= b) break;
  }
  if (cursor < b) out.push({ start: cursor, end: b });
  return out.filter((p) => p.end - p.start >= MIN_PIECE);
}

/** Klibi böler: her kalan parça kendi kaynak aralığıyla, yeni yerine. */
function cutClip(clip: SeqClip, ranges: readonly TimeRange[], newId: () => string): SeqClip[] {
  const a = clip.start;
  const b = clipEnd(clip);
  const pieces = keptPieces(ranges, a, b);
  if (
    pieces.length === 1 &&
    Math.abs(pieces[0].start - a) < EPS &&
    Math.abs(pieces[0].end - b) < EPS
  ) {
    const start = mapTime(ranges, a);
    return [Math.abs(start - clip.start) < EPS ? clip : { ...clip, start }];
  }
  return pieces.map((p, i) => {
    const first = i === 0;
    const last = i === pieces.length - 1;
    const next: SeqClip = {
      ...clip,
      id: first ? clip.id : newId(),
      start: mapTime(ranges, p.start),
      srcStart: clip.srcStart + (p.start - a) * clip.speed,
      srcEnd: clip.srcStart + (p.end - a) * clip.speed,
    };
    // Açılma ilk parçada, kararma ve sonraki klibe geçiş son parçada kalır.
    if (!first) delete next.fadeIn;
    if (!last) {
      delete next.fadeOut;
      delete next.xfade;
    }
    return next;
  });
}

/** Videodan ayrılmış ses (hız 1): klip gibi bölünür, her parça kendi klibine bağlanır. */
function cutLinkedAudio(
  item: MusicItem,
  ranges: readonly TimeRange[],
  clips: readonly SeqClip[],
  newId: () => string,
): MusicItem[] {
  const a = item.start;
  const b = item.start + item.length;
  const pieces = keptPieces(ranges, a, b);
  return pieces.map((p, i) => {
    const start = mapTime(ranges, p.start);
    const length = p.end - p.start;
    // En çok örtüşen klip parçası bu sesin klibi olur.
    let link = item.linkedClipId;
    let best = 0;
    for (const c of clips) {
      const overlap = Math.min(clipEnd(c), start + length) - Math.max(c.start, start);
      if (overlap > best + EPS) {
        best = overlap;
        link = c.id;
      }
    }
    const next: MusicItem = {
      ...item,
      id: i === 0 ? item.id : newId(),
      start,
      srcStart: item.srcStart + (p.start - a),
      length,
      fadeIn: i === 0 ? Math.min(item.fadeIn, length / 2) : 0,
      fadeOut: i === pieces.length - 1 ? Math.min(item.fadeOut, length / 2) : 0,
    };
    if (link) next.linkedClipId = link;
    return next;
  });
}

/** Yazı: başı ve sonu kayar; kesilen yerdeki kelimeler düşer. Tamamı kesildiyse null. */
function cutText(item: TextItem, ranges: readonly TimeRange[]): TextItem | null {
  const start = mapTime(ranges, item.start);
  const end = mapTime(ranges, item.end);
  if (end - start < MIN_PIECE) return null;
  if (!item.words || item.words.length === 0) {
    return start === item.start && end === item.end ? item : { ...item, start, end };
  }
  const inside = (t: number) => ranges.some((r) => t > r.start + EPS && t < r.end - EPS);
  const words = item.words
    .filter((w) => !inside((w.start + w.end) / 2))
    .map((w) => ({ ...w, start: mapTime(ranges, w.start), end: mapTime(ranges, w.end) }));
  if (words.length === 0) return null;
  const changed = words.length !== item.words.length;
  return {
    ...item,
    start,
    end,
    words,
    ...(changed ? { text: words.map((w) => w.text).join(" ") } : {}),
  };
}

function cutSpan<T extends { start: number; end: number }>(
  item: T,
  ranges: readonly TimeRange[],
): T | null {
  const start = mapTime(ranges, item.start);
  const end = mapTime(ranges, item.end);
  if (end - start < MIN_PIECE) return null;
  return start === item.start && end === item.end ? item : { ...item, start, end };
}

export interface CutInput {
  clips: readonly SeqClip[];
  texts: readonly TextItem[];
  images: readonly ImageItem[];
  blurs: readonly BlurItem[];
  music: readonly MusicItem[];
  /** Efekt şeridi (yoksa boş sayılır). */
  effects?: readonly EffectItem[];
}

export interface CutResult {
  clips: SeqClip[];
  texts: TextItem[];
  images: ImageItem[];
  blurs: BlurItem[];
  music: MusicItem[];
  effects: EffectItem[];
  /** Toplam kesilen süre (saniye). */
  removed: number;
}

/** Ana izdeki (V1) klipler arasında ve başta kalan boşluklar (zaman çizelgesi aralığı). */
export function mainTrackGaps(clips: readonly SeqClip[]): TimeRange[] {
  const main = clips.filter((c) => c.track === 0).sort((a, b) => a.start - b.start);
  const gaps: TimeRange[] = [];
  let cursor = 0;
  for (const c of main) {
    if (c.start - cursor > 0.01) gaps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.start + (c.srcEnd - c.srcStart) / c.speed);
  }
  return gaps;
}

/** Aralıkları bütün izlerden keser (tek geri alma adımı olarak uygulanmak üzere). */
export function cutTimeline(
  input: CutInput,
  raw: readonly TimeRange[],
  newId: () => string,
): CutResult {
  const ranges = mergeRanges(raw);
  if (ranges.length === 0) {
    return {
      ...input,
      clips: [...input.clips],
      texts: [...input.texts],
      images: [...input.images],
      blurs: [...input.blurs],
      music: [...input.music],
      effects: [...(input.effects ?? [])],
      removed: 0,
    };
  }
  const clips = input.clips.flatMap((c) => cutClip(c, ranges, newId));
  const music = input.music.flatMap((m) => {
    if (m.linkedClipId) return cutLinkedAudio(m, ranges, clips, newId);
    const start = mapTime(ranges, m.start);
    return [start === m.start ? m : { ...m, start }];
  });
  return {
    clips,
    music,
    texts: input.texts.flatMap((t) => {
      const next = cutText(t, ranges);
      return next ? [next] : [];
    }),
    images: input.images.flatMap((i) => {
      const next = cutSpan(i, ranges);
      return next ? [next] : [];
    }),
    blurs: input.blurs.flatMap((b) => {
      const next = cutSpan(b, ranges);
      return next ? [next] : [];
    }),
    effects: (input.effects ?? []).flatMap((e) => {
      const next = cutSpan(e, ranges);
      return next ? [next] : [];
    }),
    removed: rangesDuration(ranges),
  };
}

// ——— Aralığı taşıma (metinden kurgu: cümleyi başka yere al) ———

/** Klibin [a, b] içinde kalan parçası; zamanı `a`ya göre (0'dan başlar). */
function sliceClip(c: SeqClip, a: number, b: number, id: string): SeqClip | null {
  const from = Math.max(a, c.start);
  const to = Math.min(b, clipEnd(c));
  if (to - from < MIN_PIECE) return null;
  const next: SeqClip = {
    ...c,
    id,
    start: from - a,
    srcStart: c.srcStart + (from - c.start) * c.speed,
    srcEnd: c.srcStart + (to - c.start) * c.speed,
  };
  if (from > c.start + EPS) delete next.fadeIn;
  if (to < clipEnd(c) - EPS) {
    delete next.fadeOut;
    delete next.xfade;
  }
  return next;
}

/** Videodan ayrılmış sesler en çok örtüştükleri klibe bağlanır (bölmelerden sonra). */
function relink(music: MusicItem[], clips: readonly SeqClip[]): MusicItem[] {
  return music.map((m) => {
    if (!m.linkedClipId) return m;
    let link = m.linkedClipId;
    let best = 0;
    for (const c of clips) {
      const overlap = Math.min(clipEnd(c), m.start + m.length) - Math.max(c.start, m.start);
      if (overlap > best + EPS) {
        best = overlap;
        link = c.id;
      }
    }
    return link === m.linkedClipId ? m : { ...m, linkedClipId: link };
  });
}

/** `t` anına `len` saniyelik boşluk açar: ondan sonrası sağa kayar, kesişen klip bölünür. */
function openGap(input: CutInput, t: number, len: number, newId: () => string): CutResult {
  const clips = input.clips.flatMap((c) => {
    if (c.start >= t - EPS) return [{ ...c, start: c.start + len }];
    if (clipEnd(c) <= t + EPS) return [c];
    const head = sliceClip(c, c.start, t, c.id);
    const tail = sliceClip(c, t, clipEnd(c), newId());
    return [
      ...(head ? [{ ...head, start: c.start }] : []),
      ...(tail ? [{ ...tail, start: t + len }] : []),
    ];
  });
  const music = input.music.flatMap((m) => {
    const end = m.start + m.length;
    if (m.start >= t - EPS) return [{ ...m, start: m.start + len }];
    if (!m.linkedClipId || end <= t + EPS) return [m];
    // Videodan ayrılmış ses klibi gibi bölünür.
    const first = t - m.start;
    return [
      { ...m, length: first, fadeOut: 0 },
      {
        ...m,
        id: newId(),
        start: t + len,
        srcStart: m.srcStart + first,
        length: end - t,
        fadeIn: 0,
      },
    ];
  });
  const shiftSpan = <T extends { start: number; end: number }>(x: T): T =>
    x.start >= t - EPS
      ? { ...x, start: x.start + len, end: x.end + len }
      : x.end > t + EPS
        ? { ...x, end: x.end + len }
        : x;
  const texts = input.texts.map((x) => {
    const moved = shiftSpan(x);
    if (moved === x || !x.words) return moved;
    return {
      ...moved,
      words: x.words.map((w) =>
        w.start >= t - EPS ? { ...w, start: w.start + len, end: w.end + len } : w,
      ),
    };
  });
  return {
    clips,
    music,
    texts,
    images: input.images.map(shiftSpan),
    blurs: input.blurs.map(shiftSpan),
    effects: (input.effects ?? []).map(shiftSpan),
    removed: 0,
  };
}

/**
 * Aralığı (ör. bir cümle) `target` anına taşır: önce bütün izlerden çıkarılır, sonra
 * hedefte boşluk açılıp yerleştirilir. Hedef aralığın içindeyse değişiklik yok.
 */
export function moveRange(
  input: CutInput,
  range: TimeRange,
  target: number,
  newId: () => string,
): CutResult {
  const a = range.start;
  const b = range.end;
  const len = b - a;
  if (len < MIN_PIECE || (target > a - EPS && target < b + EPS)) {
    return { ...cutTimeline(input, [], newId), removed: 0 };
  }
  // Taşınacak parçalar (0'dan başlayan zamanla).
  const ids = new Map<string, string>();
  const movedClips = input.clips.flatMap((c) => {
    const id = newId();
    const piece = sliceClip(c, a, b, id);
    if (!piece) return [];
    ids.set(c.id, id);
    return [piece];
  });
  const movedAudio = input.music.flatMap((m) => {
    if (!m.linkedClipId) return [];
    const from = Math.max(a, m.start);
    const to = Math.min(b, m.start + m.length);
    if (to - from < MIN_PIECE) return [];
    return [
      {
        ...m,
        id: newId(),
        start: from - a,
        srcStart: m.srcStart + (from - m.start),
        length: to - from,
        fadeIn: 0,
        fadeOut: 0,
        linkedClipId: ids.get(m.linkedClipId) ?? m.linkedClipId,
      },
    ];
  });
  // Ortası aralıkta olan yazılar cümleyle birlikte gider.
  const belongs = (x: TextItem) => {
    const mid = (x.start + x.end) / 2;
    return mid > a - EPS && mid < b + EPS;
  };
  const movedTexts = input.texts.filter(belongs).map((x) => ({
    ...x,
    start: Math.max(a, x.start) - a,
    end: Math.min(b, x.end) - a,
    ...(x.words
      ? {
          words: x.words
            .filter((w) => w.start >= a - EPS && w.end <= b + EPS)
            .map((w) => ({ ...w, start: w.start - a, end: w.end - a })),
        }
      : {}),
  }));
  const rest = cutTimeline(
    { ...input, texts: input.texts.filter((x) => !belongs(x)) },
    [range],
    newId,
  );
  const at = mapTime([range], target);
  const opened = openGap(rest, at, len, newId);
  const clips = [...opened.clips, ...movedClips.map((c) => ({ ...c, start: c.start + at }))];
  return {
    ...opened,
    clips,
    music: relink(
      [...opened.music, ...movedAudio.map((m) => ({ ...m, start: m.start + at }))],
      clips,
    ),
    texts: [
      ...opened.texts,
      ...movedTexts.map((x) => ({
        ...x,
        start: x.start + at,
        end: x.end + at,
        ...(x.words
          ? { words: x.words.map((w) => ({ ...w, start: w.start + at, end: w.end + at })) }
          : {}),
      })),
    ],
    removed: 0,
  };
}
