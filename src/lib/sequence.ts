// Klip Düzenleyici'nin zaman çizelgesi modeli:
// kaynak videonun parçaları (klipler) izlere yerleştirilir; bölünür, kırpılır,
// taşınır, hızlandırılır. Dışa aktarımda en üstteki iz görünür; klipler arasındaki
// boşluk siyah ekran olur (bkz. exportPieces).
// Hepsi saf fonksiyon; durum yönetimi `editorStore` içinde.

import type { AudioFx } from "./audioFx";
import type { Chapter } from "../types/media";
import { normalizeLook, type ClipLook } from "./clipLook";
import type { MotionId, TransitionStyle } from "./clipFx";
import { effectiveSeconds, type ClipXfade } from "./xfade";
import { seeThrough, type ClipTransform } from "./clipTransform";
import { zoomTransform, type ZoomSpan } from "./clipZoom";

export interface SeqClip {
  id: string;
  /** Aynı gruptaki klipler birlikte seçilir ve taşınır. */
  group?: string;
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
  /** Klip boyunca hareket (yakınlaştır, kaydır…) ve şiddeti; yoksa hareketsiz. */
  motion?: MotionId;
  motionStrength?: number;
  /** Başta/sonda geçiş stili (süreler fadeIn/fadeOut); yoksa kararma. */
  transition?: TransitionStyle;
  /** Bu klipten aynı izde hemen ardından gelen klibe geçiş (klipler arası). Klipler
   * bitişik değilse etkisizdir. */
  xfade?: ClipXfade;
  /** Sesteki fan/uğultu gürültüsü azaltılsın (dışa aktarımda). */
  denoise?: boolean;
  /** Ses onarımı: gürültü, rüzgâr, yankı, iyileştirme (dışa aktarmada; lib/audioFx). */
  audioFx?: AudioFx;
  /** Hareket bulanıklığı: hızlandırılmış ya da hareketli görüntüde kareler karışır
   * (yalnız dışa aktarmada). */
  motionBlur?: boolean;
  /** Dondurulmuş kare: kaynağın bu saniyesindeki kare klip boyunca durur (ses yok).
   * `srcStart`/`srcEnd` yalnızca süreyi verir. */
  freezeAt?: number;
  /** Ters oynatma: klip sondan başa oynar (görüntü ve ses). */
  reverse?: boolean;
  /** Konum, ölçek, döndürme, saydamlık (anahtar kareler kaynak saniyesiyle). Üst izde
   * alttakini açıkta bırakan klip onun üstüne bindirilir. */
  transform?: ClipTransform;
  /** Zamanlı yakınlaştırmalar (aralıklar kaynak saniyesiyle). */
  zooms?: ZoomSpan[];
}

/** İzin (katmanın) durumu: sessiz ya da gizli. */
export interface TrackState {
  muted?: boolean;
  hidden?: boolean;
  /** Kilitli izdeki klipler taşınamaz, kısaltılamaz. */
  locked?: boolean;
  /** Yalnızca ses izlerinde: bu iz yalnız dinlenir. */
  solo?: boolean;
}

/** İz numarası → durum. Kaydı olmayan iz açık ve sesli sayılır. */
export type TrackStates = Record<number, TrackState>;

/** Ses izlerinin (A1, A2…) durumları aynı tabloda bu sayıdan sonra tutulur. */
export const AUDIO_LANE_BASE = 100;
export const MAX_AUDIO_LANES = 4;

export const audioLaneKey = (lane: number) => AUDIO_LANE_BASE + lane;

/** Bir ses izi "yalnız dinle" (S) açık mı: o zaman yalnızca o izler duyulur. */
export function audioSoloActive(tracks: TrackStates): boolean {
  return Object.entries(tracks).some(
    ([key, state]) => Number(key) >= AUDIO_LANE_BASE && state?.solo,
  );
}

