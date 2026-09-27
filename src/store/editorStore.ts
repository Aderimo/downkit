import { create } from "zustand";
import i18n from "../i18n";
import type { Chapter, MediaMetadata, PreviewStream } from "../types/media";
import type { LocalMediaInfo } from "../types/convert";
import type { TimeRange } from "../lib/timeRange";
import { analyzeUrl, openLocalPreview } from "../lib/tauri-api";
import { localizeError, type LocalizedError } from "../lib/errors";
import { getSettings } from "../lib/appSettings";
import { clampView, fullView, type TimelineView } from "../lib/timeline";
import {
  initialClips,
  sequenceEnd,
  type SeqClip,
  type TrackState,
  type TrackStates,
} from "../lib/sequence";
import type { TextItem } from "../lib/textItems";
import { usePlayerStore } from "./playerStore";

export type EditorSource =
  | { kind: "remote"; url: string; metadata: MediaMetadata }
  | { kind: "local"; path: string; info: LocalMediaInfo };

export type EditorStream = Omit<PreviewStream, "audioUrl"> & { audioUrl: string | null };

export type VideoExportFormat = "mp4" | "mkv" | "webm";
export type AudioExportFormat = "mp3" | "m4a" | "wav" | "flac";

/** Dışa aktarımda çıkış karesi: özgün ya da platform biçimi. */
export type FrameAspect = "original" | "9:16" | "1:1" | "4:5" | "16:9";

export const FRAME_SIZES: Record<Exclude<FrameAspect, "original">, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "16:9": [1920, 1080],
};

export interface ExportOptions {
  output: "video" | "audio" | "gif";
  videoFormat: VideoExportFormat;
  /** null: en iyi kalite. Yalnızca link kaynağında. */
  maxHeight: number | null;
  audioFormat: AudioExportFormat;
  audioBitrateKbps: number;
  /** Birden çok parça: tek dosyada birleştir (true) ya da her biri ayrı dosya. */
  merge: boolean;
  /** Yerel tek parça: tam karede kes (yeniden kodlar). */
  precise: boolean;
  /** Uzantısız çıktı adı. */
  outputName: string;
  gifFps: number;
  gifWidth: number;
  frame: FrameAspect;
  /** true: kırpmadan sığdır (siyah bant). */
  frameFit: boolean;
  /** Kırpmada kalan bölgenin yeri: 0 = sol/üst, 1 = sağ/alt. */
  framePosition: number;
}

type Phase = "empty" | "loading" | "ready" | "error";
export type PanelTab = "clip" | "export";

const HISTORY_LIMIT = 100;

/** Geri alma adımı: klipler ve yazılar birlikte. */
export interface Snapshot {
  clips: SeqClip[];
  texts: TextItem[];
}

interface EditorState {
  phase: Phase;
  source: EditorSource | null;
  stream: EditorStream | null;
  error: LocalizedError | null;
  /** Kaynak videonun süresi. */
  duration: number;
  clips: SeqClip[];
  selectedIds: string[];
  /** Yazılar (başlık, alt yazı) ve seçili olan. */
  texts: TextItem[];
  selectedTextId: string | null;
  /** İzlerin sessiz / gizli durumu. */
  tracks: TrackStates;
  past: Snapshot[];
  future: Snapshot[];
  /** Sürükleme başındaki hâl: bırakınca tek geri alma adımı olur. */
  dragOrigin: Snapshot | null;
  /** Mıknatıs: kenarlar imlece ve diğer kliplere yapışır. */
  snapping: boolean;
  view: TimelineView;
  panelTab: PanelTab;
  exportOptions: ExportOptions;
  /** Bu ekrandan başlatılan son dışa aktarımların kuyruk kimlikleri. */
  lastJobIds: string[];

  openUrl: (url: string) => Promise<void>;
  openMetadata: (url: string, metadata: MediaMetadata, section?: TimeRange | null) => void;
  openFile: (path: string) => Promise<void>;
  replaceStream: (stream: EditorStream) => void;
  close: () => void;
  /** Klipleri değiştirir ve geri alınabilir bir adım kaydeder. */
  apply: (change: (clips: SeqClip[]) => SeqClip[]) => void;
  /** Yazıları değiştirir ve geri alınabilir bir adım kaydeder. */
  applyTexts: (change: (texts: TextItem[]) => TextItem[]) => void;
  beginDrag: () => void;
  dragTo: (clips: SeqClip[]) => void;
  dragTexts: (texts: TextItem[]) => void;
  selectText: (id: string | null) => void;
  endDrag: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  renameClip: (id: string, name: string) => void;
  setSnapping: (on: boolean) => void;
  /** İzi sessize alır ya da gizler (Clipchamp'taki iz düğmeleri). */
  setTrack: (track: number, patch: TrackState) => void;
  setView: (view: TimelineView) => void;
  setPanelTab: (tab: PanelTab) => void;
  setExportOptions: (patch: Partial<ExportOptions>) => void;
  setLastJobIds: (ids: string[]) => void;
}

