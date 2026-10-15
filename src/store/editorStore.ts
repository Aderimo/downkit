import { create } from "zustand";
import type { ProgressBarOption } from "../lib/reelTemplates";
import i18n from "../i18n";
import type { Chapter, PreviewStream } from "../types/media";
import type { LocalMediaInfo } from "../types/convert";
import type { TimeRange } from "../lib/timeRange";
import { openLocalPreview } from "../lib/tauri-api";
import { localizeError, type LocalizedError } from "../lib/errors";
import { clampView, fullView, type TimelineView } from "../lib/timeline";
import {
  initialClips,
  sequenceEnd,
  type SeqClip,
  type TrackState,
  type TrackStates,
} from "../lib/sequence";
import type { TextItem } from "../lib/textItems";
import type { BlurItem, ImageItem, MusicItem } from "../lib/layers";
import type { EffectItem } from "../lib/effectLane";
import { usePlayerStore } from "./playerStore";
import { expandGroups } from "../lib/clipGroups";
import { swapPlacement } from "../lib/multiFormat";
import type { SplitLayout } from "../lib/splitLayout";

export type EditorSource = { kind: "local"; path: string; info: LocalMediaInfo };

/** Düzenleyiciye eklenmiş bir video. `source`/`stream` alanları store'daki
 * aynı adlı "aktif kaynak" alanlarının sahibidir; önizleme aktif olanı oynatır. */
export interface EditorSourceEntry {
  /** Oturum içinde tekil: s1, s2… (kaynaklar eklenme sırasıyla numaralanır). */
  id: string;
  source: EditorSource;
  /** Önizleme akışı. */
  stream: EditorStream | null;
  title: string;
  duration: number;
  thumbnailUrl: string | null;
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
  /** Sığdırırken bantlar siyah yerine bulanık görüntüyle dolsun. */
  frameBlur: boolean;
  /** Sığdırırken bantlar yukarıdan aşağı renk geçişiyle dolsun (bulanık değilse). */
  frameGradient: [string, string] | null;
  /** Videonun ne kadarının geçtiğini gösteren bant (yoksa yok). */
  progressBar: ProgressBarOption | null;
  /** Yüz takibi: kaynak yolu → [kaynak saniyesi, kırpma konumu] izi (yoksa elle konum). */
  frameTrack: Record<string, [number, number][]> | null;
  /** İzin hesaplandığı çıkış oranı (genişlik / yükseklik); başka biçimde ona uyarlanır. */
  frameTrackAspect: number | null;
  /** Aynı anda dışa aktarılacak ek biçimler (önizlenen `frame` dışında). */
  alsoFrames: Exclude<FrameAspect, "original">[];
  /** Çıktı bu boyuta (MB) sığsın (ör. Discord 10 MB); yoksa kalite odaklı. */
  targetSizeMb: number | null;
  /** Ekran kartıyla hızlı dışa aktarma. */
  fastExport: boolean;
  /** Kırpmada kalan bölgenin yeri: 0 = sol/üst, 1 = sağ/alt. */
  framePosition: number;
  /** Kamera + oyun düzeni (yayın kaydından dikey video); `split` boşsa varsayılan. */
  frameSplit: boolean;
  split: SplitLayout | null;
  /** Videonun yanına aynı adla altyazı dosyası (.srt) da kaydedilsin. */
  subtitleFile: boolean;
  /** Sosyal medya ses seviyesi (−14 LUFS). */
  loudness: boolean;
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
  /** Üste bindirilen resimler ve müzik izleri. */
  images: ImageItem[];
  music: MusicItem[];
  blurs: BlurItem[];
  /** Efekt şeridindeki bloklar. */
  effects: EffectItem[];
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
  /** Resim katmanları ve müzik izleri. */
  images: ImageItem[];
  music: MusicItem[];
  /** Gizlenecek bölgeler (bulanık/pikselli). */
  blurs: BlurItem[];
  /** Efekt şeridi: aralığa uygulanan filtre / efekt / hareket blokları. */
  effects: EffectItem[];
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

