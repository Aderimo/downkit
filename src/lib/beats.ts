// Müzikte ritim: vuruşlar müzik öğesinde (dosyanın saniyesi) saklanır, zaman
// çizelgesinde çizgi olarak görünür, sürüklerken yapışma noktası olur. "Ritme göre
// kes" ana izdeki klipleri her N vuruşta böler (tek geri alma adımı).

import { newClipId, useEditorStore } from "../store/editorStore";
import { audioBeats } from "./tauri-api";
import { musicEnd, type MusicItem } from "./layers";
import { clipEnd, splitClip, type SeqClip } from "./sequence";
import { refreshPlayback } from "./sequencePlayer";

/** Vuruşların zaman çizelgesindeki anları (öğenin görünen kısmında). */
export function beatTimes(item: MusicItem): number[] {
  if (!item.beats) return [];
  return item.beats
    .filter((b) => b >= item.srcStart && b <= item.srcStart + item.length)
    .map((b) => Math.round((item.start + (b - item.srcStart)) * 1000) / 1000);
}

/** Bütün müziklerin vuruşları (yapışma için). */
export const allBeatTimes = (music: readonly MusicItem[]): number[] => music.flatMap(beatTimes);

/** Klipleri verilen anlardan böler (ana izde, klibin kenarına çok yakın olanlar atlanır). */
export function splitAtTimes(
  clips: readonly SeqClip[],
  times: readonly number[],
  makeId: () => string,
  track = 0,
): SeqClip[] {
  let out = [...clips];
  for (const t of [...times].sort((a, b) => a - b)) {
    const clip = out.find((c) => c.track === track && t > c.start && t < clipEnd(c));
    if (clip) out = splitClip(out, clip.id, t, makeId());
  }
  return out;
}

/** Müziğin vuruşlarını bulur ve öğeye yazar; bulunan sayıyı döner. */
export async function detectBeats(id: string): Promise<number> {
  const item = useEditorStore.getState().music.find((m) => m.id === id);
  if (!item) return 0;
  const beats = await audioBeats(item.path, item.srcStart, item.length);
  const s = useEditorStore.getState();
  s.applyLayers({ music: s.music.map((m) => (m.id === id ? { ...m, beats } : m)) });
  return beatTimes({ ...item, beats }).length;
}

/** Ana izdeki klipleri müziğin her `every` vuruşunda böler; bölünen yer sayısı. */
export function cutAtBeats(id: string, every: number): number {
  const s = useEditorStore.getState();
  const item = s.music.find((m) => m.id === id);
  if (!item) return 0;
  const times = beatTimes(item).filter((_, i) => i % Math.max(1, every) === 0);
  const end = musicEnd(item);
  const before = s.clips.length;
  s.apply((clips) =>
    splitAtTimes(
      clips,
      times.filter((t) => t < end),
      newClipId,
    ),
  );
  refreshPlayback();
  return useEditorStore.getState().clips.length - before;
}