// Aynı anda iki kaynak açılırsa (ör. analiz sürerken dosya bırakıldı) geç dönen
// eski sonuç yenisinin üzerine yazmasın.
let loadToken = 0;
// Kaldığı yerden devam ederken kaynak açılınca uygulanacak klipler.
let pendingRestore: {
  clips: SeqClip[];
  texts?: TextItem[];
  tracks?: TrackStates;
  duration: number;
} | null = null;
// Kaldığı yerden devam ederken kliplerle birlikte geri gelen yazılar.
let restoredTexts: TextItem[] = [];

// Kaldığı yerden devam ederken geri gelen iz durumları (sessiz / gizli).
let restoredTracks: TrackStates = {};

function takeRestoredTracks(): TrackStates {
  const tracks = restoredTracks;
  restoredTracks = {};
  return tracks;
}

function takeRestoredTexts(): TextItem[] {
  const texts = restoredTexts;
  restoredTexts = [];
  return texts;
}

export const newClipId = () => crypto.randomUUID();

function initialExport(name: string): ExportOptions {
  const settings = getSettings();
  const videoFormat = (["mp4", "mkv", "webm"] as const).find(
    (f) => f === settings.defaultOutputFormat,
  );
  return {
    output: "video",
    videoFormat: videoFormat ?? "mp4",
    maxHeight: settings.defaultMaxHeight,
    audioFormat: "mp3",
    audioBitrateKbps: 192,
    merge: true,
    precise: false,
    outputName: name,
    gifFps: 12,
    gifWidth: 480,
    frame: "original",
    frameFit: false,
    framePosition: 0.5,
  };
}

function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

const emptyState = {
  source: null,
  stream: null,
  error: null,
  duration: 0,
  clips: [] as SeqClip[],
  selectedIds: [] as string[],
  texts: [] as TextItem[],
  selectedTextId: null as string | null,
  tracks: {} as TrackStates,
  past: [] as Snapshot[],
  future: [] as Snapshot[],
  dragOrigin: null,
  view: fullView(0),
  panelTab: "clip" as PanelTab,
  lastJobIds: [] as string[],
};

function resetPlayer() {
  usePlayerStore
    .getState()
    .patch({ currentTime: 0, playing: false, stopAt: null, waiting: false, inGap: false });
}

/** Kaynak açılınca başlangıç klipleri: kaldığı yerden devam, Ana Sayfa'daki
 * bölüm ya da videonun tamamı. */
function startingClips(duration: number, section?: TimeRange | null): SeqClip[] {
  const restore = pendingRestore;
  pendingRestore = null;
  restoredTexts = [];
  restoredTracks = {};
  if (restore && Math.abs(restore.duration - duration) < 2 && restore.clips.length > 0) {
    restoredTexts = restore.texts ?? [];
    restoredTracks = restore.tracks ?? {};
    return restore.clips;
  }
  if (section && section.end - section.start > 0.2) {
    return [
      {
        id: newClipId(),
        track: 0,
        start: 0,
        srcStart: section.start,
        srcEnd: Math.min(section.end, duration),
        speed: 1,
        name: "",
      },
    ];
  }
  return initialClips(duration, newClipId());
}

/** Kaynağın bölümleri (link ya da dosya); yoksa boş. */
export function sourceChapters(source: EditorSource | null): Chapter[] {
  if (!source) return [];
  return (source.kind === "remote" ? source.metadata.chapters : source.info.chapters) ?? [];
}

/** Görünür aralığın sınırı: klipler kaynaktan uzun olabilir (yavaşlatılınca). */
/** İçeriğin sonu: kaynağın süresi ya da en sağdaki klibin sonu. */
export function contentEnd(clips: SeqClip[], duration: number): number {
  return Math.max(sequenceEnd(clips), duration, 1);
}

