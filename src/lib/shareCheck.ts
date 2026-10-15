// Paylaşmadan önce kontrol: dışa aktarmadan önce sık yapılan hataları listeler —
// telefonun düğme/açıklama alanına giren yazı ve logo, siyah boşluk, sesi olmayan
// video, ses seviyesi, yanlış oran, kısa video için uzun süre, eksik dosya. Saf fonksiyon
// (eksik dosya denetimi ayrı, dosya sistemine sorar).

import { SAFE_TEMPLATES, type SafeTemplate, type SafeZone } from "./phoneSafe";
import { musicLane, type ImageItem, type MusicItem } from "./layers";
import {
  audioLaneAudible,
  exportPieces,
  flatten,
  sequenceEnd,
  type SeqClip,
  type TrackStates,
} from "./sequence";
import type { TextItem } from "./textItems";

export type IssueLevel = "warn" | "info";

export interface ShareIssue {
  id:
    | "empty"
    | "textInZone"
    | "imageInZone"
    | "gap"
    | "silent"
    | "loudness"
    | "landscape"
    | "long"
    | "missing";
  level: IssueLevel;
  /** Çeviri değişkenleri. */
  params?: Record<string, string | number>;
}

export interface ShareCheckInput {
  clips: readonly SeqClip[];
  tracks: TrackStates;
  texts: readonly TextItem[];
  images: readonly ImageItem[];
  music: readonly MusicItem[];
  frame: string;
  loudness: boolean;
  /** Ana kaynağın en-boy oranı (genişlik / yükseklik); bilinmiyorsa null. */
  sourceAspect: number | null;
  template: SafeTemplate;
}

const VERTICAL = new Set(["9:16", "4:5"]);
/** Kısa video uygulamalarında rahat izlenen en uzun süre (saniye). */
export const SHORT_VIDEO_MAX = 90;

type Box = { x: number; y: number; w: number; h: number };

const overlaps = (a: Box, z: SafeZone) =>
  a.x < z.x + z.w && a.x + a.w > z.x && a.y < z.y + z.h && a.y + a.h > z.y;

/** Yazının kabaca kutusu (0–1, dikey karede): kısa kenar = genişlik. */
export function textBox(t: Pick<TextItem, "x" | "y" | "size" | "text">, aspect = 9 / 16): Box {
  const lines = t.text.split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  // size: kısa kenarın oranı; dikey karede kısa kenar genişliktir.
  const h = t.size * aspect * lines.length * 1.2;
  const w = Math.min(1, t.size * longest * 0.55);
  return { x: t.x - w / 2, y: t.y - h / 2, w, h };
}

export function shareIssues(input: ShareCheckInput): ShareIssue[] {
  const issues: ShareIssue[] = [];
  const end = sequenceEnd(input.clips);
  if (input.clips.length === 0 || end <= 0) return [{ id: "empty", level: "warn" }];

  if (VERTICAL.has(input.frame)) {
    const zones = SAFE_TEMPLATES[input.template] as readonly SafeZone[];
    const texts = input.texts.filter(
      (t) => t.text.trim() && zones.some((z) => overlaps(textBox(t), z)),
    );
    if (texts.length)
      issues.push({ id: "textInZone", level: "warn", params: { count: texts.length } });
    const images = input.images.filter((i) => {
      const box = {
        x: i.x - i.size / 2,
        y: i.y - (i.size * 9) / 16 / 2,
        w: i.size,
        h: (i.size * 9) / 16,
      };
      return zones.some((z) => overlaps(box, z));
    });
    if (images.length)
      issues.push({ id: "imageInZone", level: "warn", params: { count: images.length } });
  }

  const pieces = exportPieces(flatten([...input.clips], input.tracks));
  const gap = pieces.filter((p) => p.kind === "gap").reduce((s, p) => s + (p.tEnd - p.tStart), 0);
  if (gap > 0.1)
    issues.push({ id: "gap", level: "warn", params: { seconds: Math.round(gap * 10) / 10 } });

  const clipSound = flatten([...input.clips], input.tracks).some((s) => s.volume > 0.01);
  const musicSound = input.music.some(
    (m) => m.volume > 0.01 && audioLaneAudible(input.tracks, musicLane(m)),
  );
  if (!clipSound && !musicSound) issues.push({ id: "silent", level: "warn" });
  else if (!input.loudness) issues.push({ id: "loudness", level: "info" });

  if (input.frame === "original" && input.sourceAspect !== null && input.sourceAspect > 1.2) {
    issues.push({ id: "landscape", level: "info" });
  }
  const duration = pieces.reduce((s, p) => s + (p.tEnd - p.tStart), 0);
  if (VERTICAL.has(input.frame) && duration > SHORT_VIDEO_MAX) {
    issues.push({ id: "long", level: "info", params: { seconds: Math.round(duration) } });
  }
  return issues;
}

/** Projede kullanılan ama diskte bulunmayan dosyaların adları. */
export async function missingFiles(
  paths: readonly string[],
  exists: (paths: string[]) => Promise<boolean[]>,
): Promise<string[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return [];
  const found = await exists(unique);
  return unique.filter((_, i) => !found[i]).map((p) => p.split(/[\\/]/).pop() ?? p);
}
