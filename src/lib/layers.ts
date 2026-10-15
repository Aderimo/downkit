// Düzenleyicide yazıların dışındaki katmanlar: üste bindirilen resimler (logo,
// çıkartma) ve müzik izleri. Saf fonksiyonlar; durum `editorStore` içinde.

import { outputRanges } from "./textItems";
import { audioLaneAudible, MAX_AUDIO_LANES, type TrackStates } from "./sequence";

export interface ImageItem {
  id: string;
  path: string;
  name: string;
  /** Zaman çizelgesi saniyesi. */
  start: number;
  end: number;
  /** Merkezin konumu (0–1). */
  x: number;
  y: number;
  /** Genişlik: çıkış karesinin genişliğine oranı. */
  size: number;
  opacity: number;
  /** Uygulamanın çizdiği çıkartma (kullanıcının logosu değil). */
  sticker?: boolean;
  /** Hareketli başlık: dosya bu seçimden çizilmiş saydam videodur (.webm). */
  motion?: MotionSpec;
}

/** Hareketli başlık seçimi: şablon, denetim değerleri (sırayla), arka plan. */
export interface MotionSpec {
  template: string;
  values: string[];
  background: boolean;
}

export function parseMotionSpec(raw: unknown): MotionSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.template !== "string" || !r.template) return undefined;
  const values = Array.isArray(r.values)
    ? r.values.filter((v): v is string => typeof v === "string").slice(0, 12)
    : [];
  return { template: r.template, values, background: r.background === true };
}

export interface MusicItem {
  id: string;
  path: string;
  name: string;
  /** Zaman çizelgesinde başladığı an. */
  start: number;
  /** Dosyada nereden başladığı ve ne kadar çalacağı. */
  srcStart: number;
  length: number;
  /** Dosyanın tam süresi (kırpma sınırı). */
  sourceDuration: number;
  /** 0–2. */
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Klipte konuşma varken müzik kısılsın (dışa aktarımda). */
  duck?: boolean;
  /** Ses izi: 0 = A1, 1 = A2… Yoksa müzik A2'de durur. */
  lane?: number;
  /** "Sesi ayır" ile videodan ayrıldıysa o klibin kimliği. */
  linkedClipId?: string;
  /** Bulunan vuruşlar (dosyanın saniyesi; lib/beats). */
  beats?: number[];
  /** Ses zarfı: [öğenin başından saniye, düzey çarpanı 0–2] noktaları; arası doğrusal. */
  envelope?: [number, number][];
}

/** Müzik varsayılan olarak A2'de; A1 videodan ayrılan konuşma sesine kalır. */
export const DEFAULT_MUSIC_LANE = 1;

export const musicLane = (m: MusicItem) => m.lane ?? DEFAULT_MUSIC_LANE;

/** Dışa aktarma ve önizlemede duyulacak sesler (sessiz / yalnız dinleme izleri hesaba katılır). */
export function audibleMusic(items: readonly MusicItem[], tracks: TrackStates): MusicItem[] {
  return items.filter((m) => audioLaneAudible(tracks, musicLane(m)));
}

/** Gizlenecek bölge: isim, sohbet, e-posta… belirtilen sürede bulanık ya da pikselli. */
export interface BlurItem {
  id: string;
  /** Zaman çizelgesi saniyesi. */
  start: number;
  end: number;
  /** Sol üst köşe ve boyut (kaynak karesinin 0–1 oranı). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1. */
  strength: number;
  pixel: boolean;
  /** Hareketli gizleme: bloğun başından saniye → sol üst köşe. Yoksa kutu sabit durur. */
  keys?: BlurKey[];
}

export interface BlurKey {
  t: number;
  x: number;
  y: number;
}

/** Kutunun `time` (zaman çizelgesi saniyesi) anındaki sol üst köşesi; anahtarlar
 * arasında doğrusal geçiş, ilkinden önce ilki, sonuncusundan sonra sonuncusu. */