/** Ses izi duyulur mu: sessiz değil ve (yalnız dinleme yoksa ya da bu iz yalnız dinleniyorsa). */
export function audioLaneAudible(tracks: TrackStates, lane: number): boolean {
  const state = tracks[audioLaneKey(lane)];
  if (state?.muted) return false;
  return audioSoloActive(tracks) ? state?.solo === true : true;
}

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
  /** Parçanın klibinin zaman çizelgesindeki başı ve uzunluğu (hareket ilerlemesi için). */
  clipStart?: number;
  clipLength?: number;
  motion?: MotionId;
  motionStrength?: number;
  transition?: TransitionStyle;
  /** Bu parçadan bir sonrakine (bitişik) geçiş; süre iki parçaya sığdırılmış. */
  xfadeOut?: ClipXfade;
  denoise?: boolean;
  motionBlur?: boolean;
  audioFx?: AudioFx;
  freezeAt?: number;
  reverse?: boolean;
  transform?: ClipTransform;
  /** Yakınlaştırmaların kareleri (kaynak saniyesi): dönüşümden sonra, karenin tamamına. */
  zoom?: ClipTransform;
}

/** Alttaki görüntünün üstüne bindirilen parça (üst izdeki dönüşümlü klip). */
export interface OverlaySegment extends Segment {
  track: number;
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
  if (!clip.name.trim() && clip.freezeAt !== undefined) return `❄ ${clock(clip.freezeAt)}`;
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
/**
 * `t` anında görünen katmanlar: yukarıdan aşağı, alttakini açıkta bırakan (saydam,
 * küçük, kaymış, dönmüş) klipler bindirme olur; ilk örten klip ana görüntüdür. Altında
 * örten klip yoksa en alttaki klip ana görüntü olur (siyah zemin üstünde dönüşür).
 * Bindirmeler alttan üste sıralıdır.
 */
export function layersAt(
  clips: readonly SeqClip[],
  t: number,
): { base: SeqClip | null; overlays: SeqClip[] } {
  const here = clips.filter((c) => covers(c, t)).sort((a, b) => b.track - a.track);
  const overlays: SeqClip[] = [];
  for (const c of here) {
    if (!seeThrough(c.transform)) return { base: c, overlays: overlays.reverse() };
    overlays.push(c);
  }
  const base = overlays.pop() ?? null;
  return { base, overlays: overlays.reverse() };
}

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
  // Ters klipte zaman çizelgesindeki ilk parça kaynağın sonunu gösterir.
  if (clip.reverse) {
    const cut = clip.srcEnd - (t - clip.start) * clip.speed;
    return replace(clips, id, [
      { ...clip, srcStart: cut, fadeOut: 0, xfade: undefined },
      { ...clip, id: newId, start: t, srcEnd: cut, fadeIn: 0 },
    ]);
  }
  const cut = clip.srcStart + (t - clip.start) * clip.speed;
  // Açılma ilk parçada, kararma ve sonraki klibe geçiş son parçada kalır (bölme
  // noktasına istenmeyen geçiş gelmesin).
  return replace(clips, id, [
    { ...clip, srcEnd: cut, fadeOut: 0, xfade: undefined },
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
  // Ters klibin sol kenarı kaynağın sonudur: yalnız kısaltılır (kaynakta ileri uzatılmaz).
  if (clip.reverse) {
    const start = Math.min(Math.max(t, clip.start, min), clipEnd(clip) - MIN_CLIP_LENGTH);
    const srcEnd = clip.srcEnd - (start - clip.start) * clip.speed;
    return replace(clips, id, [{ ...clip, start, srcEnd }]);
  }
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
  // Ters klibin sağ kenarı kaynağın başıdır: kaynağın 0. saniyesine kadar uzar.
  if (clip.reverse) {
    const latest = Math.min(max, clip.start + clip.srcEnd / clip.speed);
    const end = Math.max(Math.min(t, latest), clip.start + MIN_CLIP_LENGTH);
    const srcStart = Math.max(0, clip.srcEnd - (end - clip.start) * clip.speed);
    return replace(clips, id, [{ ...clip, srcStart }]);
  }
  // Dondurulmuş karenin süresi kaynağın uzunluğuna bağlı değil.
  if (clip.freezeAt !== undefined) sourceDuration = Infinity;
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
  // Kopya özgün gruba katılmaz (ayarlar kopyaya da yayılmasın).
  const copy: SeqClip = { ...clip, id: newId, start: end };
  delete copy.group;
  return [...shifted, copy];
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
    const clip = layersAt(clips, (a + b) / 2).base;
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
        // Bir ses izi yalnız dinlenirken videonun kendi sesi de susar.
        volume: tracks[clip.track]?.muted || audioSoloActive(tracks) ? 0 : clipVolume(clip),
        fadeIn: Math.abs(a - clip.start) < EPS ? fadeIn : 0,
        fadeOut: atEnd,
        look: clip.look,
        fadeWhite: clip.fadeWhite,
        clipStart: clip.start,
        clipLength: clipLength(clip),
        motion: clip.motion,
        motionStrength: clip.motionStrength,
        transition: clip.transition,
        ...(clip.denoise ? { denoise: true } : {}),
        ...(clip.motionBlur ? { motionBlur: true } : {}),
        ...(clip.audioFx ? { audioFx: clip.audioFx } : {}),
        ...(clip.freezeAt !== undefined ? { freezeAt: clip.freezeAt } : {}),
        ...(clip.reverse ? { reverse: true } : {}),
        ...(clip.transform ? { transform: clip.transform } : {}),
        ...(clip.zooms?.length ? { zoom: zoomTransform(clip.zooms, clip.speed) } : {}),
      });
    }
  }
  linkXfades(segments, clips);
  return mirrorReversed(segments, clips);
}

