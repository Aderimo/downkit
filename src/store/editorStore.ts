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

/** Düzenleyiciye eklenmiş bir video/link. `source`/`stream` alanları store'daki
 * aynı adlı "aktif kaynak" alanlarının sahibidir; önizleme aktif olanı oynatır. */
export interface EditorSourceEntry {
  /** Oturum içinde tekil: s1, s2… (kaynaklar eklenme sırasıyla numaralanır). */
  id: string;
  source: EditorSource;
  /** Önizleme akışı; kimi linkte önizleme açılamaz (null). */
  stream: EditorStream | null;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
  /** "local" ya da platform kimliği ("youtube"…). */
  platform: string;
}

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

/** Geri alma adımı: kaynaklar, klipler ve yazılar birlikte. Kaynak girişleri
 * referans olarak saklanır (değişmez güncellendikleri için ucuzdur); silinen
 * bir kaynak geri alınca önizleme oturumuyla birlikte geri gelir. */
export interface Snapshot {
  sources: EditorSourceEntry[];
  clips: SeqClip[];
  texts: TextItem[];
  /** Adım anındaki önizlenen kaynak; geri alınca o da geri gelir. */
  activeSourceId: string | null;
}

interface EditorState {
  phase: Phase;
  source: EditorSource | null;
  stream: EditorStream | null;
  /** Eklenen tüm kaynaklar; `source`/`stream` aktif (önizlenen) olanı gösterir. */
  sources: EditorSourceEntry[];
  activeSourceId: string | null;
  /** Kaynak ekleme sürüyor / eklerken hata oldu. */
  addingSource: boolean;
  addError: LocalizedError | null;
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
  /** Açık projeye ikinci (üçüncü…) video/link ekler; sona tek klip olarak konur. */
  addSourceUrl: (url: string) => Promise<void>;
  addSourceFile: (path: string) => Promise<void>;
  /** Kaynağı ve ona ait klipleri kaldırır; son kaynaksa düzenleyici kapanır. */
  removeSource: (id: string) => void;
  /** Önizlemenin oynatacağı kaynağı değiştirir. */
  activateSource: (id: string) => void;
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
// Kaynak kimlikleri eklenme sırasıyla s1, s2… diye verilir: ilk kaynak açılırken
// sayaç sıfırlanır, böylece kaydedilen oturum geri yüklenince kliplerin
// sourceId'leri aynı kimliklerle yeniden eşleşir.
let sourceCounter = 0;

export const newClipId = () => crypto.randomUUID();

function newSourceId(): string {
  sourceCounter += 1;
  return `s${sourceCounter}`;
}

/** Klibin kaynağı: açık kimliği, yoksa ilk kaynak (eski oturumlar). */
export function clipSourceId(clip: SeqClip, sources: EditorSourceEntry[]): string | null {
  return clip.sourceId ?? sources[0]?.id ?? null;
}

/** Kaynağın süresi; bilinmiyorsa 0. */
export function sourceDurationOf(
  sources: EditorSourceEntry[],
  sourceId: string | undefined,
): number {
  const entry = sourceId ? sources.find((s) => s.id === sourceId) : sources[0];
  return entry?.duration ?? 0;
}

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
  sources: [] as EditorSourceEntry[],
  activeSourceId: null as string | null,
  addingSource: false,
  addError: null as LocalizedError | null,
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

/** Kaynak açılınca başlangıç klipleri: Ana Sayfa'daki bölüm ya da videonun tamamı. */
function startingClips(duration: number, sourceId: string, section?: TimeRange | null): SeqClip[] {
  if (section && section.end - section.start > 0.2) {
    return [
      {
        id: newClipId(),
        sourceId,
        track: 0,
        start: 0,
        srcStart: section.start,
        srcEnd: Math.min(section.end, duration),
        speed: 1,
        name: "",
      },
    ];
  }
  return initialClips(duration, newClipId(), sourceId);
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

/** Anlık görüntüye dönüldüğünde uygulanacak alanlar: kaynak listesi, klipler,
 * yazılar ve — etkin kaynak bu adımda yoksa ya da yenilenmişse — önizleme
 * alanları (source/stream/activeSourceId/duration). */
function restorePatch(snap: Snapshot): Partial<EditorState> {
  const st = useEditorStore.getState();
  const patch: Partial<EditorState> = {
    sources: snap.sources,
    clips: snap.clips,
    texts: snap.texts,
  };
  // Adım anında önizlenen kaynağa dönülür; o adımda yoksa ilk kaynağa düşülür.
  const active = snap.sources.find((s) => s.id === snap.activeSourceId) ?? snap.sources[0];
  if (!active) {
    patch.source = null;
    patch.stream = null;
    patch.activeSourceId = null;
    patch.duration = 0;
  } else if (active.id !== st.activeSourceId || active.source !== st.source || active.stream !== st.stream) {
    patch.source = active.source;
    patch.stream = active.stream;
    patch.activeSourceId = active.id;
    patch.duration = active.duration;
  }
  return patch;
}

/** O anki hâlin geri alma anlık görüntüsü. */
function snapshotOf(st: {
  sources: EditorSourceEntry[];
  clips: SeqClip[];
  texts: TextItem[];
  activeSourceId: string | null;
}): Snapshot {
  return {
    sources: st.sources,
    clips: st.clips,
    texts: st.texts,
    activeSourceId: st.activeSourceId,
  };
}

/** Eklenen kaynağı listeye ve zaman çizelgesinin sonuna (tek parça klip) koyar.
 * Geri alınabilir adım kaydedilir: Ctrl+Z kaynağı ve klibini geri kaldırır. */
function appendSource(entry: EditorSourceEntry) {
  const st = useEditorStore.getState();
  const start = sequenceEnd(st.clips);
  const clip: SeqClip = {
    id: newClipId(),
    sourceId: entry.id,
    track: 0,
    start,
    srcStart: 0,
    srcEnd: entry.duration,
    speed: 1,
    name: "",
  };
  const clips = [...st.clips, clip];
  const first = st.sources.length === 0;
  useEditorStore.setState({
    sources: [...st.sources, entry],
    addingSource: false,
    clips,
    past: first ? st.past : [...st.past, snapshotOf(st)].slice(-HISTORY_LIMIT),
    future: [],
    view: clampView(st.view, timelineExtent(clips, st.duration)),
    ...(first
      ? { source: entry.source, stream: entry.stream, activeSourceId: entry.id, duration: entry.duration }
      : {}),
  });
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
    sourceCounter = 0;
    const entry: EditorSourceEntry = {
      id: newSourceId(),
      source: { kind: "remote", url, metadata },
      stream: metadata.preview,
      title: metadata.title,
      duration,
      thumbnailUrl: metadata.thumbnailUrl,
      platform: metadata.platform,
    };
    const clips = startingClips(duration, entry.id, section);
    set({
      ...emptyState,
      phase: "ready",
      sources: [entry],
      activeSourceId: entry.id,
      source: entry.source,
      stream: entry.stream,
      duration,
      clips,
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
      sourceCounter = 0;
      const entry: EditorSourceEntry = {
        id: newSourceId(),
        source: { kind: "local", path, info: preview.info },
        stream: {
          kind: "file",
          url: preview.url,
          audioUrl: null,
          token: preview.token,
          hasVideo: preview.info.videoCodec !== null,
        },
        title: preview.info.fileName,
        duration,
        thumbnailUrl: null,
        platform: "local",
      };
      const clips = startingClips(duration, entry.id);
      set({
        ...emptyState,
        phase: "ready",
        sources: [entry],
        activeSourceId: entry.id,
        source: entry.source,
        stream: entry.stream,
        duration,
        clips,
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

  addSourceUrl: async (url) => {
    if (get().addingSource) return;
    const token = ++loadToken;
    set({ addingSource: true, addError: null });
    try {
      const result = await analyzeUrl(url);
      if (token !== loadToken) return;
      if (result.kind === "playlist") {
        set({
          addingSource: false,
          addError: { message: i18n.t("editor.playlistNotSupported"), detail: null },
        });
        return;
      }
      const duration = result.durationSeconds ?? 0;
      if (duration <= 0) {
        set({
          addingSource: false,
          addError: { message: i18n.t("editor.noDuration"), detail: null },
        });
        return;
      }
      appendSource({
        id: newSourceId(),
        source: { kind: "remote", url, metadata: result },
        stream: result.preview,
        title: result.title,
        duration,
        thumbnailUrl: result.thumbnailUrl,
        platform: result.platform,
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ addingSource: false, addError: localizeError(err, "error.analyzeFailed") });
    }
  },

  addSourceFile: async (path) => {
    if (get().addingSource) return;
    const token = ++loadToken;
    set({ addingSource: true, addError: null });
    try {
      const preview = await openLocalPreview(path);
      if (token !== loadToken) return;
      const duration = preview.info.durationSeconds ?? 0;
      if (duration <= 0) {
        set({
          addingSource: false,
          addError: { message: i18n.t("editor.noDuration"), detail: null },
        });
        return;
      }
      appendSource({
        id: newSourceId(),
        source: { kind: "local", path, info: preview.info },
        stream: {
          kind: "file",
          url: preview.url,
          audioUrl: null,
          token: preview.token,
          hasVideo: preview.info.videoCodec !== null,
        },
        title: preview.info.fileName,
        duration,
        thumbnailUrl: null,
        platform: "local",
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ addingSource: false, addError: localizeError(err, "error.probeFailed") });
    }
  },

  removeSource: (id) => {
    const st = get();
    const sources = st.sources.filter((s) => s.id !== id);
    if (sources.length === st.sources.length) return;
    if (sources.length === 0) {
      get().close();
      return;
    }
    const firstId = st.sources[0]?.id;
    const clips = st.clips.filter((c) => (c.sourceId ?? firstId) !== id);
    // Geri alınabilir adım: kaynak, klipleriyle birlikte geri getirilebilir
    // (girişler referans olarak saklandığı için önizleme oturumu da geri gelir).
    const patch: Partial<EditorState> = {
      sources,
      clips,
      selectedIds: [],
      past: [...st.past, snapshotOf(st)].slice(-HISTORY_LIMIT),
      future: [],
    };
    if (st.activeSourceId === id) {
      const active = sources[0];
      patch.source = active.source;
      patch.stream = active.stream;
      patch.activeSourceId = active.id;
      patch.duration = active.duration;
    }
    set(patch);
  },

  activateSource: (id) => {
    const st = get();
    const entry = st.sources.find((s) => s.id === id);
    if (!entry || st.activeSourceId === id) return;
    set({
      source: entry.source,
      stream: entry.stream,
      activeSourceId: id,
      duration: entry.duration,
    });
  },

  replaceStream: (stream) =>
    set((st) => ({
      stream,
      sources: st.sources.map((s) => (s.id === st.activeSourceId ? { ...s, stream } : s)),
    })),

  close: () => {
    loadToken += 1;
    sourceCounter = 0;
    resetPlayer();
    set({ phase: "empty", ...emptyState });
  },

  apply: (change) => {
    const { clips, past, selectedIds } = get();
    const next = change(clips);
    if (sameClips(clips, next)) return;
    const ids = new Set(next.map((c) => c.id));
    set({
      clips: next,
      past: [...past, snapshotOf(get())].slice(-HISTORY_LIMIT),
      future: [],
      selectedIds: selectedIds.filter((id) => ids.has(id)),
    });
  },

  applyTexts: (change) => {
    const { texts, past, selectedTextId } = get();
    const next = change(texts);
    if (next.length === texts.length && next.every((t, i) => t === texts[i])) return;
    set({
      texts: next,
      past: [...past, snapshotOf(get())].slice(-HISTORY_LIMIT),
      future: [],
      selectedTextId: next.some((t) => t.id === selectedTextId) ? selectedTextId : null,
    });
  },

  beginDrag: () => set({ dragOrigin: snapshotOf(get()) }),
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
    const { past, future } = get();
    const previous = past.at(-1);
    if (!previous) return;
    set({
      ...restorePatch(previous),
      past: past.slice(0, -1),
      future: [snapshotOf(get()), ...future],
      selectedIds: [],
      selectedTextId: null,
    });
  },

  redo: () => {
    const { past, future } = get();
    const next = future[0];
    if (!next) return;
    set({
      ...restorePatch(next),
      past: [...past, snapshotOf(get())],
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
    get().apply((clips) => clips.map((c) => (c.id === id && c.name !== name ? { ...c, name } : c))),

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

type SavedSource =
  | { kind: "remote"; id?: string; url: string; title: string; thumbnailUrl: string | null }
  | { kind: "local"; id?: string; path: string; title: string };

export interface SavedSession {
  /** Eklenme sırasıyla; kimlikler geri yüklenince aynı sırayla s1, s2… olur. */
  sources: SavedSource[];
  clips: SeqClip[];
  texts?: TextItem[];
  tracks?: TrackStates;
  savedAt: string;
}

/** Eski (tek kaynaklı) oturum kaydını da okur. */
export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (!parsed || !Array.isArray(parsed.clips)) return null;
    const sources = Array.isArray(parsed.sources)
      ? (parsed.sources as SavedSource[])
      : parsed.source
        ? [parsed.source as SavedSource]
        : [];
    if (sources.length === 0) return null;
    return { ...(parsed as unknown as SavedSession), sources };
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

/** Kayıtlı kaynağın kimliği: yeni kayıtlarda `id` alanından, eski kayıtlarda
 * sıradan (s1, s2…) varsayılır. */
function savedSourceId(saved: SavedSource, index: number): string {
  return saved.id ?? `s${index + 1}`;
}

/** Son projeyi açar: kaynaklar sırayla yüklenir; açılamayanlar atlanır ve
 * kliplerin sourceId'leri, kaydedilen kimliklerden çalışma zamanı kimliklerine
 * eşlenerek geri konur (düşen kaynağın klipleri de düşer). */
export async function resumeSession(): Promise<void> {
  const session = loadSession();
  if (!session) return;
  const editor = useEditorStore.getState();
  const [first, ...rest] = session.sources;
  if (first.kind === "remote") await editor.openUrl(first.url);
  else await editor.openFile(first.path);
  let st = useEditorStore.getState();
  if (st.phase !== "ready" || st.sources.length === 0) return;
  const idMap = new Map<string, string>();
  idMap.set(savedSourceId(first, 0), st.sources[0].id);
  const skipped: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const saved = rest[i];
    const before = useEditorStore.getState().sources.length;
    if (saved.kind === "remote") await useEditorStore.getState().addSourceUrl(saved.url);
    else await useEditorStore.getState().addSourceFile(saved.path);
    st = useEditorStore.getState();
    if (st.sources.length > before) {
      idMap.set(savedSourceId(saved, i + 1), st.sources[st.sources.length - 1].id);
    } else {
      skipped.push(saved.title);
    }
    // Ekleme hatası panelde kalıp sonraki eklemeleri engellemesin.
    if (st.addError) useEditorStore.setState({ addError: null });
  }
  const clips = session.clips.flatMap((clip) => {
    if (!clip.sourceId) return [clip];
    const mapped = idMap.get(clip.sourceId);
    return mapped ? [{ ...clip, sourceId: mapped }] : [];
  });
  useEditorStore.setState({
    clips,
    texts: session.texts ?? [],
    tracks: session.tracks ?? {},
    selectedIds: [],
    past: [],
    future: [],
    ...(skipped.length > 0
      ? {
          addError: {
            message: i18n.t("editor.resumeSkipped", { titles: skipped.join(", ") }),
            detail: null,
          },
        }
      : {}),
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Her değişiklikte (sürükleme bitince) son proje kısa bir gecikmeyle kaydedilir.
useEditorStore.subscribe((state, previous) => {
  if (state.phase !== "ready" || state.sources.length === 0 || state.dragOrigin) return;
  const dragEnded = previous.dragOrigin !== null && state.dragOrigin === null;
  if (
    !dragEnded &&
    state.clips === previous.clips &&
    state.texts === previous.texts &&
    state.tracks === previous.tracks &&
    state.sources === previous.sources
  )
    return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { sources, clips, texts, tracks } = useEditorStore.getState();
    if (sources.length === 0) return;
    const session: SavedSession = {
      sources: sources.map((entry) =>
        entry.source.kind === "remote"
          ? {
              kind: "remote",
              id: entry.id,
              url: entry.source.url,
              title: entry.title,
              thumbnailUrl: entry.thumbnailUrl,
            }
          : { kind: "local", id: entry.id, path: entry.source.path, title: entry.title },
      ),
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

/** Aktif kaynağın önizlemesini yeniler (bağlantı süresi dolduysa); klipler korunur. */
export async function reloadSource(): Promise<void> {
  const st = useEditorStore.getState();
  const entry = st.sources.find((s) => s.id === st.activeSourceId);
  if (!entry || entry.source.kind !== "remote") return;
  const result = await analyzeUrl(entry.source.url);
  if (result.kind === "playlist") return;
  const duration = result.durationSeconds ?? entry.duration;
  const fresh: EditorSourceEntry = {
    ...entry,
    source: { kind: "remote", url: entry.source.url, metadata: result },
    stream: result.preview,
    duration,
  };
  useEditorStore.setState({
    sources: st.sources.map((s) => (s.id === entry.id ? fresh : s)),
    source: fresh.source,
    stream: fresh.stream,
    duration,
  });
}