export function blurPosAt(b: BlurItem, time: number): { x: number; y: number } {
  const keys = b.keys;
  if (!keys || keys.length === 0) return { x: b.x, y: b.y };
  const t = time - b.start;
  if (t <= keys[0]!.t) return { x: keys[0]!.x, y: keys[0]!.y };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const k = keys[i]!;
    if (t <= k.t) {
      const f = k.t - a.t > 1e-9 ? (t - a.t) / (k.t - a.t) : 1;
      return { x: a.x + (k.x - a.x) * f, y: a.y + (k.y - a.y) * f };
    }
  }
  const last = keys.at(-1)!;
  return { x: last.x, y: last.y };
}

/** `time` anına konum anahtarı koyar (0,05 sn yakınındaki anahtarın yerine geçer). */
export function setBlurKey(b: BlurItem, time: number, x: number, y: number): BlurKey[] {
  const t = Math.max(0, Math.min(b.end - b.start, time - b.start));
  const rest = (b.keys ?? []).filter((k) => Math.abs(k.t - t) > 0.05);
  return [...rest, { t, x, y }].sort((a, c) => a.t - c.t);
}

/** Rust `BlurRegion`. */
export interface BlurRegionReq {
  ranges: [number, number][];
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
  pixel: boolean;
  /** Çıktı saniyesi → sol üst köşe (hareketli gizleme). */
  keys?: [number, number, number][];
}

export function newBlur(id: string, start: number, end: number): BlurItem {
  return {
    id,
    start,
    end: Math.max(start + 0.5, end),
    x: 0.35,
    y: 0.4,
    w: 0.3,
    h: 0.2,
    strength: 0.8,
    pixel: false,
  };
}

function parseBlurKeys(raw: unknown, w: number, h: number): BlurKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys = raw
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => ({
      t: clamp(k.t, 0, 86_400, 0),
      x: clamp(k.x, 0, 1 - w, 0),
      y: clamp(k.y, 0, 1 - h, 0),
    }))
    .sort((a, b) => a.t - b.t);
  return keys.length > 0 ? keys : undefined;
}

export function parseBlurs(raw: unknown): BlurItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== "string") return [];
    const w = clamp(r.w, 0.02, 1, 0.3);
    const h = clamp(r.h, 0.02, 1, 0.2);
    const start = clamp(r.start, 0, 86_400, 0);
    return [
      {
        id: r.id,
        start,
        end: Math.max(start + 0.2, clamp(r.end, 0, 86_400, start + 5)),
        x: clamp(r.x, 0, 1 - w, 0),
        y: clamp(r.y, 0, 1 - h, 0),
        w,
        h,
        strength: clamp(r.strength, 0, 1, 0.8),
        pixel: r.pixel === true,
        ...(parseBlurKeys(r.keys, w, h) ? { keys: parseBlurKeys(r.keys, w, h) } : {}),
      },
    ];
  });
}

