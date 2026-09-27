// Klip Düzenleyici'nin zaman çizelgesi modeli (Clipchamp benzeri, sade):
// kaynak videonun parçaları (klipler) izlere yerleştirilir; bölünür, kırpılır,
// taşınır, hızlandırılır. Dışa aktarımda en üstteki iz görünür; klipler arasındaki
// boşluk siyah ekran olur (bkz. exportPieces).
// Hepsi saf fonksiyon; durum yönetimi `editorStore` içinde.

import type { Chapter } from "../types/media";
import { isDefaultLook, normalizeLook, type ClipLook } from "./clipLook";

export interface SeqClip {
  id: string;
  /** Klibin geldiği kaynak (editorStore.sources kimliği); yoksa ilk kaynak. */
  sourceId?: string;
  /** 0 = ana iz; üstteki izler alttakinin üzerini örter. */
  track: number;
  /** Zaman çizelgesindeki başlangıç (saniye). */
  start: number;
  /** Kaynak videodaki giriş/çıkış (saniye). */
  srcStart: number;
  srcEnd: number;
  /** Oynatma hızı: 2 = iki kat hızlı (klip yarı sürer). */
  speed: number;
  name: string;
  /** Ses düzeyi: 0 = sessiz, 1 = olduğu gibi (yoksa 1). */
  volume?: number;
  /** Baştan açılma / sonda kararma (zaman çizelgesi saniyesi; yoksa 0). */
  fadeIn?: number;
  fadeOut?: number;
  /** Filtre, renk ayarları ve efektler (yoksa olduğu gibi). */
  look?: ClipLook;
  /** Açılma/kararma siyah yerine beyazdan ("Beyaza aç" geçişi). */
  fadeWhite?: boolean;
}

/** İzin (katmanın) durumu: sessiz ya da gizli (Clipchamp'taki iz düğmeleri). */
export interface TrackState {
  muted?: boolean;
  hidden?: boolean;
}

/** İz numarası → durum. Kaydı olmayan iz açık ve sesli sayılır. */
export type TrackStates = Record<number, TrackState>;

/** Dışa aktarılacak / oynatılacak kesintisiz parça. */
export interface Segment {
  clipId: string;
  /** Parçanın geldiği kaynak; yoksa ilk kaynak. */
  sourceId?: string;
  tStart: number;
  tEnd: number;
  srcStart: number;
  srcEnd: number;
  speed: number;
  volume: number;
  /** Parça klibin başındaysa klibin açılma süresi, değilse 0 (kararmada da). */
  fadeIn: number;
  fadeOut: number;
  look?: ClipLook;
  fadeWhite?: boolean;
}

export const MIN_SPEED = 0.25;
export const MAX_VOLUME = 2;
export const FADE_PRESETS = [0, 0.5, 1, 2];

export const clipVolume = (c: SeqClip): number => c.volume ?? 1;

/** Geçiş süreleri; ikisi toplam klip süresini aşamaz. */
export function clipFades(c: SeqClip): [number, number] {
  const half = clipLength(c) / 2;
  const clamp = (v: number | undefined) => Math.min(Math.max(v ?? 0, 0), half);
  return [clamp(c.fadeIn), clamp(c.fadeOut)];
}

export const hasEffects = (c: SeqClip): boolean =>
  c.speed !== 1 || clipVolume(c) !== 1 || clipFades(c).some((f) => f > 0) || !isDefaultLook(c.look);
export const MAX_SPEED = 4;
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Bir klip zaman çizelgesinde en az bu kadar sürer (saniye). */
export const MIN_CLIP_LENGTH = 0.2;
export const MAX_TRACKS = 3;
const EPS = 1e-6;

export const clipLength = (c: SeqClip): number => (c.srcEnd - c.srcStart) / c.speed;
export const clipEnd = (c: SeqClip): number => c.start + clipLength(c);

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Klibin görünen adı: verilmişse o, yoksa kaynaktaki aralık ("1:24–2:03").
 * Numara yerine aralık: klip taşınınca ya da sıralama değişince değişmez. */
