import { clipFades, clipVolume, type SeqClip } from "./sequence";
import type { MusicItem } from "./layers";

// "Sesi ayır": klibin sesi aynı dosyanın aynı aralığından bir ses bloğu olarak
// A1'e konur, videonun kendi sesi kısılır. Böylece ses ayrı taşınır, kısaltılır
// (görüntüden önce/sonra başlayan ses: J/L kesim). "Sesi bağla" geri alır.
// Saf fonksiyonlar; düzenleyiciye uygulama editorActions'ta.

export const DETACHED_LANE = 0;

export interface DetachSource {
  id: string;
  path: string;
  title: string;
  duration: number;
  hasAudio: boolean;
}

export interface DetachResult {
  clips: SeqClip[];
  music: MusicItem[];
  detached: number;
  /** Hızı değişmiş klipler ayrılamaz (ses bloğu hız değiştirmez). */
  skippedSpeed: number;
  noAudio: number;
}

export function detachAudio(
  clips: readonly SeqClip[],
  music: readonly MusicItem[],
  ids: readonly string[],
  sources: readonly DetachSource[],
  newId: () => string,
): DetachResult {
  const added: MusicItem[] = [];
  let skippedSpeed = 0;
  let noAudio = 0;
  const already = new Set(music.map((m) => m.linkedClipId).filter(Boolean));
  const next = clips.map((clip) => {
    if (!ids.includes(clip.id) || already.has(clip.id)) return clip;
    const source = sources.find((s) => s.id === clip.sourceId) ?? sources[0];
    if (!source || !source.hasAudio) {
      noAudio += 1;
      return clip;
    }
    if (Math.abs(clip.speed - 1) > 1e-6) {
      skippedSpeed += 1;
      return clip;
    }
    const [fadeIn, fadeOut] = clipFades(clip);
    added.push({
      id: newId(),
      path: source.path,
      name: source.title,
      start: clip.start,
      srcStart: clip.srcStart,
      length: clip.srcEnd - clip.srcStart,
      sourceDuration: Math.max(source.duration, clip.srcEnd),
      volume: Math.min(2, clipVolume(clip)),
      fadeIn,
      fadeOut,
      lane: DETACHED_LANE,
      linkedClipId: clip.id,
    });
    return { ...clip, volume: 0 };
  });
  return {
    clips: next,
    music: [...music, ...added],
    detached: added.length,
    skippedSpeed,
    noAudio,
  };
}

/** Ayrılmış sesi klibe geri bağlar: ses bloğu silinir, klibin sesi bloğun ses düzeyiyle açılır. */
export function reattachAudio(
  clips: readonly SeqClip[],
  music: readonly MusicItem[],
  clipIds: readonly string[],
): { clips: SeqClip[]; music: MusicItem[]; reattached: number } {
  const linked = music.filter((m) => m.linkedClipId && clipIds.includes(m.linkedClipId));
  if (linked.length === 0) return { clips: [...clips], music: [...music], reattached: 0 };
  const volumeOf = new Map(linked.map((m) => [m.linkedClipId as string, m.volume]));
  return {
    clips: clips.map((c) => (volumeOf.has(c.id) ? { ...c, volume: volumeOf.get(c.id) } : c)),
    music: music.filter((m) => !linked.includes(m)),
    reattached: linked.length,
  };
}

/** Klibin sesi ayrılmış mı. */
export const isDetached = (music: readonly MusicItem[], clipId: string) =>
  music.some((m) => m.linkedClipId === clipId);