/** Ters klibin parçası: zaman çizelgesindeki aralık kaynağın aynalanmış aralığını
 * gösterir (klibin sonu başta). Birleştirme ileri yönlü yapıldıktan sonra çevrilir. */
function mirrorReversed<T extends Segment>(segments: T[], clips: readonly SeqClip[]): T[] {
  for (const s of segments) {
    if (!s.reverse) continue;
    const clip = clips.find((c) => c.id === s.clipId);
    if (!clip) continue;
    s.srcStart = clip.srcEnd - (s.tEnd - clip.start) * clip.speed;
    s.srcEnd = clip.srcEnd - (s.tStart - clip.start) * clip.speed;
  }
  return segments;
}

/** Bindirilen parçalar (alttan üste, zamana göre): üst izdeki klibin altında başka
 * görüntü olduğu aralıklar. Açılma/kararma yalnız klibin gerçek başında/sonunda. */
export function overlaySegments(
  allClips: readonly SeqClip[],
  tracks: TrackStates = {},
): OverlaySegment[] {
  const clips = allClips.filter((c) => !tracks[c.track]?.hidden);
  if (!clips.some((c) => c.track > 0 && seeThrough(c.transform))) return [];
  const bounds = [...new Set(clips.flatMap((c) => [c.start, clipEnd(c)]))].sort((a, b) => a - b);
  const out: OverlaySegment[] = [];
  const open = new Map<string, OverlaySegment>();
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const [a, b] = [bounds[i], bounds[i + 1]];
    if (b - a < EPS) continue;
    for (const clip of layersAt(clips, (a + b) / 2).overlays) {
      const srcEnd = clip.srcStart + (b - clip.start) * clip.speed;
      const [fadeIn, fadeOut] = clipFades(clip);
      const atEnd = Math.abs(b - clipEnd(clip)) < EPS ? fadeOut : 0;
      const last = open.get(clip.id);
      if (last && Math.abs(last.tEnd - a) < EPS) {
        last.tEnd = b;
        last.srcEnd = srcEnd;
        last.fadeOut = atEnd;
        continue;
      }
      const segment: OverlaySegment = {
        clipId: clip.id,
        sourceId: clip.sourceId,
        track: clip.track,
        tStart: a,
        tEnd: b,
        srcStart: clip.srcStart + (a - clip.start) * clip.speed,
        srcEnd,
        speed: clip.speed,
        volume: tracks[clip.track]?.muted || audioSoloActive(tracks) ? 0 : clipVolume(clip),
        fadeIn: Math.abs(a - clip.start) < EPS ? fadeIn : 0,
        fadeOut: atEnd,
        look: clip.look,
        clipStart: clip.start,
        clipLength: clipLength(clip),
        motion: clip.motion,
        motionStrength: clip.motionStrength,
        ...(clip.denoise ? { denoise: true } : {}),
        ...(clip.motionBlur ? { motionBlur: true } : {}),
        ...(clip.audioFx ? { audioFx: clip.audioFx } : {}),
        ...(clip.freezeAt !== undefined ? { freezeAt: clip.freezeAt } : {}),
        ...(clip.reverse ? { reverse: true } : {}),
        ...(clip.transform ? { transform: clip.transform } : {}),
        ...(clip.zooms?.length ? { zoom: zoomTransform(clip.zooms, clip.speed) } : {}),
      };
      open.set(clip.id, segment);
      out.push(segment);
    }
  }
  return mirrorReversed(out, clips).sort((x, y) => x.track - y.track || x.tStart - y.tStart);
}