export function clipLabel(clip: SeqClip): string {
  return clip.name.trim() || `${clock(clip.srcStart)}–${clock(clip.srcEnd)}`;
}

export function clampSpeed(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

/** Kaynağın tamamı ana izde tek klip. */
export function initialClips(duration: number, id: string, sourceId?: string): SeqClip[] {
  return [{ id, sourceId, track: 0, start: 0, srcStart: 0, srcEnd: duration, speed: 1, name: "" }];
}

export function sequenceEnd(clips: readonly SeqClip[]): number {
  return clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
}

function covers(c: SeqClip, t: number): boolean {
  return t >= c.start - EPS && t < clipEnd(c) - EPS;
}

/** `t` anındaki en üst klip. */
export function clipAt(clips: readonly SeqClip[], t: number): SeqClip | null {
  let best: SeqClip | null = null;
  for (const c of clips) {
    if (covers(c, t) && (!best || c.track > best.track)) best = c;
  }
  return best;
}

function replace(clips: readonly SeqClip[], id: string, next: SeqClip[]): SeqClip[] {
  return clips.flatMap((c) => (c.id === id ? next : [c]));
}

function sameTrack(clips: readonly SeqClip[], clip: SeqClip): SeqClip[] {
  return clips.filter((c) => c.track === clip.track && c.id !== clip.id);
}

/** Klibi `t` anından ikiye böler. Kenara çok yakınsa değişiklik olmaz. */
export function splitClip(
  clips: readonly SeqClip[],
  id: string,
  t: number,
  newId: string,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  if (t - clip.start < MIN_CLIP_LENGTH || clipEnd(clip) - t < MIN_CLIP_LENGTH) return [...clips];
  const cut = clip.srcStart + (t - clip.start) * clip.speed;
  // Açılma ilk parçada, kararma son parçada kalır.
  return replace(clips, id, [
    { ...clip, srcEnd: cut, fadeOut: 0 },
    { ...clip, id: newId, start: t, srcStart: cut, fadeIn: 0 },
  ]);
}

/** Seçili klipler `t` anını kapsıyorsa onları, yoksa `t` anındaki tüm klipleri böler. */
export function splitAt(
  clips: readonly SeqClip[],
  t: number,
  selected: readonly string[],
  makeId: () => string,
): SeqClip[] {
  const selectedHere = clips.filter((c) => selected.includes(c.id) && covers(c, t));
  const targets = selectedHere.length > 0 ? selectedHere : clips.filter((c) => covers(c, t));
  return targets.reduce((acc, c) => splitClip(acc, c.id, t, makeId()), [...clips]);
}

/** Kaynaktaki `sourceTime` anının içinde bulunduğu bölüm. */
export function chapterAt(chapters: readonly Chapter[], sourceTime: number): Chapter | null {
  let found: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.start <= sourceTime + 1e-3 && sourceTime < chapter.end) found = chapter;
  }
  return found;
}

/** Kaynak anının zaman çizelgesindeki yeri: onu içeren en soldaki klipte.
 * Kaynağın o kısmı silindiyse null. `sourceId` verilirse yalnızca o kaynağın
 * klipleri aranır (çoklu kaynakta aynı anlar çakışmasın). */
export function timelineTimeOfSource(
  clips: readonly SeqClip[],
  sourceTime: number,
  sourceId?: string,
): number | null {
  const holder = [...clips]
    .filter((c) => sourceId === undefined || c.sourceId === undefined || c.sourceId === sourceId)
    .sort((a, b) => a.start - b.start || a.track - b.track)
    .find((c) => sourceTime >= c.srcStart - 1e-3 && sourceTime < c.srcEnd - EPS);
  return holder ? holder.start + Math.max(0, sourceTime - holder.srcStart) / holder.speed : null;
}

/** Klipleri bölüm başlangıçlarından böler; adı olmayan parçalar başladıkları
 * bölümün adını alır. Sonra istenmeyen bölümler tek tıkla silinebilir.
 * `sourceId` verilirse yalnızca o kaynağın klipleri bölünür. */