/** Zaman çizelgesinin gezilebilen uzunluğu: içeriğin sağında boş alan kalır
 * (Clipchamp gibi); klip oraya taşınabilir, arada kalan boşluk siyah ekran olur.
 * Klip sağa gittikçe alan da büyür. */
export function timelineExtent(clips: SeqClip[], duration: number): number {
  const end = contentEnd(clips, duration);
  return end + Math.max(30, end * 0.25);
}

/** "Tamamını göster": içerik ve sağında biraz boş alan. */
export function fitView(clips: SeqClip[], duration: number): TimelineView {
  return fullView(contentEnd(clips, duration) * 1.08);
}

function sameClips(a: SeqClip[], b: SeqClip[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  phase: "empty",
  ...emptyState,
  snapping: true,
  exportOptions: initialExport(""),

  openUrl: async (url) => {
    const token = ++loadToken;
    set({ phase: "loading", error: null });
    try {
      const result = await analyzeUrl(url);
      if (token !== loadToken) return;
      if (result.kind === "playlist") {
        set({
          phase: "error",
          error: { message: i18n.t("editor.playlistNotSupported"), detail: null },
        });
        return;
      }
      get().openMetadata(url, result);
    } catch (err) {
      if (token !== loadToken) return;
      set({ phase: "error", error: localizeError(err, "error.analyzeFailed") });
    }
  },

  openMetadata: (url, metadata, section) => {
    loadToken += 1;
    const duration = metadata.durationSeconds ?? 0;
    if (duration <= 0) {
      set({ phase: "error", error: { message: i18n.t("editor.noDuration"), detail: null } });
      return;
    }
    resetPlayer();
    const clips = startingClips(duration, section);
    set({
      ...emptyState,
      phase: "ready",
      source: { kind: "remote", url, metadata },
      stream: metadata.preview,
      duration,
      clips,
      texts: takeRestoredTexts(),
      tracks: takeRestoredTracks(),
      view: fitView(clips, duration),
      exportOptions: initialExport(metadata.title),
    });
  },

  openFile: async (path) => {
    const token = ++loadToken;
    set({ phase: "loading", error: null });
    try {
      const preview = await openLocalPreview(path);
      if (token !== loadToken) return;
      const duration = preview.info.durationSeconds ?? 0;
      if (duration <= 0) {
        set({ phase: "error", error: { message: i18n.t("editor.noDuration"), detail: null } });
        return;
      }
      resetPlayer();
      const clips = startingClips(duration);
      set({
        ...emptyState,
        phase: "ready",
        source: { kind: "local", path, info: preview.info },
        stream: {
          kind: "file",
          url: preview.url,
          audioUrl: null,
          token: preview.token,
          hasVideo: preview.info.videoCodec !== null,
        },
        duration,
        clips,
        texts: takeRestoredTexts(),
        tracks: takeRestoredTracks(),
        view: fitView(clips, duration),
        exportOptions: {
          ...initialExport(stem(preview.info.fileName)),
          output: preview.info.videoCodec ? "video" : "audio",
        },
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ phase: "error", error: localizeError(err, "error.probeFailed") });
    }
  },

  replaceStream: (stream) => set({ stream }),

  close: () => {
    loadToken += 1;
    resetPlayer();
    set({ phase: "empty", ...emptyState });
  },

  apply: (change) => {
    const { clips, texts, past, selectedIds } = get();
    const next = change(clips);
    if (sameClips(clips, next)) return;
    const ids = new Set(next.map((c) => c.id));
    set({
      clips: next,
      past: [...past, { clips, texts }].slice(-HISTORY_LIMIT),
      future: [],
      selectedIds: selectedIds.filter((id) => ids.has(id)),
    });
  },

  applyTexts: (change) => {
    const { clips, texts, past, selectedTextId } = get();
    const next = change(texts);
    if (next.length === texts.length && next.every((t, i) => t === texts[i])) return;
    set({
      texts: next,
      past: [...past, { clips, texts }].slice(-HISTORY_LIMIT),
      future: [],
      selectedTextId: next.some((t) => t.id === selectedTextId) ? selectedTextId : null,
    });
  },

  beginDrag: () => set({ dragOrigin: { clips: get().clips, texts: get().texts } }),
  dragTo: (clips) => set({ clips }),
  dragTexts: (texts) => set({ texts }),
  endDrag: () => {
    const { dragOrigin, clips, texts, past } = get();
    const changed =
      dragOrigin && (!sameClips(dragOrigin.clips, clips) || dragOrigin.texts !== texts);
    if (dragOrigin && changed) {
      set({ past: [...past, dragOrigin].slice(-HISTORY_LIMIT), future: [], dragOrigin: null });
    } else {
      set({ dragOrigin: null });
    }
  },

  undo: () => {
    const { past, clips, texts, future } = get();
    const previous = past.at(-1);
    if (!previous) return;
    set({
      clips: previous.clips,
      texts: previous.texts,
      past: past.slice(0, -1),
      future: [{ clips, texts }, ...future],
      selectedIds: [],
      selectedTextId: null,
    });
  },

  redo: () => {
    const { past, clips, texts, future } = get();
    const next = future[0];
    if (!next) return;
    set({
      clips: next.clips,
      texts: next.texts,
      past: [...past, { clips, texts }],
      future: future.slice(1),
      selectedIds: [],
      selectedTextId: null,
    });
  },

  // Klip ve yazı seçimi birbirini dışlar: sağ panel hangisini göstereceğini bilsin.
  select: (selectedIds) =>
    set(selectedIds.length > 0 ? { selectedIds, selectedTextId: null } : { selectedIds }),
  selectText: (id) => set(id ? { selectedTextId: id, selectedIds: [] } : { selectedTextId: null }),
  toggleSelect: (id) => {
    const { selectedIds } = get();
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    });
  },

  renameClip: (id, name) =>
    set({ clips: get().clips.map((c) => (c.id === id ? { ...c, name } : c)) }),

  setSnapping: (snapping) => set({ snapping }),
  setView: (view) => {
    const { clips, duration } = get();
    set({ view: clampView(view, timelineExtent(clips, duration)) });
  },
  setPanelTab: (panelTab) => set({ panelTab }),
  setTrack: (track, patch) =>
    set({ tracks: { ...get().tracks, [track]: { ...get().tracks[track], ...patch } } }),
  setExportOptions: (patch) => set({ exportOptions: { ...get().exportOptions, ...patch } }),
  setLastJobIds: (lastJobIds) => set({ lastJobIds }),
}));

