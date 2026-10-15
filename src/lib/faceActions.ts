import { create } from "zustand";
import { FRAME_SIZES, useEditorStore, type ExportOptions } from "../store/editorStore";
import { usedRanges } from "./autoCaptions";
import { buildTrack, retargetTrack, trackAt, type Track } from "./faceTrack";
import { flatten, segmentAt, sourceTimeAt, type SeqClip, type TrackStates } from "./sequence";
import { detectFaces, onFaceProgress } from "./tauri-api";
import { effectiveSplit, podcastFromFaces } from "./splitLayout";

// "Yüzü takip et": kullanılan kaynak aralıklarında yüzler bulunur, kırpma konumu izi
// her kaynak için (dosya yoluna göre) dışa aktarma seçeneklerine yazılır. Önizleme ve
// dışa aktarma aynı izi kullanır.

interface FaceState {
  status: "idle" | "running" | "done" | "none" | "error";
  /** 0–1 ilerleme. */
  progress: number;
  /** Yüz bulunan karelerin oranı. */
  coverage: number | null;
  error: unknown;
}

export const useFaceStore = create<FaceState>(() => ({
  status: "idle",
  progress: 0,
  coverage: null,
  error: null,
}));

/** Kullanılan kaynakların yüzlerini bulup izi kurar. Kaç kaynakta iz çıktığı döner. */
export async function trackFaces(): Promise<number> {
  const editor = useEditorStore.getState();
  const { exportOptions: o, clips, sources } = editor;
  if (o.frame === "original") return 0;
  const [fw, fh] = FRAME_SIZES[o.frame];
  const first = sources[0]?.id;
  const targets = sources.filter(
    (s) =>
      s.source.info.width &&
      s.source.info.height &&
      clips.some((c) => (c.sourceId ?? first) === s.id),
  );
  useFaceStore.setState({ status: "running", progress: 0, coverage: null, error: null });
  const unlisten = await onFaceProgress((done, total) =>
    useFaceStore.setState({ progress: Math.min(1, done / Math.max(1, total)) }),
  ).catch(() => null);
  try {
    const tracks: Record<string, Track> = {};
    let seen = 0;
    let found = 0;
    for (const s of targets) {
      const { width, height } = s.source.info;
      const ranges = usedRanges(clips, s.id, first).map(
        (r) => [r.start, r.end] as [number, number],
      );
      const samples = await detectFaces(s.source.path, ranges, width!, height!);
      const result = buildTrack(samples, width! / height!, fw / fh);
      seen += samples.length;
      if (result) {
        tracks[s.source.path] = result.track;
        found += Math.round(result.coverage * samples.length);
      }
    }
    const count = Object.keys(tracks).length;
    useEditorStore.getState().setExportOptions({
      frameTrack: count > 0 ? tracks : null,
      frameTrackAspect: count > 0 ? fw / fh : null,
    });
    useFaceStore.setState({
      status: count > 0 ? "done" : "none",
      progress: 1,
      coverage: seen > 0 ? found / seen : 0,
    });
    return count;
  } catch (error) {
    useFaceStore.setState({ status: "error", error });
    return 0;
  } finally {
    try {
      unlisten?.();
    } catch {
      // Dinleyici zaten kapanmış olabilir.
    }
  }
}