export function splitAtChapters(
  clips: readonly SeqClip[],
  chapters: readonly Chapter[],
  makeId: () => string,
  sourceId?: string,
): SeqClip[] {
  const ofSource = (c: SeqClip) =>
    sourceId === undefined || c.sourceId === undefined || c.sourceId === sourceId;
  let result = [...clips];
  for (const chapter of chapters) {
    for (const clip of [...result]) {
      if (!ofSource(clip)) continue;
      if (chapter.start > clip.srcStart + EPS && chapter.start < clip.srcEnd - EPS) {
        const t = clip.start + (chapter.start - clip.srcStart) / clip.speed;
        result = splitClip(result, clip.id, t, makeId());
      }
    }
  }
  return result.map((clip) => {
    if (clip.name.trim() || !ofSource(clip)) return clip;
    const title = chapterAt(chapters, clip.srcStart)?.title.trim();
    return title ? { ...clip, name: title } : clip;
  });
}

/** Aynı izdeki komşuların bıraktığı boşluk: [öncekinin sonu, sonrakinin başı]. */
function freeRange(clips: readonly SeqClip[], clip: SeqClip): [number, number] {
  let min = 0;
  let max = Infinity;
  for (const other of sameTrack(clips, clip)) {
    if (clipEnd(other) <= clip.start + EPS) min = Math.max(min, clipEnd(other));
    else if (other.start >= clipEnd(clip) - EPS) max = Math.min(max, other.start);
  }
  return [min, max];
}

/** Sol kenarı `t` anına taşır (kısaltır ya da kaynakta geriye uzatır). */
export function trimStart(clips: readonly SeqClip[], id: string, t: number): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const [min] = freeRange(clips, clip);
  const earliest = Math.max(min, clip.start - clip.srcStart / clip.speed);
  const latest = clipEnd(clip) - MIN_CLIP_LENGTH;
  const start = Math.min(Math.max(t, earliest), latest);
  const srcStart = Math.max(0, clip.srcStart + (start - clip.start) * clip.speed);
  return replace(clips, id, [{ ...clip, start, srcStart }]);
}

/** Sağ kenarı `t` anına taşır; kaynağın sonunu ve sonraki klibi geçemez. */
export function trimEnd(
  clips: readonly SeqClip[],
  id: string,
  t: number,
  sourceDuration: number,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const [, max] = freeRange(clips, clip);
  const latest = Math.min(max, clip.start + (sourceDuration - clip.srcStart) / clip.speed);
  const end = Math.max(Math.min(t, latest), clip.start + MIN_CLIP_LENGTH);
  const srcEnd = Math.min(sourceDuration, clip.srcStart + (end - clip.start) * clip.speed);
  return replace(clips, id, [{ ...clip, srcEnd }]);
}

/** İzdeki boş aralıklar ([başlangıç, bitiş]); sonuncusu sonsuza uzanır. */
function gaps(clips: readonly SeqClip[], track: number, excludeId: string): [number, number][] {
  const others = clips
    .filter((c) => c.track === track && c.id !== excludeId)
    .sort((a, b) => a.start - b.start);
  const result: [number, number][] = [];
  let cursor = 0;
  for (const c of others) {
    if (c.start > cursor + EPS) result.push([cursor, c.start]);
    cursor = Math.max(cursor, clipEnd(c));
  }
  result.push([cursor, Infinity]);
  return result;
}

/** Klibi izde `start` anına taşır; başka bir klibin üzerine binmesin diye
 * istenen yere en yakın boşluğa yerleştirir. */
export function moveClip(
  clips: readonly SeqClip[],
  id: string,
  start: number,
  track: number,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const targetTrack = Math.min(Math.max(track, 0), MAX_TRACKS - 1);
  const length = clipLength(clip);
  let best = Math.max(0, start);
  let bestDistance = Infinity;
  for (const [from, to] of gaps(clips, targetTrack, id)) {
    if (to - from < length - EPS) continue;
    const placed = Math.min(Math.max(start, from), to - length);
    const distance = Math.abs(placed - start);
    if (distance < bestDistance) {
      best = placed;
      bestDistance = distance;
    }
  }
  return replace(clips, id, [{ ...clip, start: Math.max(0, best), track: targetTrack }]);
}