/** Klipler arası geçişler: parça klibin gerçek sonunda bitiyor ve sonraki parça
 * başka bir klibin gerçek başında hemen başlıyorsa geçiş o kesime oturur. Kesimin
 * iki yanındaki açılma/kararma kapanır (dışa aktarımdaki gibi). */
function linkXfades(segments: Segment[], clips: readonly SeqClip[]) {
  const byId = new Map(clips.map((c) => [c.id, c]));
  for (let i = 0; i < segments.length - 1; i += 1) {
    const a = segments[i];
    const b = segments[i + 1];
    const clipA = byId.get(a.clipId);
    const clipB = byId.get(b.clipId);
    if (!clipA?.xfade || !clipB || clipA.id === clipB.id) continue;
    if (Math.abs(b.tStart - a.tEnd) > EPS) continue;
    if (Math.abs(a.tEnd - clipEnd(clipA)) > EPS || Math.abs(b.tStart - clipB.start) > EPS) continue;
    const duration = effectiveSeconds(clipA.xfade, a.tEnd - a.tStart, b.tEnd - b.tStart);
    if (duration < 0.1) continue;
    a.xfadeOut = { kind: clipA.xfade.kind, duration };
    a.fadeOut = 0;
    b.fadeIn = 0;
  }
}

/** Kesimdeki geçiş: `t` anı bir geçişin içindeyse çıkan/giren parçalar ve
 * ilerleme (0–1). Geçiş kesimin iki yanına yarı yarıya yayılır. */
export function xfadeAt(
  segments: readonly Segment[],
  t: number,
): { out: Segment; in: Segment; progress: number; xfade: ClipXfade } | null {
  for (let i = 0; i < segments.length - 1; i += 1) {
    const a = segments[i];
    const x = a.xfadeOut;
    if (!x) continue;
    const half = x.duration / 2;
    if (t >= a.tEnd - half && t < a.tEnd + half) {
      return {
        out: a,
        in: segments[i + 1],
        progress: (t - (a.tEnd - half)) / x.duration,
        xfade: x,
      };
    }
  }
  return null;
}

/** Geçiş anında bir parçanın kaynak saniyesi: kesimin ötesine taşan kısım kaynağın
 * devamından (yoksa uçtaki kareden) gelir. */
export function handleSourceTime(segment: Segment, t: number, sourceDuration: number): number {
  const raw = segment.srcStart + (t - segment.tStart) * segment.speed;
  return Math.min(Math.max(raw, 0), Math.max(0, sourceDuration - 0.05));
}