  openFile: (path: string) => Promise<void>;
  /** Açık projeye ikinci (üçüncü…) video/link ekler; sona tek klip olarak konur. */
  /** Kaynak ekler. `toTimeline`: zaman çizelgesinin sonuna da klip olarak konsun
   * (yoksa yalnızca zaman çizelgesi boşken). Eşzamanlı çağrılar sıraya girer. */
  addSourceFile: (path: string, toTimeline?: boolean) => Promise<void>;
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
  /** Klipleri ve katmanları birlikte değiştirir: tek geri alma adımı (ör. sesi ayır). */
  applyEdit: (change: {
    clips?: SeqClip[];
    texts?: TextItem[];
    images?: ImageItem[];
    music?: MusicItem[];
    blurs?: BlurItem[];
    effects?: EffectItem[];
  }) => void;
  /** Resim ve müzik katmanlarını değiştirir (geri alınabilir). */
  applyLayers: (change: {
    images?: ImageItem[];
    music?: MusicItem[];
    blurs?: BlurItem[];
    effects?: EffectItem[];
  }) => void;
  /** Kaydırıcı sürüklenirken (beginDrag/endDrag arasında) geçmişe yazmadan. */
  dragLayers: (change: {
    images?: ImageItem[];
    music?: MusicItem[];
    blurs?: BlurItem[];
    effects?: EffectItem[];
  }) => void;
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
  /** İzi sessize alır ya da gizler. */
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
  return {
    output: "video",
    videoFormat: "mp4",
    maxHeight: null,
    audioFormat: "mp3",
    audioBitrateKbps: 192,
    merge: true,
    precise: false,
    outputName: name,
    gifFps: 12,
    gifWidth: 480,
    frame: "original",
    frameFit: false,
    frameBlur: false,
    frameGradient: null,
    frameTrack: null,
    frameTrackAspect: null,
    alsoFrames: [],
    progressBar: null,
    targetSizeMb: null,
    fastExport: false,
    framePosition: 0.5,
    frameSplit: false,
    split: null,
    subtitleFile: false,
    loudness: false,
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
  images: [] as ImageItem[],
  music: [] as MusicItem[],
  blurs: [] as BlurItem[],
  effects: [] as EffectItem[],
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
  return source.info.chapters ?? [];
}

/** Görünür aralığın sınırı: klipler kaynaktan uzun olabilir (yavaşlatılınca). */
/** İçeriğin sonu: kaynağın süresi ya da en sağdaki klibin sonu. */
export function contentEnd(clips: SeqClip[], duration: number): number {
  return Math.max(sequenceEnd(clips), duration, 1);
}

/** Zaman çizelgesinin gezilebilen uzunluğu: içeriğin sağında boş alan kalır
 *; klip oraya taşınabilir, arada kalan boşluk siyah ekran olur.
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
/** Geri al / yinele sonrası seçim: adımda hâlâ var olan klip ve yazı seçili kalır
 * (panelde ayar geri alınınca panel kapanmasın). */
function keptSelection(
  st: Pick<EditorState, "selectedIds" | "selectedTextId">,
  snap: Snapshot,
): Pick<EditorState, "selectedIds" | "selectedTextId"> {
  return {
    selectedIds: st.selectedIds.filter((id) => snap.clips.some((c) => c.id === id)),
    selectedTextId:
      st.selectedTextId && snap.texts.some((t) => t.id === st.selectedTextId)
        ? st.selectedTextId
        : null,
  };
}

function restorePatch(snap: Snapshot): Partial<EditorState> {
  const st = useEditorStore.getState();
  const patch: Partial<EditorState> = {
    sources: snap.sources,
    clips: snap.clips,
    texts: snap.texts,
    images: snap.images,
    music: snap.music,
    blurs: snap.blurs,
    effects: snap.effects,
  };
  // Adım anında önizlenen kaynağa dönülür; o adımda yoksa ilk kaynağa düşülür.
  const active = snap.sources.find((s) => s.id === snap.activeSourceId) ?? snap.sources[0];
  if (!active) {
    patch.source = null;
    patch.stream = null;
    patch.activeSourceId = null;
    patch.duration = 0;
  } else if (
    active.id !== st.activeSourceId ||
    active.source !== st.source ||
    active.stream !== st.stream
  ) {
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
  images: ImageItem[];
  music: MusicItem[];
  blurs: BlurItem[];
  effects: EffectItem[];
  activeSourceId: string | null;
}): Snapshot {
  return {
    sources: st.sources,
    clips: st.clips,
    texts: st.texts,
    images: st.images,
    music: st.music,
    blurs: st.blurs,
    effects: st.effects,
    activeSourceId: st.activeSourceId,
  };
}

/** Eklenen kaynağı Medyam'a koyar; `toTimeline` ya da zaman çizelgesi boşsa sonuna da
 * tek parça klip olarak ekler (çok dosya içe aktarınca zaman çizelgesi dolmasın).
 * Geri alınabilir adım kaydedilir: Ctrl+Z kaynağı ve klibini geri kaldırır. */
let addQueue: Promise<void> = Promise.resolve();

function appendSource(entry: EditorSourceEntry, toTimeline: boolean) {
  const st = useEditorStore.getState();
  const place = toTimeline || st.clips.length === 0;
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
  const clips = place ? [...st.clips, clip] : st.clips;
  const first = st.sources.length === 0;
  useEditorStore.setState({
    sources: [...st.sources, entry],
    addingSource: false,
    clips,
    past: first ? st.past : [...st.past, snapshotOf(st)].slice(-HISTORY_LIMIT),
    future: [],
    view: clampView(st.view, timelineExtent(clips, st.duration)),
    ...(first
      ? {
          source: entry.source,
          stream: entry.stream,
          activeSourceId: entry.id,
          duration: entry.duration,
        }
      : {}),
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  phase: "empty",
  ...emptyState,
  snapping: true,
  exportOptions: initialExport(""),

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

  addSourceFile: (path, toTimeline = false) => {
    // Sırayla: önceki ekleme bitmeden gelen dosya düşürülmez, beklenir.
    const run = async () => {
      const token = loadToken;
      set({ addingSource: true, addError: null });
      try {
        const preview = await openLocalPreview(path);
        // Bu arada başka bir dosya açıldıysa (openFile) bu ekleme geçersiz.
        if (token !== loadToken) return set({ addingSource: false });
        const duration = preview.info.durationSeconds ?? 0;
        if (duration <= 0) {
          set({
            addingSource: false,
            addError: { message: i18n.t("editor.noDuration"), detail: null },
          });
          return;
        }
        appendSource(
          {
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
          },
          toTimeline,
        );
      } catch (err) {
        if (token !== loadToken) return set({ addingSource: false });
        set({ addingSource: false, addError: localizeError(err, "error.probeFailed") });
      }
    };
    addQueue = addQueue.then(run, run);
    return addQueue;
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

  applyEdit: (change) => {
    const { past, clips, texts, images, music, blurs, effects, selectedIds, selectedTextId } =
      get();
    const next = {
      clips: change.clips ?? clips,
      texts: change.texts ?? texts,
      images: change.images ?? images,
      music: change.music ?? music,
      blurs: change.blurs ?? blurs,
      effects: change.effects ?? effects,
    };
    if (
      sameClips(clips, next.clips) &&
      next.texts === texts &&
      next.images === images &&
      next.music === music &&
      next.blurs === blurs &&
      next.effects === effects
    ) {
      return;
    }
    const ids = new Set(next.clips.map((c) => c.id));
    set({
      ...next,
      past: [...past, snapshotOf(get())].slice(-HISTORY_LIMIT),
      future: [],
      selectedIds: selectedIds.filter((id) => ids.has(id)),
      selectedTextId: next.texts.some((t) => t.id === selectedTextId) ? selectedTextId : null,
    });
  },

  applyLayers: (change) => {
    const { past, images, music, blurs, effects } = get();
    const next = {
      images: change.images ?? images,
      music: change.music ?? music,
      blurs: change.blurs ?? blurs,
      effects: change.effects ?? effects,
    };
    if (
      next.images === images &&
      next.music === music &&
      next.blurs === blurs &&
      next.effects === effects
    )
      return;
    set({ ...next, past: [...past, snapshotOf(get())].slice(-HISTORY_LIMIT), future: [] });
  },
  dragLayers: (change) => set(change),

  beginDrag: () => set({ dragOrigin: snapshotOf(get()) }),
  dragTo: (clips) => set({ clips }),
  dragTexts: (texts) => set({ texts }),
  endDrag: () => {
    const { dragOrigin, clips, texts, images, music, blurs, effects, past } = get();
    const changed =
      dragOrigin &&
      (!sameClips(dragOrigin.clips, clips) ||
        dragOrigin.texts !== texts ||
        dragOrigin.images !== images ||
        dragOrigin.music !== music ||
        dragOrigin.blurs !== blurs ||
        dragOrigin.effects !== effects);
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
      ...keptSelection(get(), previous),
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
      ...keptSelection(get(), next),
    });
  },

  // Klip ve yazı seçimi birbirini dışlar: sağ panel hangisini göstereceğini bilsin.
  select: (ids) => {
    // Gruptaki bir klip seçilince grubun tamamı seçilir.
    const selectedIds = expandGroups(get().clips, ids);
    set(selectedIds.length > 0 ? { selectedIds, selectedTextId: null } : { selectedIds });
  },
  selectText: (id) => set(id ? { selectedTextId: id, selectedIds: [] } : { selectedTextId: null }),
  toggleSelect: (id) => {
    const { selectedIds, clips } = get();
    const members = expandGroups(clips, [id]);
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((s) => !members.includes(s))
        : [...selectedIds, ...members.filter((m) => !selectedIds.includes(m))],
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
  setExportOptions: (patch) => {
    const s = get();
    const from = s.exportOptions.frame;
    const to = patch.frame ?? from;
    if (to === from) {
      set({ exportOptions: { ...s.exportOptions, ...patch } });
      return;
    }
    // Biçim değişti: yazılar o biçimdeki yerlerine geçer (geçmiş de aynı biçimde kalsın).
    const swap = (snap: Snapshot): Snapshot => ({
      ...snap,
      texts: swapPlacement(snap.texts, from, to),
    });
    set({
      exportOptions: { ...s.exportOptions, ...patch },
      texts: swapPlacement(s.texts, from, to),
      past: s.past.map(swap),
      future: s.future.map(swap),
      dragOrigin: s.dragOrigin ? swap(s.dragOrigin) : null,
    });
  },
  setLastJobIds: (lastJobIds) => set({ lastJobIds }),
}));
