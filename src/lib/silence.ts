import { useMemo } from "react";
import { create } from "zustand";
import { newClipId, useEditorStore, type EditorSourceEntry } from "../store/editorStore";
import { audioLaneAudible, clipEnd, clipVolume, type SeqClip, type TrackStates } from "./sequence";
import { musicLane, type MusicItem } from "./layers";
import { cutTimeline, mergeRanges, rangesDuration, type TimeRange } from "./rangeCut";
import { detectSilences } from "./tauri-api";

// "Sessizlikleri sil": kaynaklardaki sessiz yerler FFmpeg ile bir kez bulunur
// (kaynak saniyesi); zaman çizelgesindeki karşılıkları her an kliplerden yeniden
// hesaplanır. Bir anda duyulan bütün sesler sessizse o an sessizdir (arka plan
// müziği hesaba katılmaz). Kenarda biraz nefes payı bırakılır.

export interface SilenceOptions {
  /** Bu düzeyin altı sessiz (dB). */
  noiseDb: number;
  /** Bundan kısa sessizlik sayılmaz (saniye). */
  minSeconds: number;
  /** Kesimin iki yanında bırakılan pay (saniye). */
  pad: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { noiseDb: -38, minSeconds: 0.6, pad: 0.12 };

const EPS = 1e-6;

/** Kaynak aralığını klibin zaman çizelgesine çevirir (kırpma ve hız). */
function toTimeline(clip: SeqClip, r: TimeRange): TimeRange | null {
  const a = Math.max(r.start, clip.srcStart);
  const b = Math.min(r.end, clip.srcEnd);
  if (b - a < EPS) return null;
  return {
    start: clip.start + (a - clip.srcStart) / clip.speed,
    end: clip.start + (b - clip.srcStart) / clip.speed,
  };
}

/** [a, b] aralığından `holes` çıkınca kalanlar. */
function subtract(a: number, b: number, holes: readonly TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = a;
  for (const h of mergeRanges(holes)) {
    if (h.end <= cursor) continue;
    if (h.start >= b) break;
    if (h.start > cursor) out.push({ start: cursor, end: h.start });
    cursor = Math.max(cursor, h.end);
  }
  if (cursor < b) out.push({ start: cursor, end: b });
  return out;
}

export interface SilenceInput {
  clips: readonly SeqClip[];
  music: readonly MusicItem[];
  tracks: TrackStates;
  /** Kaynak kimliği → kaynak saniyesinde sessizlikler (incelenmemiş kaynak yok sayılır). */
  silences: Readonly<Record<string, readonly TimeRange[]>>;
  /** Kaynak yolu → kimliği (videodan ayrılmış sesler için). */
  sourceOfPath: Readonly<Record<string, string>>;
  firstSourceId: string | null;
}

/**
 * Zaman çizelgesinde kesilecek sessizlikler: duyulan bütün sesler sessizken ve en az
 * `minSeconds` sürüyorsa; iki yanından `pad` kadar pay bırakılır (zaman çizelgesinin
 * başında ve sonunda pay yok).
 */
export function timelineSilences(input: SilenceInput, options: SilenceOptions): TimeRange[] {
  const { clips, music, tracks, silences } = input;
  if (clips.length === 0) return [];
  const sound: TimeRange[] = [];
  const covered: TimeRange[] = [];
  for (const clip of clips) {
    covered.push({ start: clip.start, end: clipEnd(clip) });
    if (tracks[clip.track]?.muted || clipVolume(clip) <= 0) continue;
    const source = clip.sourceId ?? input.firstSourceId ?? "";
    const quiet = silences[source];
    // İncelenmemiş (sesi olmayan) kaynak ses katmaz.
    if (!quiet) continue;
    const holes = quiet.flatMap((r) => toTimeline(clip, r) ?? []);
    sound.push(...subtract(clip.start, clipEnd(clip), holes));
  }
  for (const m of music) {
    if (!m.linkedClipId || m.volume <= 0 || !audioLaneAudible(tracks, musicLane(m))) continue;
    const quiet = silences[input.sourceOfPath[m.path] ?? ""];
    if (!quiet) continue;
    const pseudo: SeqClip = {
      id: m.id,
      track: 0,
      start: m.start,
      srcStart: m.srcStart,
      srcEnd: m.srcStart + m.length,
      speed: 1,
      name: "",
    };
    const holes = quiet.flatMap((r) => toTimeline(pseudo, r) ?? []);
    sound.push(...subtract(m.start, m.start + m.length, holes));
  }
  const content = mergeRanges(covered);
  const contentStart = content[0].start;
  const contentEnd = content.at(-1)!.end;
  const loud = mergeRanges(sound);
  const quiet = content.flatMap((c) => subtract(c.start, c.end, loud));
  // Neredeyse bütün içerik "sessiz" (konuşma yok, ayrı mikrofon izi boş ya da eşik çok
  // yüksek): hepsini silmek videoyu yok eder, öneri yapılmaz (bkz. `isMostlySilent`).
  if (silentShare(content, quiet) >= MAX_SILENT_SHARE) return [];
  return quiet
    .filter((r) => r.end - r.start >= options.minSeconds - 0.02)
    .map((r) => ({
      start: r.start <= contentStart + EPS ? r.start : r.start + options.pad,
      end: r.end >= contentEnd - EPS ? r.end : r.end - options.pad,
    }))
    .filter((r) => r.end - r.start >= 0.1);
}

/** İçeriğin en çok bu kadarı sessiz sayılırsa öneri yapılır. */
export const MAX_SILENT_SHARE = 0.8;

function silentShare(content: readonly TimeRange[], quiet: readonly TimeRange[]): number {
  const total = content.reduce((s, r) => s + (r.end - r.start), 0);
  if (total <= 0) return 0;
  return quiet.reduce((s, r) => s + (r.end - r.start), 0) / total;
}

/** İnceleme bitti ama içeriğin neredeyse tamamı sessiz çıktı (konuşma bulunamadı). */
export function isMostlySilent(input: SilenceInput): boolean {
  return input.clips.length > 0 && timelineSilencesRaw(input) >= MAX_SILENT_SHARE;
}

/** Sessizliklerin içeriğe oranı (korumasız ham hesap). */
function timelineSilencesRaw(input: SilenceInput): number {
  const { clips, tracks, silences } = input;
  const sound: TimeRange[] = [];
  const covered: TimeRange[] = [];
  for (const clip of clips) {
    covered.push({ start: clip.start, end: clipEnd(clip) });
    if (tracks[clip.track]?.muted || clipVolume(clip) <= 0) continue;
    const quiet = silences[clip.sourceId ?? input.firstSourceId ?? ""];
    if (!quiet) {
      sound.push({ start: clip.start, end: clipEnd(clip) });
      continue;
    }
    const holes = quiet.flatMap((r) => toTimeline(clip, r) ?? []);
    sound.push(...subtract(clip.start, clipEnd(clip), holes));
  }
  const content = mergeRanges(covered);
  const loud = mergeRanges(sound);
  return silentShare(
    content,
    content.flatMap((c) => subtract(c.start, c.end, loud)),
  );
}

/** Aralığın listede ve seçimde kullanılan anahtarı. */
export const silenceKey = (r: TimeRange) => `${r.start.toFixed(2)}-${r.end.toFixed(2)}`;

interface SilenceState {
  status: "idle" | "running" | "done" | "error";
  /** Arka ucun hatası (arayüzde localizeError ile). */
  error: unknown;
  options: SilenceOptions;
  /** Kaynak kimliği → kaynak saniyesinde sessizlikler (son incelemenin ayarlarıyla). */
  silences: Record<string, TimeRange[]>;
  /** Ayrı mikrofon izinden bakılan kaynak var mı. */
  voice: boolean;
  /** Kullanıcının "kalsın" dediği aralıklar. */
  kept: string[];
  /** Hangi ayarlarla incelendi (eşik ya da en kısa süre değişirse yeniden incelenir). */
  analyzed: { noiseDb: number; minSeconds: number } | null;
  setOptions: (patch: Partial<SilenceOptions>) => void;
  toggleKept: (key: string) => void;
  reset: () => void;
}

export const useSilenceStore = create<SilenceState>((set) => ({
  status: "idle",
  error: null,
  options: DEFAULT_SILENCE,
  silences: {},
  voice: false,
  kept: [],
  analyzed: null,
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  toggleKept: (key) =>
    set((s) => ({
      kept: s.kept.includes(key) ? s.kept.filter((k) => k !== key) : [...s.kept, key],
    })),
  reset: () =>
    set({ status: "idle", error: null, silences: {}, voice: false, kept: [], analyzed: null }),
}));

/** Düzenleyicinin şimdiki hâlinden sessizlik girdisi. */
export function silenceInput(
  state: {
    clips: readonly SeqClip[];
    music: readonly MusicItem[];
    tracks: TrackStates;
    sources: readonly EditorSourceEntry[];
  },
  silences: Readonly<Record<string, readonly TimeRange[]>>,
): SilenceInput {
  return {
    clips: state.clips,
    music: state.music,
    tracks: state.tracks,
    silences,
    sourceOfPath: Object.fromEntries(state.sources.map((s) => [s.source.path, s.id])),
    firstSourceId: state.sources[0]?.id ?? null,
  };
}

/** Kullanılan ve sesi olan kaynakları inceler. Ayarlar değişmediyse eskisi kullanılır. */
export async function findSilences(): Promise<void> {
  const store = useSilenceStore.getState();
  const { noiseDb, minSeconds } = store.options;
  const editor = useEditorStore.getState();
  const used = new Set(editor.clips.map((c) => c.sourceId ?? editor.sources[0]?.id));
  const targets = editor.sources.filter((s) => used.has(s.id) && s.source.info.audioCodec !== null);
  const same =
    store.analyzed?.noiseDb === noiseDb &&
    store.analyzed.minSeconds === minSeconds &&
    targets.every((s) => store.silences[s.id]);
  if (same) {
    useSilenceStore.setState({ status: "done", error: null });
    return;
  }
  useSilenceStore.setState({ status: "running", error: null });
  try {
    const silences: Record<string, TimeRange[]> = {};
    let voice = false;
    for (const s of targets) {
      const result = await detectSilences(s.source.path, noiseDb, minSeconds, true);
      silences[s.id] = result.silences.map(([start, end]) => ({ start, end }));
      voice ||= result.voiceTrack;
    }
    useSilenceStore.setState({
      status: "done",
      silences,
      voice,
      kept: [],
      analyzed: { noiseDb, minSeconds },
    });
  } catch (err) {
    useSilenceStore.setState({
      status: "error",
      error: err,
    });
    throw err;
  }
}

/** Şimdiki zaman çizelgesindeki sessizlikler (kalsın denenler hariç değil; işaretli). */
export function currentSilences(): TimeRange[] {
  const s = useSilenceStore.getState();
  if (s.status !== "done") return [];
  return timelineSilences(silenceInput(useEditorStore.getState(), s.silences), s.options);
}

/** Kalsın denmeyen sessizlikleri keser (tek geri alma adımı). Kesilen süre döner. */
export function removeSilences(): number {
  const s = useSilenceStore.getState();
  const ranges = currentSilences().filter((r) => !s.kept.includes(silenceKey(r)));
  if (ranges.length === 0) return 0;
  const editor = useEditorStore.getState();
  const result = cutTimeline(editor, ranges, newClipId);
  editor.applyEdit({
    clips: result.clips,
    texts: result.texts,
    images: result.images,
    blurs: result.blurs,
    effects: result.effects,
    music: result.music,
  });
  useSilenceStore.setState({ kept: [] });
  return result.removed;
}

/** Zaman çizelgesindeki şimdiki sessizlikler (kliplerle birlikte güncellenir). */
/** Şimdiki zaman çizelgesi konuşmasız mı (sessizlik incelemesi bittiyse). */
export function currentlyMostlySilent(): boolean {
  const s = useSilenceStore.getState();
  return s.status === "done" && isMostlySilent(silenceInput(useEditorStore.getState(), s.silences));
}

export function useTimelineSilences() {
  const clips = useEditorStore((s) => s.clips);
  const music = useEditorStore((s) => s.music);
  const tracks = useEditorStore((s) => s.tracks);
  const sources = useEditorStore((s) => s.sources);
  const status = useSilenceStore((s) => s.status);
  const silences = useSilenceStore((s) => s.silences);
  const options = useSilenceStore((s) => s.options);
  return useMemo(
    () =>
      status === "done"
        ? timelineSilences(silenceInput({ clips, music, tracks, sources }, silences), options)
        : [],
    [clips, music, tracks, sources, status, silences, options],
  );
}

export { rangesDuration };