/** Hızı değiştirir. Klip uzarsa aynı izde arkasından gelenler ileri itilir. */
export function setSpeed(clips: readonly SeqClip[], id: string, speed: number): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const updated = { ...clip, speed: clampSpeed(speed) };
  let result = replace(clips, id, [updated]);
  const oldEnd = clipEnd(clip);
  const push = clipEnd(updated) - oldEnd;
  if (push > EPS) {
    const followers = result
      .filter((c) => c.track === clip.track && c.id !== id && c.start >= oldEnd - EPS)
      .sort((a, b) => a.start - b.start);
    let limit = clipEnd(updated);
    for (const f of followers) {
      if (f.start >= limit - EPS) break;
      const shifted = { ...f, start: limit };
      result = replace(result, f.id, [shifted]);
      limit = clipEnd(shifted);
    }
  }
  return result;
}

/** Ses düzeyi (0 = sessiz). */
export function setVolume(
  clips: readonly SeqClip[],
  ids: readonly string[],
  volume: number,
): SeqClip[] {
  const v = Math.min(MAX_VOLUME, Math.max(0, Math.round(volume * 100) / 100));
  return clips.map((c) => (ids.includes(c.id) ? { ...c, volume: v } : c));
}

/** Seçili kliplerin görünümünü değiştirir (filtre, renk, efekt). */
export function setLook(
  clips: readonly SeqClip[],
  ids: readonly string[],
  patch: Partial<ClipLook>,
): SeqClip[] {
  return clips.map((c) =>
    ids.includes(c.id) ? { ...c, look: normalizeLook({ ...normalizeLook(c.look), ...patch }) } : c,
  );
}

/** Açılma/kararma rengi: siyah ya da beyaz. */
export function setFadeWhite(
  clips: readonly SeqClip[],
  ids: readonly string[],
  white: boolean,
): SeqClip[] {
  return clips.map((c) => (ids.includes(c.id) ? { ...c, fadeWhite: white } : c));
}

/** Baştan açılma ya da sonda kararma süresi. */
export function setFade(
  clips: readonly SeqClip[],
  id: string,
  edge: "in" | "out",
  seconds: number,
): SeqClip[] {
  const value = Math.max(0, seconds);
  return clips.map((c) =>
    c.id === id ? { ...c, [edge === "in" ? "fadeIn" : "fadeOut"]: value } : c,
  );
}

export type TransitionKind = "fadeBlack" | "fadeWhite" | "fadeIn" | "fadeOut";
/** Geçişin bırakıldığı yer: klibin başı, sonu ya da (ortaya bırakılınca) iki ucu. */
export type TransitionEdge = "start" | "end" | "both";

/** Bitişik sayılma payı: bölünmüş iki klibin arası kayan noktadan tam sıfır olmayabilir. */
const TOUCH = 0.05;

/** Geçişi klibin istenen ucuna uygular. Uçta aynı izde bitişik bir klip varsa
 * (ör. S ile bölünen yer) kararma/beyaza açılma iki klibe birden uygulanır: soldaki
 * kararır, sağdaki açılır; geçiş tam kesimden geçer. "Yumuşak başlangıç" kesimden
 * sonra başlayan klibe, "Yumuşak bitiş" kesimden önce biten klibe eklenir. */