/** Podcast düzeni: ilk kaynağın birkaç karesindeki yüzlere göre iki kişiyi yerleştirir. */
export async function placePodcastByFaces(): Promise<boolean> {
  const { exportOptions: o, clips, sources } = useEditorStore.getState();
  if (o.frame === "original") return false;
  const [fw, fh] = FRAME_SIZES[o.frame];
  const entry = useEditorStore.getState().source
    ? sources.find((s) => s.source.path === useEditorStore.getState().source?.path)
    : sources[0];
  const info = entry?.source.info;
  if (!entry || !info?.width || !info.height) return false;
  const first = sources[0]?.id;
  // Kullanılan aralıklara yayılmış 8 kısa örnek (her biri yarım saniye).
  const ranges = usedRanges(clips, entry.id, first);
  const total = ranges.reduce((n, r) => n + r.end - r.start, 0);
  const picks: [number, number][] = [];
  for (let i = 0; i < 8 && total > 0; i += 1) {
    let at = ((i + 0.5) / 8) * total;
    for (const r of ranges) {
      const len = r.end - r.start;
      if (at <= len) {
        picks.push([r.start + at, Math.min(r.end, r.start + at + 0.5)]);
        break;
      }
      at -= len;
    }
  }
  const samples = await detectFaces(entry.source.path, picks, info.width, info.height);
  const faces = samples.flatMap((s) => s.faces);
  const sourceAspect = info.width / info.height;
  const base = effectiveSplit(o.split, sourceAspect, fw, fh);
  const next = podcastFromFaces(base, faces, sourceAspect, fw, fh);
  if (!next) return false;
  useEditorStore.getState().setExportOptions({ frameSplit: true, split: next });
  return true;
}

/** Yüz takibini kapatır (konum yeniden elle). */
export function stopFaceTracking() {
  useEditorStore.getState().setExportOptions({ frameTrack: null, frameTrackAspect: null });
  useFaceStore.setState({ status: "idle", coverage: null, progress: 0 });
}

/** Zaman çizelgesinin `t` anındaki kırpma konumu (yüz takibi açıksa izden). */
export function cropPositionAt(
  options: Pick<ExportOptions, "framePosition" | "frameTrack">,
  clips: readonly SeqClip[],
  tracks: TrackStates,
  sourcePath: (sourceId: string | undefined) => string | undefined,
  t: number,
): number {
  if (!options.frameTrack) return options.framePosition;
  const segment = segmentAt(flatten(clips, tracks), t);
  if (!segment) return options.framePosition;
  const path = sourcePath(segment.sourceId);
  const track = path ? options.frameTrack[path] : undefined;
  return track ? trackAt(track, sourceTimeAt(segment, t)) : options.framePosition;
}

/**
 * İzleri `aspect` oranlı çıktıya uyarlar (iz başka biçimde hesaplandıysa). Uyarlanamayan
 * kaynak izsiz kalır (elle konum); hiç iz kalmazsa null.
 */
export function tracksForAspect(
  options: Pick<ExportOptions, "frameTrack" | "frameTrackAspect">,
  aspect: number,
  sourceAspect: (path: string) => number | undefined,
): Record<string, Track> | null {
  const { frameTrack, frameTrackAspect } = options;
  if (!frameTrack || frameTrackAspect === null) return frameTrack;
  const out: Record<string, Track> = {};
  for (const [path, track] of Object.entries(frameTrack)) {
    const src = sourceAspect(path);
    const next = src ? retargetTrack(track, src, frameTrackAspect, aspect) : null;
    if (next) out[path] = next;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Kaynak yolunun en-boy oranı (düzenleyicideki kaynaklardan). */
export function sourceAspectOf(path: string): number | undefined {
  const entry = useEditorStore.getState().sources.find((s) => s.source.path === path);
  const { width, height } = entry?.source.info ?? {};
  return width && height ? width / height : undefined;
}

/** Düzenleyicinin şu anki durumuyla kırpma konumu. */
export function currentCropPosition(t: number): number {
  const s = useEditorStore.getState();
  const first = s.sources[0];
  const o = s.exportOptions;
  const aspect = o.frame === "original" ? null : FRAME_SIZES[o.frame][0] / FRAME_SIZES[o.frame][1];
  return cropPositionAt(
    aspect === null ? o : { ...o, frameTrack: tracksForAspect(o, aspect, sourceAspectOf) },
    s.clips,
    s.tracks,
    (id) => (s.sources.find((x) => x.id === id) ?? first)?.source.path,
    t,
  );
}