// ——— Kaldığı yerden devam ———

const SESSION_KEY = "downkit.editorSession";

export interface SavedSession {
  source:
    | { kind: "remote"; url: string; title: string; thumbnailUrl: string | null }
    | { kind: "local"; path: string; title: string };
  duration: number;
  clips: SeqClip[];
  texts?: TextItem[];
  tracks?: TrackStates;
  savedAt: string;
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedSession) : null;
    return parsed && Array.isArray(parsed.clips) && parsed.source ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Depolama yoksa zaten kayıt da yoktur.
  }
}

/** Son projeyi açar; kaynak yüklenince klipler geri gelir. */
export async function resumeSession(): Promise<void> {
  const session = loadSession();
  if (!session) return;
  pendingRestore = {
    clips: session.clips,
    texts: session.texts,
    tracks: session.tracks,
    duration: session.duration,
  };
  const editor = useEditorStore.getState();
  if (session.source.kind === "remote") await editor.openUrl(session.source.url);
  else await editor.openFile(session.source.path);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Her değişiklikte (sürükleme bitince) son proje kısa bir gecikmeyle kaydedilir.
useEditorStore.subscribe((state, previous) => {
  if (state.phase !== "ready" || !state.source || state.dragOrigin) return;
  const dragEnded = previous.dragOrigin !== null && state.dragOrigin === null;
  if (
    !dragEnded &&
    state.clips === previous.clips &&
    state.texts === previous.texts &&
    state.tracks === previous.tracks &&
    state.source === previous.source
  )
    return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { source, clips, texts, tracks, duration } = useEditorStore.getState();
    if (!source) return;
    const session: SavedSession = {
      source:
        source.kind === "remote"
          ? {
              kind: "remote",
              url: source.url,
              title: source.metadata.title,
              thumbnailUrl: source.metadata.thumbnailUrl,
            }
          : { kind: "local", path: source.path, title: source.info.fileName },
      duration,
      clips,
      texts,
      tracks,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Kaydedilemezse yalnızca "devam et" önerisi çıkmaz.
    }
  }, 600);
});

/** Önizlemeyi yeniler (bağlantı süresi dolduysa); klipler korunur. */
export async function reloadSource(): Promise<void> {
  const { source, clips, texts, tracks, duration } = useEditorStore.getState();
  if (source?.kind !== "remote") return;
  pendingRestore = { clips, texts, tracks, duration };
  await useEditorStore.getState().openUrl(source.url);
}