/** Parçanın `t` anındaki ses kazancı ve görüntü görünürlüğü (geçişler dahil). */
export function segmentEffects(segment: Segment, t: number): { gain: number; opacity: number } {
  let visible = 1;
  if (segment.fadeIn > 0) visible = Math.min(visible, (t - segment.tStart) / segment.fadeIn);
  if (segment.fadeOut > 0) visible = Math.min(visible, (segment.tEnd - t) / segment.fadeOut);
  const fade = Math.min(1, Math.max(0, visible));
  // Özel geçiş stillerinde görüntü kararmaz (yalnızca ses yumuşar).
  const opacity = (segment.transition ?? "fade") === "fade" ? fade : 1;
  return { gain: segment.volume * fade, opacity };
}

export function segmentAt(segments: readonly Segment[], t: number): Segment | null {
  return segments.find((s) => t >= s.tStart - EPS && t < s.tEnd - EPS) ?? null;
}

/** `t` anından sonra başlayan ilk parça (boşlukta oynatma bir sonrakine atlar). */
export function nextSegment(segments: readonly Segment[], t: number): Segment | null {
  return segments.find((s) => s.tStart >= t - EPS) ?? null;
}

/** Zaman çizelgesindeki `t` anında gösterilen kaynak saniyesi (dondurulmuş karede sabit,
 * ters klipte sondan başa). */
export function sourceTimeAt(segment: Segment, t: number): number {
  if (segment.freezeAt !== undefined) return segment.freezeAt;
  if (segment.reverse) return segment.srcEnd - (t - segment.tStart) * segment.speed;
  return segment.srcStart + (t - segment.tStart) * segment.speed;
}

export function timelineTimeAt(segment: Segment, sourceTime: number): number {
  if (segment.freezeAt !== undefined) return segment.tStart;
  if (segment.reverse) return segment.tStart + (segment.srcEnd - sourceTime) / segment.speed;
  return segment.tStart + (sourceTime - segment.srcStart) / segment.speed;
}

/** Bu parça oynatıcının kendi akışıyla oynatılamaz (saat ilerler, kare elle gösterilir). */
export const isClockSegment = (s: Segment): boolean =>
  s.freezeAt !== undefined || s.reverse === true;

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
 * (siyah görüntü + sessizlik). */
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

/** Hız rampası: "slowmo" imleçteki anı yavaşlatır (öncesi ve sonrası klibin hızında);
 * "velocity" öncesini ve sonrasını hızlandırıp o anı yavaşlatır (oyun editlerindeki
 * vuruş anı). Klip üç parçaya bölünür; aynı izde sonraki klipler süre farkı kadar kayar. */
export type SpeedRamp = "slowmo" | "velocity";

export const RAMP = {
  slowmo: { half: 0.5, outer: null as number | null, middle: 0.3 },
  velocity: { half: 0.6, outer: 1.75, middle: 0.35 },
};

export function speedRamp(
  clips: readonly SeqClip[],
  id: string,
  t: number,
  kind: SpeedRamp,
  makeId: () => string,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip || t < clip.start - EPS || t > clipEnd(clip) + EPS) return [...clips];
  const preset = RAMP[kind];
  const at = clip.srcStart + (t - clip.start) * clip.speed;
  const a = Math.max(clip.srcStart, at - preset.half);
  const b = Math.min(clip.srcEnd, at + preset.half);
  if (b - a < 0.1) return [...clips];
  const outer = preset.outer ?? clip.speed;
  return replaceWithPieces(
    clips,
    clip,
    [
      { srcStart: clip.srcStart, srcEnd: a, speed: outer },
      { srcStart: a, srcEnd: b, speed: preset.middle },
      { srcStart: b, srcEnd: clip.srcEnd, speed: outer },
    ],
    makeId,
  );
}

/** Klibi aynı kaynakta art arda gelen, hızları farklı parçalarla değiştirir (hız
 * rampası, hız eğrisi). Çok kısa parçalar atlanır; açılma ilk, kararma ve klipler
 * arası geçiş son parçada kalır. Aynı izde sonraki klipler süre farkı kadar kayar. */