export function applyTransitionAt(
  clips: readonly SeqClip[],
  id: string,
  kind: TransitionKind,
  edge: TransitionEdge,
  seconds: number,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const prev = clips.find(
    (c) => c.id !== id && c.track === clip.track && Math.abs(clipEnd(c) - clip.start) < TOUCH,
  );
  const next = clips.find(
    (c) => c.id !== id && c.track === clip.track && Math.abs(c.start - clipEnd(clip)) < TOUCH,
  );
  const changes = new Map<string, Partial<SeqClip>>();
  const add = (target: SeqClip, patch: Partial<SeqClip>) =>
    changes.set(target.id, { ...changes.get(target.id), ...patch });
  const color =
    kind === "fadeWhite" ? { fadeWhite: true } : kind === "fadeBlack" ? { fadeWhite: false } : {};

  if (kind === "fadeIn") {
    add(edge === "end" && next ? next : clip, { fadeIn: seconds });
  } else if (kind === "fadeOut") {
    add(edge === "start" && prev ? prev : clip, { fadeOut: seconds });
  } else if (edge === "start") {
    add(clip, { fadeIn: seconds, ...color });
    if (prev) add(prev, { fadeOut: seconds, ...color });
  } else if (edge === "end") {
    add(clip, { fadeOut: seconds, ...color });
    if (next) add(next, { fadeIn: seconds, ...color });
  } else {
    add(clip, { fadeIn: seconds, fadeOut: seconds, ...color });
  }
  return clips.map((c) => {
    const patch = changes.get(c.id);
    return patch ? { ...c, ...patch } : c;
  });
}

export function deleteClips(clips: readonly SeqClip[], ids: readonly string[]): SeqClip[] {
  return clips.filter((c) => !ids.includes(c.id));
}

/** Seçili olanlar dışındaki bütün klipleri siler ("yalnızca bunu tut"). */
export function keepOnly(clips: readonly SeqClip[], ids: readonly string[]): SeqClip[] {
  return clips.filter((c) => ids.includes(c.id));
}

/** Klibin kopyasını hemen arkasına koyar; aynı izde arkadakiler ileri kayar. */
export function duplicateClip(clips: readonly SeqClip[], id: string, newId: string): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  const length = clipLength(clip);
  const end = clipEnd(clip);
  const shifted = clips.map((c) =>
    c.track === clip.track && c.id !== id && c.start >= end - EPS
      ? { ...c, start: c.start + length }
      : c,
  );
  return [...shifted, { ...clip, id: newId, start: end }];
}

/** Her izdeki boşlukları kapatır: klipler sırasıyla uç uca dizilir. */
export function closeGaps(clips: readonly SeqClip[]): SeqClip[] {
  const byTrack = new Map<number, SeqClip[]>();
  for (const c of clips) byTrack.set(c.track, [...(byTrack.get(c.track) ?? []), c]);
  const result: SeqClip[] = [];
  for (const list of byTrack.values()) {
    let cursor = 0;
    for (const c of [...list].sort((a, b) => a.start - b.start)) {
      result.push({ ...c, start: cursor });
      cursor += clipLength(c);
    }
  }
  return result;
}

/** Zaman çizelgesini oynatılacak/dışa aktarılacak parçalara indirger: her anda
 * en üstteki görünür klip oynar (gizli izler atlanır, sessiz izin sesi kısılır);
 * klip olmayan yer boşluk kalır. Aynı klibin ardışık parçaları birleşir. */
export function flatten(allClips: readonly SeqClip[], tracks: TrackStates = {}): Segment[] {
  const clips = allClips.filter((c) => !tracks[c.track]?.hidden);
  const bounds = [...new Set(clips.flatMap((c) => [c.start, clipEnd(c)]))].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const [a, b] = [bounds[i], bounds[i + 1]];
    if (b - a < EPS) continue;
    const clip = clipAt(clips, (a + b) / 2);
    if (!clip) continue;
    const srcStart = clip.srcStart + (a - clip.start) * clip.speed;
    const srcEnd = clip.srcStart + (b - clip.start) * clip.speed;
    const [fadeIn, fadeOut] = clipFades(clip);
    // Geçiş yalnızca klibin gerçek başında/sonunda (üst katmanın böldüğü yerde değil).
    const atEnd = Math.abs(b - clipEnd(clip)) < EPS ? fadeOut : 0;
    const last = segments.at(-1);
    if (last && last.clipId === clip.id && Math.abs(last.tEnd - a) < EPS) {
      last.tEnd = b;
      last.srcEnd = srcEnd;
      last.fadeOut = atEnd;
    } else {
      segments.push({
        clipId: clip.id,
        sourceId: clip.sourceId,
        tStart: a,
        tEnd: b,
        srcStart,
        srcEnd,
        speed: clip.speed,
        volume: tracks[clip.track]?.muted ? 0 : clipVolume(clip),
        fadeIn: Math.abs(a - clip.start) < EPS ? fadeIn : 0,
        fadeOut: atEnd,
        look: clip.look,
        fadeWhite: clip.fadeWhite,
      });
    }
  }
  return segments;
}