/** Rust `ImageOverlay`. */
export interface ImageOverlayReq {
  path: string;
  ranges: [number, number][];
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/** Rust `MusicTrack`. */
export interface MusicTrackReq {
  path: string;
  start: number;
  srcStart: number;
  length: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duck?: boolean;
  envelope?: [number, number][];
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const MUSIC_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

/** Hazır konumlar (logo için köşeler). */
export const IMAGE_SPOTS = {
  topLeft: { x: 0.12, y: 0.1 },
  topRight: { x: 0.88, y: 0.1 },
  center: { x: 0.5, y: 0.5 },
  bottomLeft: { x: 0.12, y: 0.9 },
  bottomRight: { x: 0.88, y: 0.9 },
} as const;

export function fileName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

export function newImage(id: string, path: string, start: number, end: number): ImageItem {
  return {
    id,
    path,
    name: fileName(path),
    start: Math.max(0, start),
    end: Math.max(start + 0.5, end),
    ...IMAGE_SPOTS.topRight,
    size: 0.16,
    opacity: 1,
  };
}

export function newMusic(
  id: string,
  path: string,
  duration: number,
  start: number,
  fitTo: number | null,
): MusicItem {
  const length = fitTo !== null && fitTo > 0.5 ? Math.min(duration, fitTo) : duration;
  return {
    id,
    path,
    name: fileName(path),
    start: Math.max(0, start),
    srcStart: 0,
    length: Math.max(0.5, length),
    sourceDuration: duration,
    volume: 0.6,
    fadeIn: 0,
    fadeOut: Math.min(2, length / 4),
  };
}

/** Kayıttan gelen vuruşlar: sayı, artan, en çok 5000. */
export function parseBeats(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
    .slice(0, 5000);
  return out.length ? out : undefined;
}

export const musicEnd = (m: MusicItem) => m.start + m.length;

/** Ses zarfının `t` anındaki çarpanı (noktadan önce ilk, sonra son değer; zarf yoksa 1). */
export function envelopeAt(env: readonly [number, number][] | undefined, t: number): number {
  if (!env || env.length === 0) return 1;
  if (t <= env[0]![0]) return env[0]![1];
  for (let i = 1; i < env.length; i++) {
    const [t1, v1] = env[i]!;
    if (t < t1) {
      const [t0, v0] = env[i - 1]!;
      return t1 - t0 > 1e-9 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return env[env.length - 1]![1];
}

/** Kayıttan gelen zarf: sayı çiftleri, zamana göre sıralı, düzey 0–2; düz (hep 1) ise yok. */
export function parseEnvelope(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) &&
        typeof p[0] === "number" &&
        typeof p[1] === "number" &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]),
    )
    .map(
      ([t, v]) =>
        [
          Math.max(0, Math.round(t * 1000) / 1000),
          Math.min(2, Math.max(0, Math.round(v * 100) / 100)),
        ] as [number, number],
    )
    .sort((a, b) => a[0] - b[0])
    .slice(0, 200);
  if (out.length === 0 || out.every(([, v]) => Math.abs(v - 1) < 1e-3)) return undefined;
  return out;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Kayıtlı oturumdan gelen listeleri doğrular (bozuk kayıtlar atlanır). */
export function parseImages(raw: unknown): ImageItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.path !== "string" || typeof r.id !== "string") return [];
    const start = clamp(r.start, 0, 86_400, 0);
    return [
      {
        id: r.id,
        path: r.path,
        name: typeof r.name === "string" ? r.name : fileName(r.path),
        start,
        end: clamp(r.end, start + 0.1, 86_400, start + 3),
        x: clamp(r.x, 0, 1, 0.5),
        y: clamp(r.y, 0, 1, 0.5),
        size: clamp(r.size, 0.02, 1, 0.16),
        opacity: clamp(r.opacity, 0.05, 1, 1),
        ...(r.sticker === true ? { sticker: true } : {}),
        ...(parseMotionSpec(r.motion) ? { motion: parseMotionSpec(r.motion) } : {}),
      },
    ];
  });
}

export function parseMusic(raw: unknown): MusicItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.path !== "string" || typeof r.id !== "string") return [];
    const sourceDuration = clamp(r.sourceDuration, 0.1, 86_400, 60);
    const srcStart = clamp(r.srcStart, 0, sourceDuration, 0);
    const length = clamp(r.length, 0.1, sourceDuration - srcStart, sourceDuration - srcStart);
    return [
      {
        id: r.id,
        path: r.path,
        name: typeof r.name === "string" ? r.name : fileName(r.path),
        start: clamp(r.start, 0, 86_400, 0),
        srcStart,
        length,
        sourceDuration,
        volume: clamp(r.volume, 0, 2, 0.6),
        fadeIn: clamp(r.fadeIn, 0, length / 2, 0),
        fadeOut: clamp(r.fadeOut, 0, length / 2, 0),
        ...(r.duck === true ? { duck: true } : {}),
        ...(typeof r.lane === "number" &&
        Number.isInteger(r.lane) &&
        r.lane >= 0 &&
        r.lane < MAX_AUDIO_LANES
          ? { lane: r.lane }
          : {}),
        ...(typeof r.linkedClipId === "string" ? { linkedClipId: r.linkedClipId } : {}),
        ...(parseBeats(r.beats) ? { beats: parseBeats(r.beats) } : {}),
        ...(parseEnvelope(r.envelope) ? { envelope: parseEnvelope(r.envelope) } : {}),
      },
    ];
  });
}