export function replaceWithPieces(
  clips: readonly SeqClip[],
  clip: SeqClip,
  pieces: readonly Pick<SeqClip, "srcStart" | "srcEnd" | "speed">[],
  makeId: () => string,
): SeqClip[] {
  const parts = pieces.filter((p) => p.srcEnd - p.srcStart >= 0.05);
  if (parts.length === 0) return [...clips];
  let start = clip.start;
  const built: SeqClip[] = parts.map((p, i) => {
    const first = i === 0;
    const last = i === parts.length - 1;
    const piece: SeqClip = {
      ...clip,
      ...p,
      speed: clampSpeed(p.speed),
      id: first ? clip.id : makeId(),
      start,
      fadeIn: first ? clip.fadeIn : 0,
      fadeOut: last ? clip.fadeOut : 0,
      xfade: last ? clip.xfade : undefined,
    };
    start = clipEnd(piece);
    return piece;
  });
  const delta = start - clipEnd(clip);
  return clips.flatMap((c) => {
    if (c.id === clip.id) return built;
    if (c.track === clip.track && c.start >= clipEnd(clip) - EPS) {
      return [{ ...c, start: Math.max(0, c.start + delta) }];
    }
    return [c];
  });
}

export const FREEZE_SECONDS = 2;
/** Ters oynatma bellekte kare biriktirir: en uzun bu kadar kaynak saniyesi. */
export const MAX_REVERSE_SECONDS = 10;

/** Klibin `t` anında gösterdiği kaynak saniyesi (dondurulmuş ve ters klip dahil). */
export function clipSourceAt(clip: SeqClip, t: number): number {
  if (clip.freezeAt !== undefined) return clip.freezeAt;
  const offset = (t - clip.start) * clip.speed;
  return clip.reverse ? clip.srcEnd - offset : clip.srcStart + offset;
}

/**
 * İmleçte dondurulmuş kare: klip `t` anından bölünür, araya o karenin `seconds` sürelik
 * hâli girer; aynı izde sonraki her şey bu süre kadar kayar. Görünüm ve dönüşüm korunur;
 * yakınlaştırma, hareket ve geçişler dondurulmuş kareye taşınmaz.
 */
export function insertFreeze(
  clips: readonly SeqClip[],
  id: string,
  t: number,
  seconds: number,
  makeId: () => string,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip || t < clip.start - EPS || t > clipEnd(clip) + EPS || seconds <= 0) return [...clips];
  const at = clipSourceAt(clip, Math.min(t, clipEnd(clip) - 1 / 30));
  const inside = t - clip.start >= MIN_CLIP_LENGTH && clipEnd(clip) - t >= MIN_CLIP_LENGTH;
  const insertAt = inside ? t : t - clip.start < clipEnd(clip) - t ? clip.start : clipEnd(clip);
  const split = inside ? splitClip(clips, id, t, makeId()) : [...clips];
  const shifted = split.map((c) =>
    c.track === clip.track && c.start >= insertAt - EPS ? { ...c, start: c.start + seconds } : c,
  );
  const frozen: SeqClip = {
    id: makeId(),
    sourceId: clip.sourceId,
    track: clip.track,
    start: insertAt,
    srcStart: at,
    srcEnd: at + seconds,
    speed: 1,
    name: "",
    freezeAt: at,
    ...(clip.look ? { look: clip.look } : {}),
    ...(clip.transform ? { transform: clip.transform } : {}),
  };
  return [...shifted, frozen];
}

/** Ters oynatmayı açar/kapatır; çok uzun klipte (bellek) açılmaz. */
export function setReverse(clips: readonly SeqClip[], id: string, on: boolean): SeqClip[] {
  return clips.map((c) => {
    if (c.id !== id || c.freezeAt !== undefined) return c;
    if (on && c.srcEnd - c.srcStart > MAX_REVERSE_SECONDS + EPS) return c;
    const out: SeqClip = { ...c, reverse: on ? true : undefined };
    if (!on) delete out.reverse;
    return out;
  });
}