/** Parçanın `t` anındaki ses kazancı ve görüntü görünürlüğü (geçişler dahil). */
export function segmentEffects(segment: Segment, t: number): { gain: number; opacity: number } {
  let visible = 1;
  if (segment.fadeIn > 0) visible = Math.min(visible, (t - segment.tStart) / segment.fadeIn);
  if (segment.fadeOut > 0) visible = Math.min(visible, (segment.tEnd - t) / segment.fadeOut);
  const opacity = Math.min(1, Math.max(0, visible));
  return { gain: segment.volume * opacity, opacity };
}

/** Dışa aktarılacak toplam süre (boşluklar hariç). */
export function outputDuration(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.tEnd - s.tStart), 0);
}

export function segmentAt(segments: readonly Segment[], t: number): Segment | null {
  return segments.find((s) => t >= s.tStart - EPS && t < s.tEnd - EPS) ?? null;
}

/** `t` anından sonra başlayan ilk parça (boşlukta oynatma bir sonrakine atlar). */
export function nextSegment(segments: readonly Segment[], t: number): Segment | null {
  return segments.find((s) => s.tStart >= t - EPS) ?? null;
}

export function sourceTimeAt(segment: Segment, t: number): number {
  return segment.srcStart + (t - segment.tStart) * segment.speed;
}

export function timelineTimeAt(segment: Segment, sourceTime: number): number {
  return segment.tStart + (sourceTime - segment.srcStart) / segment.speed;
}

/** `t`'yi en yakın aday ana (klip kenarları, oynatma imleci, 0) yapıştırır. */
export function snap(t: number, candidates: readonly number[], tolerance: number): number {
  let best = t;
  let distance = tolerance;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= distance) {
      best = c;
      distance = d;
    }
  }
  return best;
}

export function snapCandidates(
  clips: readonly SeqClip[],
  excludeId: string | null,
  playhead: number,
): number[] {
  return [
    0,
    playhead,
    ...clips.filter((c) => c.id !== excludeId).flatMap((c) => [c.start, clipEnd(c)]),
  ];
}

/** Dışa aktarılacak parça: bir klip bölümü ya da klipler arasındaki boşluk
 * (siyah görüntü + sessizlik, Clipchamp'taki gibi). */
export type ExportPiece =
  | { kind: "clip"; tStart: number; tEnd: number; segment: Segment }
  | { kind: "gap"; tStart: number; tEnd: number };

/** Parçalar ve aralarındaki boşluklar zaman sırasıyla. `leadingGap`: ilk klip
 * 0'dan sonra başlıyorsa baştaki boşluk da siyah olur. Son klipten sonrası
 * (zaman çizelgesinin boş kuyruğu) dışa aktarılmaz. */
export function exportPieces(segments: readonly Segment[], leadingGap = true): ExportPiece[] {
  const pieces: ExportPiece[] = [];
  let cursor = leadingGap ? 0 : (segments[0]?.tStart ?? 0);
  for (const segment of segments) {
    if (segment.tStart - cursor > 0.01) {
      pieces.push({ kind: "gap", tStart: cursor, tEnd: segment.tStart });
    }
    pieces.push({ kind: "clip", tStart: segment.tStart, tEnd: segment.tEnd, segment });
    cursor = segment.tEnd;
  }
  return pieces;
}

/** Parçaların toplam süresi (boşluklar dahil). */
export function piecesDuration(pieces: readonly ExportPiece[]): number {
  return pieces.reduce((sum, p) => sum + (p.tEnd - p.tStart), 0);
}