type Piece = { tStart: number; tEnd: number };

/** Dışa aktarılacak parçalar için resimler (çıktıda görünmeyenler atlanır). */
export function toImageOverlays(
  items: readonly ImageItem[],
  pieces: readonly Piece[],
): ImageOverlayReq[] {
  return items
    .map((i) => ({
      path: i.path,
      ranges: outputRanges(pieces, i.start, i.end),
      x: i.x,
      y: i.y,
      size: i.size,
      opacity: i.opacity,
    }))
    .filter((o) => o.ranges.length > 0);
}

/** Zaman çizelgesi anı → çıktı saniyesi; parçaların dışındaysa `null`. */
export function outputTime(pieces: readonly Piece[], t: number): number | null {
  let offset = 0;
  for (const s of pieces) {
    if (t >= s.tStart - 1e-6 && t <= s.tEnd + 1e-6) return offset + Math.max(0, t - s.tStart);
    offset += s.tEnd - s.tStart;
  }
  return null;
}

/** Gizleme bölgelerini çıktı zamanına çevirir (görünmeyenler atlanır). */
export function toBlurRegions(
  items: readonly BlurItem[],
  pieces: readonly Piece[],
): BlurRegionReq[] {
  return items
    .map((b) => {
      const keys = (b.keys ?? []).flatMap((k) => {
        const at = outputTime(pieces, b.start + k.t);
        return at === null ? [] : [[at, k.x, k.y] as [number, number, number]];
      });
      return {
        ranges: outputRanges(pieces, b.start, b.end),
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        strength: b.strength,
        pixel: b.pixel,
        ...(keys.length > 0 ? { keys } : {}),
      };
    })
    .filter((b) => b.ranges.length > 0);
}

/** Müzik izlerini çıktı zamanına çevirir. Zaman çizelgesindeki boşluklar ya da ayrı
 * dosyalar nedeniyle bir iz birkaç parçaya bölünebilir; açılma yalnızca izin
 * başındaki, kararma sonundaki parçaya uygulanır. */
export function toMusicTracks(
  items: readonly MusicItem[],
  pieces: readonly Piece[],
): MusicTrackReq[] {
  const tracks: MusicTrackReq[] = [];
  for (const m of items) {
    const end = musicEnd(m);
    let offset = 0;
    for (const p of pieces) {
      const a = Math.max(m.start, p.tStart);
      const b = Math.min(end, p.tEnd);
      if (b - a > 0.05) {
        tracks.push({
          path: m.path,
          start: offset + (a - p.tStart),
          srcStart: m.srcStart + (a - m.start),
          length: b - a,
          volume: m.volume,
          fadeIn: Math.abs(a - m.start) < 1e-6 ? m.fadeIn : 0,
          fadeOut: Math.abs(b - end) < 1e-6 ? m.fadeOut : 0,
          ...(m.duck ? { duck: true } : {}),
          // Zarf noktaları bu parçanın başına göre kaydırılır.
          ...(m.envelope
            ? { envelope: m.envelope.map(([t, v]) => [t - (a - m.start), v] as [number, number]) }
            : {}),
        });
      }
      offset += p.tEnd - p.tStart;
    }
  }
  return tracks;
}
