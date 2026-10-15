import { LaneMenu } from "./LaneMenu";
import { ContextMenu } from "../ui/ContextMenu";
import { allBeatTimes } from "../../lib/beats";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { isXfadeKind, XFADE_MIME } from "../../lib/xfade";
import { addMarkers, findHighlights, markerTimes, useMarkersStore } from "../../lib/markers";
import { useTranslation } from "react-i18next";
import {
  Blend,
  ChevronLeft,
  ChevronRight,
  Flag,
  Zap,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  ImageDown,
  Magnet,
  Maximize,
  Pause,
  Play,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Type,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Lock,
  LockOpen,
  FoldHorizontal,
  Link2,
} from "lucide-react";
import {
  contentEnd,
  sourceChapters,
  sourceDurationOf,
  timelineExtent,
  useEditorStore,
  type EditorSourceEntry,
} from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import {
  MAX_TRACKS,
  SPEED_PRESETS,
  clipEnd,
  clipFades,
  clipLength,
  clipVolume,
  moveClip,
  sequenceEnd,
  snap,
  snapCandidates,
  trimEnd,
  trimStart,
  type SeqClip,
} from "../../lib/sequence";
import {
  followPlayhead,
  formatTick,
  formatTimecode,
  fullView,
  panView,
  peakInRange,
  storyboardFrame,
  thumbTimes,
  tickStep,
  timeToX,
  xToTime,
  zoomView,
  type TimelineView,
} from "../../lib/timeline";
import {
  ensureWaveform,
  nearestFromEntries,
  requestThumbs,
  useThumbStore,
  useWaveStore,
} from "../../lib/thumbCache";
import { savePlayheadFrame } from "../../lib/frameSave";
import { localizeError } from "../../lib/errors";
import { refreshPlayback, seekTimeline } from "../../lib/sequencePlayer";
import { keyTimes } from "../../lib/clipTransform";
import { zoomFactor, type ZoomSpan } from "../../lib/clipZoom";
import { placeZoomSpan, selectZoom, useZoomUi, zoomOnTimeline } from "../../lib/zoomActions";
import { beginTransformEdit, endTransformEdit } from "../../lib/transformActions";
import {
  dropTransition,
  dropXfade,
  nextAdjacent,
  previewXfade,
  cutNear,
  moveXfade,
  deleteSelected,
  duplicateSelected,
  dropSourceClip,
  keepOnlySelected,
  playClip,
  redo,
  setClipSpeed,
  splitAtPlayhead,
  SOURCE_DRAG_MIME,
  addText,
  stepSeconds,
  toggleMuteSelected,
  toggleAudioLink,
  rippleDeleteSelected,
  copySelected,
  pasteAtPlayhead,
  hasClipboard,
  groupSelected,
  ungroupSelected,
  closeAllGaps,
  toEnd,
  toStart,
  togglePlay,
  undo,
  zoomTimeline,
  zoomToFit,
  type TransitionEdge,
  type TransitionKind,
} from "../../lib/editorActions";
import { formatCombo, useShortcutStore, type ShortcutAction } from "../../lib/shortcuts";
import { moveText, trimText, type TextItem } from "../../lib/textItems";
import { TextMenu } from "./TextMenu";
import { LaneHeader, LaneRow } from "./LayerLanes";
import {
  audioLaneNumbers,
  LANE_H,
  laneEnd,
  laneStart,
  moveLaneItem,
  MUSIC_H,
  packRows,
  type Lane,
  type LaneDragMode,
  type LaneItem,
  type LaneKind,
} from "../../lib/laneItems";
import {
  removeBlur,
  removeImage,
  removeMusic,
  isBlockSelected,
  useBlockSelection,
  useBlurSelection,
  useLayerSelection,
  type BlockRef,
} from "../../lib/layerActions";
import { useAddTool, useEditTool } from "../../lib/editorPanel";
import { removeEffect, selectEffectItem, useEffectSelection } from "../../lib/effectActions";
import type { EffectItem } from "../../lib/effectLane";
import { silenceKey, useSilenceStore, useTimelineSilences } from "../../lib/silence";
import { isSelected, useFillers, useFillerStore } from "../../lib/fillers";
import { useShortenStore } from "../../lib/shorten";
import { useSuggestStore } from "../../lib/clipSuggest";
import { moveClips } from "../../lib/clipGroups";
import { musicLane } from "../../lib/layers";
import { MAX_AUDIO_LANES } from "../../lib/sequence";
import { dropFxAtTime, dropFxOnClip, FX_MIME, readFx } from "../../lib/fxDrag";
import { clipLabel } from "../../lib/sequence";
import type { Chapter, Storyboard } from "../../types/media";

const RULER_H = 28;
const TRACK_H = 58;
const NEW_TRACK_H = 30;
/** Yazı satırı (en az bir yazı varken). */
const TEXT_H = 26;
const EDGE_GRAB = 10;
const SNAP_PX = 8;
const TRACK_COLORS = ["#5b7cff", "#a855f7", "#14b8a6"];

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Kısayolun ilk tuşuyla birlikte ipucu: "Böl (S)". */
function useHint() {
  const map = useShortcutStore((s) => s.map);
  return (label: string, action: ShortcutAction) =>
    map[action][0] ? `${label} (${formatCombo(map[action][0])})` : label;
}

/** Sürükleme: imleç hareket ettikçe çağrılır, bırakınca `onEnd`. */
function drag(
  event: ReactPointerEvent,
  onMove: (e: PointerEvent, moved: boolean) => void,
  onEnd?: (moved: boolean) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  const move = (e: PointerEvent) => {
    if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) moved = true;
    onMove(e, moved);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd?.(moved);
  };
  window.addEventListener("pointercancel", up);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

interface Row {
  track: number;
  top: number;
  height: number;
  /** Henüz klip olmayan, üst katman için bırakma alanı. */
  empty: boolean;
}

function layoutRows(clips: SeqClip[], offset: number): Row[] {
  const used = Math.max(1, ...clips.map((c) => c.track + 1));
  const rows: Row[] = [];
  let top = RULER_H + offset;
  if (used < MAX_TRACKS) {
    rows.push({ track: used, top, height: NEW_TRACK_H, empty: true });
    top += NEW_TRACK_H;
  }
  for (let track = used - 1; track >= 0; track -= 1) {
    rows.push({ track, top, height: TRACK_H, empty: false });
    top += TRACK_H;
  }
  return rows;
}

function trackAtY(rows: Row[], y: number): number {
  for (const row of rows) if (y < row.top + row.height) return row.track;
  return 0;
}

type TileSource =
  | { kind: "storyboard"; storyboard: Storyboard }
  | { kind: "thumbs"; token: string; entries: Record<string, string>; keys: number[] }
  | { kind: "none" };

/** Bir kaynağın zaman çizelgesi görseli: kareler, dalga formu, bölümler, kare
 * oranı ve süre. Her klip kendi kaynağınınkini kullanır; önizlemede hangi
 * kaynağın oynadığı (activeSourceId) bunu etkilemez. */
interface SourceVisuals {
  tiles: TileSource;
  waveform: number[] | null;
  chapters: Chapter[];
  aspect: number;
  duration: number;
}

/** Kaynak kimliği → görsel paket. Storyboard'u olmayan her kaynak için kaba
 * kare seti ve dalga formu istenir (kendi önizleme token'ı üzerinden). */
function useSourceVisuals(sources: EditorSourceEntry[]): Map<string, SourceVisuals> {
  const byToken = useThumbStore((s) => s.byToken);
  const waves = useWaveStore((s) => s.byToken);

  useEffect(() => {
    for (const entry of sources) {
      const storyboard: Storyboard | null = null;
      const token = entry.stream?.token;
      if (storyboard || !token || entry.duration <= 0) continue;
      requestThumbs(token, thumbTimes(entry.duration, 36));
      ensureWaveform(token, entry.duration);
    }
  }, [sources]);

  return useMemo(() => {
    const map = new Map<string, SourceVisuals>();
    for (const entry of sources) {
      const storyboard: Storyboard | null = null;
      const token = entry.stream?.token ?? null;
      let tiles: TileSource = { kind: "none" };
      if (storyboard) {
        tiles = { kind: "storyboard", storyboard };
      } else if (token) {
        const entries = byToken[token] ?? {};
        const keys = Object.keys(entries)
          .map(Number)
          .sort((a, b) => a - b);
        tiles = { kind: "thumbs", token, entries, keys };
      }
      map.set(entry.id, {
        tiles,
        waveform: token ? (waves[token] ?? null) : null,
        chapters: sourceChapters(entry.source),
        aspect: frameAspect(storyboard, entry.source),
        duration: entry.duration,
      });
    }
    return map;
  }, [sources, byToken, waves]);
}

/** Kayıt sırasında konan an işaretlerinin zaman çizelgesindeki yerleri. */
function useTimelineMarkers(): number[] {
  const clips = useEditorStore((s) => s.clips);
  const sources = useEditorStore((s) => s.sources);
  const byPath = useMarkersStore((s) => s.byPath);
  useEffect(() => {
    for (const entry of sources) useMarkersStore.getState().load(entry.source.path);
  }, [sources]);
  return useMemo(() => {
    const all: number[] = [];
    for (const entry of sources) {
      const marks = byPath[entry.source.path];
      if (marks?.length) all.push(...markerTimes(clips, entry.id, sources[0]?.id, marks));
    }
    return all.sort((a, b) => a - b);
  }, [clips, sources, byPath]);
}

/** Zaman çizelgesi paneli: yüksekliği çalışma alanındaki panelden gelir. */
export function Timeline() {
  const { t } = useTranslation();
  const clips = useEditorStore((s) => s.clips);
  const sources = useEditorStore((s) => s.sources);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const view = useEditorStore((s) => s.view);
  const duration = useEditorStore((s) => s.duration);
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(areaRef);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [textMenu, setTextMenu] = useState<{ x: number; y: number; textId: string } | null>(null);
  const [xfadeGhost, setXfadeGhost] = useState<number | null>(null);

  const texts = useEditorStore((s) => s.texts);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  // Çakışan yazılar ayrı satırlarda (üst üste binip birbirini örtmesin).
  const textPack = useMemo(() => packRows(texts), [texts]);
  const textRow = texts.length > 0 ? TEXT_H * textPack.count : 0;
  const images = useEditorStore((s) => s.images);
  const blurs = useEditorStore((s) => s.blurs);
  const music = useEditorStore((s) => s.music);
  const effects = useEditorStore((s) => s.effects);
  const blurSelected = useBlurSelection((s) => s.id);
  const layerSelected = useLayerSelection((s) => s.id);
  const blockSelection = useBlockSelection((s) => s.blocks);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [laneMenu, setLaneMenu] = useState<{
    x: number;
    y: number;
    kind: LaneKind;
    id: string;
  } | null>(null);
  const effectSelected = useEffectSelection((s) => s.id);
  // Üstte: yazı, efekt, logo, gizleme; ortada video izleri; en altta müzik. Çakışan
  // bloklar şeridin içinde alt satırlara dizilir.
  const topLanes: Lane[] = [];
  let laneTop = RULER_H + textRow;
  const addLane = (kind: LaneKind, items: LaneItem[]) => {
    if (items.length === 0) return;
    const pack = packRows(items.map((i) => ({ id: i.id, start: laneStart(i), end: laneEnd(i) })));
    const height = LANE_H * pack.count;
    topLanes.push({ kind, top: laneTop, height, items, rows: pack.rows, rowCount: pack.count });
    laneTop += height;
  };
  addLane("effect", effects);
  addLane("image", images);
  addLane("blur", blurs);
  const topOffset = laneTop - RULER_H;
  const rows = useMemo(() => layoutRows(clips, topOffset), [clips, topOffset]);
  const videoHeight = topOffset + rows.reduce((h, r) => h + r.height, 0);
  const audioLanes: Lane[] = audioLaneNumbers(music).map((n, i) => ({
    kind: "music",
    audioLane: n,
    top: RULER_H + videoHeight + i * MUSIC_H,
    height: MUSIC_H,
    items: music.filter((m) => musicLane(m) === n),
  }));
  const lanes = [...topLanes, ...audioLanes];
  const tracksHeight = videoHeight + audioLanes.length * MUSIC_H;
  const extent = timelineExtent(clips, duration);
  const secondsPerPx = width > 0 ? (view.end - view.start) / width : 0;
  // Her kaynağın kareleri/dalga formu/bölümleri kendi token'ından beslenir.
  const visuals = useSourceVisuals(sources);
  const markers = useTimelineMarkers();
  const firstClipId = useMemo(
    () => [...clips].sort((a, b) => a.start - b.start || a.track - b.track)[0]?.id ?? null,
    [clips],
  );

  // Ctrl+tekerlek yakınlaştırır, tekerlek kaydırır. React'in tekerlek olayı
  // pasif olduğu için sayfa yakınlaştırmasını engellemek üzere yerel dinleyici.
  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditorStore.getState();
      const ext = timelineExtent(state.clips, state.duration);
      const rect = element.getBoundingClientRect();
      if (e.ctrlKey) {
        const anchor = xToTime(e.clientX - rect.left, state.view, rect.width);
        state.setView(zoomView(state.view, Math.exp(e.deltaY * 0.0015), anchor, ext));
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const perPx = (state.view.end - state.view.start) / rect.width;
        state.setView(panView(state.view, delta * perPx, ext));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  // Görünür karelerin kaynak anları toplanıp eksikler istenir (storyboard yoksa):
  // yakınlaştırdıkça kareler ayrıntılanır. Her klip kendi kaynağının token'ına
  // istek atar; kaynak başına ayrı kare genişliği (oranı) kullanılır.
  useEffect(() => {
    if (width === 0) return;
    const byToken = new Map<string, number[]>();
    for (const clip of clips) {
      const clipSourceId = clip.sourceId ?? sources[0]?.id;
      const visual = clipSourceId ? visuals.get(clipSourceId) : undefined;
      if (!visual || visual.tiles.kind !== "thumbs") continue;
      const tileWidth = Math.max(24, (TRACK_H - 4) * visual.aspect);
      const left = timeToX(clip.start, view, width);
      const right = timeToX(clipEnd(clip), view, width);
      if (right < 0 || left > width) continue;
      const first = Math.max(0, Math.floor(-left / tileWidth));
      const last = Math.ceil((Math.min(width, right) - left) / tileWidth);
      const times = byToken.get(visual.tiles.token) ?? [];
      for (let i = first; i < last; i += 1) {
        const tt = clip.start + (i + 0.5) * tileWidth * secondsPerPx;
        times.push(clip.srcStart + (tt - clip.start) * clip.speed);
      }
      byToken.set(visual.tiles.token, times);
    }
    for (const [token, times] of byToken) requestThumbs(token, times);
  }, [visuals, clips, view, width, secondsPerPx, sources]);

  function timeAt(clientX: number): number {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return xToTime(clientX - rect.left, useEditorStore.getState().view, rect.width);
  }

  /** Boş alana ya da cetvele basınca: seçimi kaldır, imleci taşı, sürükleyerek gez. */
  function onAreaPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    if (!e.shiftKey) {
      useEditorStore.getState().select([]);
      useEditorStore.getState().selectText(null);
      // Efekt / gizleme bloğu seçimi de kalkar: sonraki ayarlar eski bloğa yazılmasın.
      useEffectSelection.getState().select(null);
      useBlurSelection.getState().select(null);
      useLayerSelection.getState().select(null, null);
    }
    useBlockSelection.getState().set([]);
    seekTimeline(timeAt(e.clientX));
    const area = areaRef.current?.getBoundingClientRect();
    const onRuler = !area || e.clientY - area.top < RULER_H;
    // Cetvelde sürükleme imleci gezdirir; izlerin boş yerinde sürükleme kutu seçimi yapar.
    if (onRuler) {
      drag(e, (ev) => seekTimeline(timeAt(ev.clientX)));
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    drag(
      e,
      (ev, moved) => {
        if (!moved || !area) return;
        setMarquee({
          left: Math.min(x0, ev.clientX) - area.left,
          top: Math.min(y0, ev.clientY) - area.top,
          width: Math.abs(ev.clientX - x0),
          height: Math.abs(ev.clientY - y0),
        });
        selectInRect(x0, y0, ev.clientX, ev.clientY, e.shiftKey);
      },
      () => setMarquee(null),
    );
  }

  /** Kutu seçimi: dikdörtgene değen klipler ve bloklar seçilir (Shift: eklenir). */
  function selectInRect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const box = {
      left: Math.min(x0, x1),
      right: Math.max(x0, x1),
      top: Math.min(y0, y1),
      bottom: Math.max(y0, y1),
    };
    const hits = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
    };
    const root = areaRef.current;
    if (!root) return;
    const clipIds = [...root.querySelectorAll("[data-clip]")]
      .filter(hits)
      .map((el) => el.getAttribute("data-clip")!)
      .filter(Boolean);
    const blocks: BlockRef[] = [
      ...[...root.querySelectorAll("[data-text]")]
        .filter(hits)
        .map((el) => ({ kind: "text" as const, id: el.getAttribute("data-text")! })),
      ...[...root.querySelectorAll("[data-lane-item]")].filter(hits).map((el) => ({
        kind: el.getAttribute("data-lane") as BlockRef["kind"],
        id: el.getAttribute("data-lane-item")!,
      })),
    ];
    const store = useEditorStore.getState();
    const prevBlocks = add ? useBlockSelection.getState().blocks : [];
    store.select(add ? [...new Set([...store.selectedIds, ...clipIds])] : clipIds);
    useBlockSelection
      .getState()
      .set([...prevBlocks, ...blocks.filter((b) => !isBlockSelected(prevBlocks, b.kind, b.id))]);
  }

  function startClipDrag(e: ReactPointerEvent, clip: SeqClip, mode: "move" | "start" | "end") {
    if (e.button !== 0) return;
    const store = useEditorStore.getState();
    if (store.tracks[clip.track]?.locked) {
      e.stopPropagation();
      store.select([clip.id]);
      return;
    }
    if (e.shiftKey || e.ctrlKey) {
      e.stopPropagation();
      store.toggleSelect(clip.id);
      return;
    }
    if (!store.selectedIds.includes(clip.id)) store.select([clip.id]);
    const origin = store.clips;
    // Birden çok klip seçiliyse (ya da grup) taşırken hepsi birlikte gider.
    const together = useEditorStore.getState().selectedIds;
    const multi = mode === "move" && together.length > 1;
    const grab = timeAt(e.clientX) - clip.start;
    const length = clipLength(clip);
    const areaTop = areaRef.current?.getBoundingClientRect().top ?? 0;
    const tolerance = SNAP_PX * secondsPerPx;
    const candidates = [
      ...snapCandidates(origin, clip.id, usePlayerStore.getState().currentTime),
      ...allBeatTimes(store.music),
    ];
    store.beginDrag();
    let didMove = false;

    drag(
      e,
      (ev, moved) => {
        if (!moved) return;
        didMove = true;
        const time = timeAt(ev.clientX);
        // Alt basılıyken mıknatıs geçici olarak tersine döner.
        const useSnap = useEditorStore.getState().snapping !== ev.altKey;
        if (mode === "move") {
          let start = time - grab;
          let line: number | null = null;
          if (useSnap) {
            const byStart = snap(start, candidates, tolerance);
            const byEnd = snap(start + length, candidates, tolerance) - length;
            if (byStart !== start && Math.abs(byStart - start) <= Math.abs(byEnd - start)) {
              line = byStart;
              start = byStart;
            } else if (Math.abs(byEnd - start) > 1e-9) {
              line = byEnd + length;
              start = byEnd;
            }
          }
          setSnapLine(line);
          const track = trackAtY(rows, ev.clientY - areaTop);
          useEditorStore
            .getState()
            .dragTo(
              multi
                ? moveClips(origin, together, start - clip.start, track - clip.track)
                : moveClip(origin, clip.id, start, track),
            );
        } else {
          const snapped = useSnap ? snap(time, candidates, tolerance) : time;
          setSnapLine(snapped !== time ? snapped : null);
          const next =
            mode === "start"
              ? trimStart(origin, clip.id, snapped)
              : trimEnd(
                  origin,
                  clip.id,
                  snapped,
                  sourceDurationOf(useEditorStore.getState().sources, clip.sourceId),
                );
          useEditorStore.getState().dragTo(next);
          // Kenarı sürüklerken o karedeki görüntü gösterilir.
          const edited = next.find((c) => c.id === clip.id);
          if (edited) seekTimeline(mode === "start" ? edited.start : clipEnd(edited) - 0.04);
        }
      },
      () => {
        setSnapLine(null);
        useEditorStore.getState().endDrag();
        // Çoklu seçimde bir klibe tıklayıp bırakmak seçimi o klibe (ve grubuna) indirir:
        // renk/efekt ayarı yalnızca tıklanan klibe yazılsın.
        if (!didMove && together.length > 1) useEditorStore.getState().select([clip.id]);
      },
    );
  }

  /** Yazı bloğunu taşır ya da kenarından kısaltır/uzatır (mıknatıs kliplere de yapışır). */
  function startTextDrag(e: ReactPointerEvent, item: TextItem, mode: "move" | "start" | "end") {
    if (e.button !== 0) return;
    const store = useEditorStore.getState();
    store.selectText(item.id);
    const grab = timeAt(e.clientX) - item.start;
    const length = item.end - item.start;
    const tolerance = SNAP_PX * secondsPerPx;
    const candidates = [
      ...snapCandidates(store.clips, "", usePlayerStore.getState().currentTime),
      ...store.texts.filter((t) => t.id !== item.id).flatMap((t) => [t.start, t.end]),
      ...allBeatTimes(store.music),
    ];
    store.beginDrag();
    drag(
      e,
      (ev, moved) => {
        if (!moved) return;
        const s = useEditorStore.getState();
        const origin = s.dragOrigin?.texts ?? s.texts;
        const time = timeAt(ev.clientX);
        const useSnap = s.snapping !== ev.altKey;
        if (mode === "move") {
          let start = time - grab;
          if (useSnap) {
            const byStart = snap(start, candidates, tolerance);
            const byEnd = snap(start + length, candidates, tolerance) - length;
            start = Math.abs(byStart - start) <= Math.abs(byEnd - start) ? byStart : byEnd;
          }
          s.dragTexts(moveText(origin, item.id, start));
        } else {
          const at = useSnap ? snap(time, candidates, tolerance) : time;
          setSnapLine(at !== time ? at : null);
          s.dragTexts(trimText(origin, item.id, mode, at));
        }
      },
      () => {
        setSnapLine(null);
        useEditorStore.getState().endDrag();
      },
    );
  }

  /** Sağ tıkta yalnızca seçer (sürükleme başlatmadan). */
  function startLayerSelectOnly(kind: LaneKind, id: string) {
    const store = useEditorStore.getState();
    store.select([]);
    store.selectText(null);
    useBlurSelection.getState().select(kind === "blur" ? id : null);
    useLayerSelection
      .getState()
      .select(
        kind === "music" || kind === "image" ? kind : null,
        kind === "music" || kind === "image" ? id : null,
      );
    if (kind === "effect") selectEffectItem(id);
    else useEffectSelection.getState().select(null);
  }

  function openLaneTool(kind: LaneKind) {
    if (kind === "effect") useEditTool.getState().setTool("effects");
    else
      useAddTool
        .getState()
        .setTool(kind === "music" ? "music" : kind === "image" ? "images" : "blur");
  }

  /** Logo, gizleme ve müzik blokları: taşı ya da kenarından kısalt (kliplere ve imlece yapışır). */
  function startLayerDrag(
    e: ReactPointerEvent,
    kind: LaneKind,
    item: LaneItem,
    mode: LaneDragMode,
  ) {
    if (e.button !== 0) return;
    const store = useEditorStore.getState();
    // Blok seçilince klip/yazı seçimi kalkar: Delete ve sağ panel bloğa gider.
    store.select([]);
    store.selectText(null);
    useBlurSelection.getState().select(kind === "blur" ? item.id : null);
    useLayerSelection
      .getState()
      .select(
        kind === "music" || kind === "image" ? kind : null,
        kind === "music" || kind === "image" ? item.id : null,
      );
    if (kind === "effect") selectEffectItem(item.id);
    else useEffectSelection.getState().select(null);
    const key =
      kind === "music"
        ? "music"
        : kind === "image"
          ? "images"
          : kind === "effect"
            ? "effects"
            : "blurs";
    const tolerance = SNAP_PX * secondsPerPx;
    const candidates = [
      ...snapCandidates(store.clips, "", usePlayerStore.getState().currentTime),
      ...allBeatTimes(store.music),
    ];
    const t0 = timeAt(e.clientX);
    const length = laneEnd(item) - laneStart(item);
    store.beginDrag();
    drag(
      e,
      (ev, moved) => {
        if (!moved) return;
        const s = useEditorStore.getState();
        const origin = ((s.dragOrigin?.[key] ?? s[key]) as LaneItem[]).find(
          (i) => i.id === item.id,
        );
        if (!origin) return;
        let delta = timeAt(ev.clientX) - t0;
        if (s.snapping !== ev.altKey) {
          const edges =
            mode === "end"
              ? [laneEnd(origin)]
              : mode === "start"
                ? [laneStart(origin)]
                : [laneStart(origin), laneStart(origin) + length];
          let best = delta;
          let gap = Infinity;
          for (const edge of edges) {
            const snapped = snap(edge + delta, candidates, tolerance) - edge;
            if (snapped !== delta && Math.abs(snapped - delta) < gap) {
              gap = Math.abs(snapped - delta);
              best = snapped;
            }
          }
          delta = best;
        }
        // Ses bloğu taşınırken imlecin altındaki ses izine geçer (en alttakinin altı: yeni iz).
        let lane: number | undefined;
        if (kind === "music" && mode === "move" && audioLanes.length > 0) {
          const areaTop = areaRef.current?.getBoundingClientRect().top ?? 0;
          const y = ev.clientY - areaTop - audioLanes[0].top;
          const row = Math.floor(y / MUSIC_H);
          const last = audioLanes[audioLanes.length - 1].audioLane ?? 0;
          if (row >= 0)
            lane = Math.min(
              MAX_AUDIO_LANES - 1,
              row < audioLanes.length ? (audioLanes[row].audioLane ?? row) : last + 1,
            );
        }
        const list = (s[key] as LaneItem[]).map((i) => {
          if (i.id !== item.id) return i;
          const moved = moveLaneItem(i, mode, origin, delta);
          return lane !== undefined ? { ...moved, lane } : moved;
        });
        s.dragLayers({ [key]: list });
      },
      (moved) => {
        useEditorStore.getState().endDrag();
        if (moved && (kind === "music" || kind === "effect")) refreshPlayback();
        // Bloğa tıklanınca kendi paneli açılır: filtre bloğu Filtreler'de, diğerleri Efektler'de.
        if (!moved && kind === "effect")
          useEditTool.getState().setTool((item as EffectItem).look?.filter ? "filters" : "effects");
        else if (!moved && kind !== "blur")
          useAddTool.getState().setTool(kind === "music" ? "music" : "images");
        if (!moved && kind === "blur") useAddTool.getState().setTool("blur");
      },
    );
  }

  function removeLayer(kind: LaneKind, id: string) {
    if (kind === "music") removeMusic(id);
    else if (kind === "image") removeImage(id);
    else if (kind === "effect") removeEffect(id);
    else removeBlur(id);
    refreshPlayback();
  }

  function openMenu(e: ReactMouseEvent, clip: SeqClip) {
    e.preventDefault();
    e.stopPropagation();
    const store = useEditorStore.getState();
    if (!store.selectedIds.includes(clip.id)) store.select([clip.id]);
    setMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden" data-tour="editor-timeline">
      <Toolbar />
      <div className="dk-scroll flex min-h-0 flex-1 overflow-y-auto">
        <TrackHeaders rows={rows} textRow={textRow} lanes={lanes} height={RULER_H + tracksHeight} />
        <div
          ref={areaRef}
          className="relative min-w-0 flex-1 cursor-default touch-none overflow-hidden select-none"
          // İçerikten kısa kalırsa kabın kalanını da kaplar: boş yerde tıklama ve kutu seçimi çalışır.
          style={{ minHeight: RULER_H + tracksHeight }}
          onPointerDown={onAreaPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => {
            // Medya panelinden sürüklenen kaynak: bırakılabilir olduğunu göster.
            if (
              e.dataTransfer.types.includes(SOURCE_DRAG_MIME) ||
              e.dataTransfer.types.includes(FX_MIME)
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const fx = readFx(e.dataTransfer.getData(FX_MIME));
            if (fx) {
              e.preventDefault();
              dropFxAtTime(timeAt(e.clientX), fx);
              return;
            }
            const sourceId = e.dataTransfer.getData(SOURCE_DRAG_MIME);
            if (!sourceId) return;
            e.preventDefault();
            const areaTop = areaRef.current?.getBoundingClientRect().top ?? 0;
            dropSourceClip(sourceId, timeAt(e.clientX), trackAtY(rows, e.clientY - areaTop));
          }}
        >
          {marquee ? (
            <div
              data-marquee
              className="pointer-events-none absolute z-30 rounded border border-[var(--dk-accent)] bg-[var(--dk-accent)]/15"
              style={marquee}
            />
          ) : null}
          {width > 0 ? (
            <>
              <Ruler view={view} width={width} />
              {textRow > 0 ? (
                <div
                  className="absolute inset-x-0 border-t border-[var(--dk-border)] bg-[#a855f7]/5"
                  style={{ top: RULER_H, height: textRow }}
                >
                  {texts.map((item) => {
                    const left = timeToX(item.start, view, width);
                    const right = timeToX(item.end, view, width);
                    if (right < -4 || left > width + 4) return null;
                    return (
                      <div
                        key={item.id}
                        data-text={item.id}
                        title={item.text}
                        className={`absolute flex cursor-grab items-center overflow-hidden rounded-md bg-[#a855f7]/80 px-2 text-[11px] font-medium whitespace-nowrap text-white active:cursor-grabbing ${
                          item.id === selectedTextId ||
                          isBlockSelected(blockSelection, "text", item.id)
                            ? "shadow-[0_0_0_2px_white]"
                            : ""
                        }`}
                        style={{
                          left,
                          width: Math.max(4, right - left),
                          top: (textPack.rows.get(item.id) ?? 0) * TEXT_H + 2,
                          height: TEXT_H - 4,
                        }}
                        onPointerDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const edge = Math.min(EDGE_GRAB, rect.width / 3);
                          startTextDrag(
                            e,
                            item,
                            x <= edge ? "start" : x >= rect.width - edge ? "end" : "move",
                          );
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          useEditorStore.getState().selectText(item.id);
                          setTextMenu({ x: e.clientX, y: e.clientY, textId: item.id });
                        }}
                      >
                        <Type size={11} className="mr-1 shrink-0" />
                        <span className="truncate">{item.text || " "}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {lanes.map((lane) => (
                <LaneRow
                  key={`${lane.kind}-${lane.audioLane ?? ""}`}
                  lane={lane}
                  view={view}
                  width={width}
                  selectedId={
                    lane.kind === "blur"
                      ? blurSelected
                      : lane.kind === "effect"
                        ? effectSelected
                        : layerSelected
                  }
                  multiSelected={blockSelection}
                  onMenu={(e, kind, item) => {
                    startLayerSelectOnly(kind, item.id);
                    setLaneMenu({ x: e.clientX, y: e.clientY, kind, id: item.id });
                  }}
                  onDrag={startLayerDrag}
                  onRemove={removeLayer}
                  onOpen={(kind) =>
                    kind === "effect"
                      ? useEditTool.getState().setTool("effects")
                      : useAddTool
                          .getState()
                          .setTool(
                            kind === "music" ? "music" : kind === "image" ? "images" : "blur",
                          )
                  }
                />
              ))}
              {rows.map((row) => (
                <div
                  key={row.track}
                  className={`absolute inset-x-0 border-t border-[var(--dk-border)] ${
                    row.empty ? "" : "bg-[var(--dk-bg)]/35"
                  }`}
                  style={{ top: row.top, height: row.height }}
                >
                  {row.empty ? (
                    <p className="pointer-events-none flex h-full items-center px-3 text-[11px] text-[var(--dk-text-muted)]/70">
                      {t("editor.newLayerHint")}
                    </p>
                  ) : null}
                </div>
              ))}
              {/* İçeriğin bittiği yerden sonrası daha koyu: klipler buraya taşınabilir. */}
              {(() => {
                const left = Math.max(0, timeToX(sequenceEnd(clips), view, width));
                return left < width ? (
                  <div
                    className="pointer-events-none absolute right-0 border-l border-dashed border-[var(--dk-border-strong)] bg-black/25"
                    style={{ left, top: RULER_H, height: tracksHeight }}
                  />
                ) : null;
              })()}
              {clips.map((clip) => {
                const row = rows.find((r) => r.track === clip.track);
                if (!row) return null;
                const left = timeToX(clip.start, view, width);
                const right = timeToX(clipEnd(clip), view, width);
                if (right < -4 || left > width + 4) return null;
                const clipSourceId = clip.sourceId ?? sources[0]?.id;
                return (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    isFirst={clip.id === firstClipId}
                    left={left}
                    width={right - left}
                    areaWidth={width}
                    top={row.top + 2}
                    height={row.height - 4}
                    selected={selectedIds.includes(clip.id)}
                    secondsPerPx={secondsPerPx}
                    sourceBadge={
                      sources.length > 1
                        ? sources.findIndex((s) => s.id === clipSourceId) + 1
                        : null
                    }
                    visuals={clipSourceId ? visuals.get(clipSourceId) : undefined}
                    onDrag={startClipDrag}
                    onMenu={openMenu}
                  />
                );
              })}
              {xfadeGhost !== null ? (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 -translate-x-1/2 bg-[var(--dk-sun)]"
                  style={{ left: xfadeGhost }}
                  data-xfade-ghost
                />
              ) : null}
              {/* Klipler arası geçişler: kesimin üstünde küçük düğme (tıklayınca seçilir,
                  sürükleyince başka kesime taşınır). */}
              {clips.map((clip) => {
                if (!clip.xfade) return null;
                const row = rows.find((r) => r.track === clip.track);
                const next = nextAdjacent(clips, clip);
                if (!row || !next) return null;
                const cut = timeToX(clipEnd(clip), view, width);
                if (cut < -12 || cut > width + 12) return null;
                const half = clip.xfade.duration / 2 / Math.max(secondsPerPx, 1e-9);
                return (
                  <button
                    key={`xf-${clip.id}`}
                    type="button"
                    data-xfade={clip.id}
                    title={t("editor.xfadeMarker", {
                      name: t(`editor.xfadeName.${clip.xfade.kind}`),
                      seconds: clip.xfade.duration.toFixed(1),
                    })}
                    aria-label={t("editor.xfadeMarker", {
                      name: t(`editor.xfadeName.${clip.xfade.kind}`),
                      seconds: clip.xfade.duration.toFixed(1),
                    })}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      // Sürüklenirse bırakılan yere en yakın kesime taşınır; tıklanırsa seçilir.
                      const area = areaRef.current?.getBoundingClientRect();
                      let lastX = e.clientX;
                      drag(
                        e,
                        (ev, moved) => {
                          lastX = ev.clientX;
                          if (moved && area) setXfadeGhost(ev.clientX - area.left);
                        },
                        (moved) => {
                          setXfadeGhost(null);
                          if (!moved) {
                            useEditorStore.getState().select([clip.id]);
                            previewXfade(clip.id);
                            return;
                          }
                          const target = cutNear(useEditorStore.getState().clips, timeAt(lastX));
                          if (target) moveXfade(clip.id, target.id);
                        },
                      );
                    }}
                    onClick={(e) => {
                      // Klavyeyle (Enter / boşluk): seç ve oynat.
                      if (e.detail !== 0) return;
                      useEditorStore.getState().select([clip.id]);
                      previewXfade(clip.id);
                    }}
                    className="absolute z-20 flex -translate-x-1/2 cursor-grab items-center justify-center rounded-md border border-[var(--dk-border-strong)] bg-[var(--dk-sun)] text-[#111] hover:scale-110 active:cursor-grabbing"
                    style={{
                      left: cut,
                      top: row.top + row.height / 2 - 11,
                      width: Math.max(22, Math.min(2 * half, 60)),
                      height: 22,
                    }}
                  >
                    <Blend size={13} strokeWidth={2.5} />
                  </button>
                );
              })}
              {snapLine !== null ? (
                <div
                  className="pointer-events-none absolute top-0 z-20 w-px bg-[#FFD43B]"
                  style={{ left: timeToX(snapLine, view, width), height: RULER_H + tracksHeight }}
                />
              ) : null}
              <SilenceBands view={view} width={width} height={tracksHeight} />
              {/* An işaretleri: cetvelde sarı bayrak, tıklayınca o ana gidilir. */}
              {markers.map((m) => {
                const x = timeToX(m, view, width);
                if (x < -8 || x > width + 8) return null;
                return (
                  <button
                    key={`mk-${m}`}
                    type="button"
                    data-marker={m}
                    title={t("editor.markerAt", { time: formatTimecode(m, 1) })}
                    aria-label={t("editor.markerAt", { time: formatTimecode(m, 1) })}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => seekTimeline(m)}
                    className="absolute z-20 -translate-x-1/2 text-[#FFD43B] drop-shadow hover:scale-125"
                    style={{ left: x, top: 2 }}
                  >
                    <Flag size={14} fill="currentColor" />
                  </button>
                );
              })}
              <Playhead view={view} width={width} height={RULER_H + tracksHeight} extent={extent} />
            </>
          ) : null}
        </div>
      </div>
      <div className="pl-12">
        <ScrollMap extent={extent} />
      </div>
      {menu ? <ClipMenu {...menu} onClose={() => setMenu(null)} /> : null}
      {textMenu ? <TextMenu {...textMenu} onClose={() => setTextMenu(null)} /> : null}
      {laneMenu ? (
        <LaneMenu
          {...laneMenu}
          onClose={() => setLaneMenu(null)}
          onOpen={(kind) => openLaneTool(kind)}
          onRemove={removeLayer}
        />
      ) : null}
    </section>
  );
}

/** "Kısalt" paneli açıkken bulunan sessizlikler: kesilecekler kırmızı taralı, kalacaklar soluk.
 * Cetveldeki etikete tıklayınca kes / kalsın değişir. */
function SilenceBands({
  view,
  width,
  height,
}: {
  view: TimelineView;
  width: number;
  height: number;
}) {
  const { t } = useTranslation();
  const open = useAddTool((s) => s.tool === "autocut");
  const ranges = useTimelineSilences();
  const kept = useSilenceStore((s) => s.kept);
  const toggleKept = useSilenceStore((s) => s.toggleKept);
  const fillers = useFillers();
  const choice = useFillerStore((s) => s.choice);
  const plan = useShortenStore((s) => s.plan);
  const skipped = useShortenStore((s) => s.skipped);
  const sentences = plan?.sentences.filter((x) => !skipped.includes(x.textId)) ?? [];
  const suggestions = useSuggestStore((s) => s.list) ?? [];
  if (
    !open ||
    (ranges.length === 0 &&
      fillers.length === 0 &&
      sentences.length === 0 &&
      suggestions.length === 0)
  )
    return null;
  return (
    <>
      {suggestions.map((x, i) => {
        const left = timeToX(x.start, view, width);
        const right = timeToX(x.end, view, width);
        if (right < 0 || left > width) return null;
        return (
          <div
            key={`g-${x.start}`}
            data-suggestion-band={i + 1}
            className="pointer-events-none absolute z-10 rounded-sm border-2 border-[#4ade80] bg-[#4ade80]/10"
            style={{ left, width: Math.max(4, right - left), top: RULER_H, height }}
          >
            <span className="absolute top-0.5 left-0.5 rounded bg-[#4ade80] px-1 text-[9px] font-bold text-[#111]">
              {i + 1}
            </span>
          </div>
        );
      })}
      {sentences.map((x) => {
        const left = timeToX(x.start, view, width);
        const right = timeToX(x.end, view, width);
        if (right < 0 || left > width) return null;
        return (
          <div
            key={`s-${x.textId}`}
            data-sentence-band={x.textId}
            title={t("shorten.band", { text: x.text })}
            className="pointer-events-none absolute z-10 border-x-2 border-[#f87171] bg-[#f87171]/30"
            style={{ left, width: Math.max(2, right - left), top: RULER_H, height }}
          />
        );
      })}
      {fillers.map((h) => {
        if (!isSelected(h, choice)) return null;
        const left = timeToX(h.start, view, width);
        const right = timeToX(h.end, view, width);
        if (right < 0 || left > width) return null;
        return (
          <div
            key={`f-${h.key}`}
            data-filler-band={h.word}
            title={t("fillers.band", { word: h.word })}
            className="pointer-events-none absolute z-10 border-x border-[#fb923c]/80 bg-[#fb923c]/25"
            style={{ left, width: Math.max(2, right - left), top: RULER_H, height }}
          />
        );
      })}
      {ranges.map((r) => {
        const left = timeToX(r.start, view, width);
        const right = timeToX(r.end, view, width);
        if (right < 0 || left > width) return null;
        const key = silenceKey(r);
        const keep = kept.includes(key);
        const label = t(keep ? "autoCut.bandKept" : "autoCut.bandCut", {
          seconds: (r.end - r.start).toFixed(1),
        });
        return (
          <div
            key={key}
            className="pointer-events-none absolute top-0 z-10"
            style={{ left, width: Math.max(2, right - left), height: RULER_H + height }}
          >
            <div
              data-silence-band={key}
              className={`absolute inset-x-0 bottom-0 border-x ${keep ? "border-white/20 bg-white/5" : "border-[#f87171]/70 bg-[repeating-linear-gradient(135deg,rgba(248,113,113,0.28)_0_6px,rgba(248,113,113,0.12)_6px_12px)]"}`}
              style={{ top: RULER_H }}
            />
            {right - left > 18 ? (
              <button
                type="button"
                title={label}
                aria-label={label}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleKept(key)}
                className={`pointer-events-auto absolute top-[3px] left-1/2 -translate-x-1/2 rounded px-1 font-mono text-[9px] leading-[14px] whitespace-nowrap ${keep ? "bg-white/15 text-white/70" : "bg-[#f87171] text-[#111]"}`}
              >
                {(r.end - r.start).toFixed(1)}s
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function frameAspect(
  storyboard: Storyboard | null,
  source: EditorSourceEntry["source"] | null,
): number {
  if (storyboard) return storyboard.width / storyboard.height;
  const w = source?.info.width;
  const h = source?.info.height;
  // Dikey videolarda kareler çok daralmasın.
  return w && h ? Math.min(Math.max(w / h, 0.56), 2.4) : 16 / 9;
}

interface ClipBlockProps {
  clip: SeqClip;
  /** Turda vurgulanacak (zaman çizelgesindeki ilk) klip mi. */
  isFirst: boolean;
  left: number;
  width: number;
  areaWidth: number;
  top: number;
  height: number;
  selected: boolean;
  secondsPerPx: number;
  /** Birden çok kaynakta klibin kaynak numarası (1'den başlar); tek kaynakta null. */
  sourceBadge: number | null;
  /** Klibin kendi kaynağının görseli (kare/dalga formu/bölüm/oran/süre). */
  visuals: SourceVisuals | undefined;
  onDrag: (e: ReactPointerEvent, clip: SeqClip, mode: "move" | "start" | "end") => void;
  onMenu: (e: ReactMouseEvent, clip: SeqClip) => void;
}

function ClipBlock({
  clip,
  isFirst,
  left,
  width,
  areaWidth,
  top,
  height,
  selected,
  secondsPerPx,
  sourceBadge,
  visuals,
  onDrag,
  onMenu,
}: ClipBlockProps) {
  const color = TRACK_COLORS[clip.track % TRACK_COLORS.length];
  // Geçiş sürüklenirken bırakılacak uç: kenara yakınsa o uç (ve oradaki kesim), ortadaysa iki uç.
  const [dropEdge, setDropEdge] = useState<TransitionEdge | "fx" | null>(null);
  const tiles = visuals?.tiles ?? ({ kind: "none" } as TileSource);
  const waveform = visuals?.waveform ?? null;
  const chapters = visuals?.chapters ?? [];
  const aspect = visuals?.aspect ?? 16 / 9;
  const duration = visuals?.duration ?? clip.srcEnd;
  const waveHeight = waveform ? 14 : 0;
  const tileHeight = height - 4 - waveHeight;
  const tileWidth = Math.max(24, tileHeight * aspect);
  const first = Math.max(0, Math.floor(-left / tileWidth));
  const last = Math.ceil((Math.min(areaWidth, left + width) - left) / tileWidth);
  const label = clipLabel(clip);

  const tileNodes: ReactNode[] = [];
  for (let i = first; i < last; i += 1) {
    const x = i * tileWidth;
    const tt = clip.start + (x + tileWidth / 2) * secondsPerPx;
    const src = Math.min(duration, clip.srcStart + (tt - clip.start) * clip.speed);
    const style = { left: x, width: tileWidth - 1, height: tileHeight };
    if (tiles.kind === "storyboard") {
      const frame = storyboardFrame(tiles.storyboard, src);
      if (!frame) continue;
      tileNodes.push(
        <div
          key={i}
          className="absolute top-0 bg-no-repeat"
          style={{
            ...style,
            backgroundImage: `url("${frame.url}")`,
            backgroundSize: `${tiles.storyboard.columns * tileWidth}px auto`,
            backgroundPosition: `-${frame.column * tileWidth}px -${frame.row * tileHeight}px`,
          }}
        />,
      );
    } else if (tiles.kind === "thumbs") {
      const url = nearestFromEntries(tiles.entries, tiles.keys, src);
      tileNodes.push(
        url ? (
          <img
            key={i}
            src={url}
            alt=""
            draggable={false}
            className="absolute top-0 object-cover"
            style={style}
          />
        ) : (
          <div key={i} className="absolute top-0 animate-pulse bg-white/5" style={style} />
        ),
      );
    }
  }

  return (
    <div
      data-tour={isFirst ? "editor-clip" : undefined}
      data-clip={clip.id}
      className={`absolute cursor-grab overflow-hidden rounded-lg bg-[var(--dk-surface-2)] active:cursor-grabbing ${
        dropEdge === "both" || dropEdge === "fx"
          ? "z-10 shadow-[0_0_0_2px_var(--dk-accent),0_0_18px_var(--dk-accent)]"
          : selected
            ? "z-10 shadow-[0_0_0_2px_white]"
            : ""
      }`}
      style={{ left, width: Math.max(3, width), top, height, border: `2px solid ${color}` }}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const edge = Math.min(EDGE_GRAB, rect.width / 3);
        onDrag(e, clip, x <= edge ? "start" : x >= rect.width - edge ? "end" : "move");
      }}
      onDoubleClick={() => playClip(clip.id)}
      onContextMenu={(e) => onMenu(e, clip)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FX_MIME)) {
          e.preventDefault();
          e.stopPropagation();
          setDropEdge("fx");
          return;
        }
        if (
          !e.dataTransfer.types.includes("application/x-downkit-transition") &&
          !e.dataTransfer.types.includes(XFADE_MIME)
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDropEdge(transitionEdge(e));
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(e) => {
        setDropEdge(null);
        const fx = readFx(e.dataTransfer.getData(FX_MIME));
        if (fx) {
          e.preventDefault();
          e.stopPropagation();
          dropFxOnClip(clip.id, fx);
          return;
        }
        const xfade = e.dataTransfer.getData(XFADE_MIME);
        if (isXfadeKind(xfade)) {
          e.preventDefault();
          e.stopPropagation();
          dropXfade(clip.id, xfade, transitionEdge(e));
          return;
        }
        const kind = e.dataTransfer.getData("application/x-downkit-transition");
        if (!kind) return;
        e.preventDefault();
        e.stopPropagation();
        dropTransition(clip.id, kind as TransitionKind, transitionEdge(e));
      }}
      title={`${label} · ${formatTimecode(clip.srcStart, 1)} → ${formatTimecode(clip.srcEnd, 1)}`}
    >
      <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: tileHeight }}>
        {tileNodes}
      </div>
      {waveform ? (
        <ClipWave
          clip={clip}
          peaks={waveform}
          duration={duration}
          left={left}
          width={width}
          areaWidth={areaWidth}
          secondsPerPx={secondsPerPx}
          height={waveHeight}
          color={color}
        />
      ) : null}
      <FadeMarks clip={clip} secondsPerPx={secondsPerPx} />
      <KeyMarks clip={clip} secondsPerPx={secondsPerPx} bottom={waveHeight + 2} />
      <ZoomBands clip={clip} secondsPerPx={secondsPerPx} top={tileHeight - 12} />
      {dropEdge === "start" || dropEdge === "end" ? (
        <div
          className={`pointer-events-none absolute inset-y-0 z-10 w-1.5 bg-[var(--dk-accent)] shadow-[0_0_14px_var(--dk-accent)] ${
            dropEdge === "start" ? "left-0" : "right-0"
          }`}
        />
      ) : null}
      <ChapterMarks
        clip={clip}
        chapters={chapters}
        secondsPerPx={secondsPerPx}
        width={width}
        bottom={waveHeight + 4}
      />
      {width > 34 ? (
        <span className="pointer-events-none absolute top-1 left-2 flex max-w-[calc(100%-16px)] items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {sourceBadge !== null ? (
            <span className="shrink-0 rounded bg-white/20 px-1 font-mono text-[10px]">
              {sourceBadge}
            </span>
          ) : null}
          <span className="truncate">{label}</span>
          {clip.speed !== 1 ? (
            <span className="shrink-0 rounded bg-[#FFD43B] px-1 text-[10px] font-bold text-black">
              {clip.speed}×
            </span>
          ) : null}
          {clipVolume(clip) === 0 ? (
            <VolumeX size={12} className="shrink-0 text-[var(--dk-error)]" />
          ) : null}
          {clip.group ? (
            <Link2 size={12} className="shrink-0 text-[var(--dk-accent-hover)]" aria-hidden />
          ) : null}
        </span>
      ) : null}
      <span
        className={`absolute inset-y-0 left-0 cursor-ew-resize ${selected ? "bg-white/90" : "hover:bg-white/40"}`}
        style={{ width: selected ? 6 : EDGE_GRAB - 2 }}
      />
      <span
        className={`absolute inset-y-0 right-0 cursor-ew-resize ${selected ? "bg-white/90" : "hover:bg-white/40"}`}
        style={{ width: selected ? 6 : EDGE_GRAB - 2 }}
      />
    </div>
  );
}

/** Bırakma noktası klibin kenarına yakınsa o uç: genişliğin %30'u, en fazla 60 px. */
function transitionEdge(e: ReactDragEvent<HTMLDivElement>): TransitionEdge {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const zone = Math.min(rect.width * 0.3, 60);
  return x <= zone ? "start" : x >= rect.width - zone ? "end" : "both";
}

/** Zamanlı yakınlaştırmalar: klibin üstünde mor bant. Gövdesi taşır, kenarları uzatır;
 * tıklayınca seçilir (panelde ve videoda düzenlenir). */
function ZoomBands({
  clip,
  secondsPerPx,
  top,
}: {
  clip: SeqClip;
  secondsPerPx: number;
  top: number;
}) {
  const { t } = useTranslation();
  const selected = useZoomUi((s) => s.selected);
  if (secondsPerPx <= 0 || !clip.zooms?.length) return null;

  function drag(e: ReactPointerEvent, zoom: ZoomSpan, mode: "move" | "start" | "end") {
    e.stopPropagation();
    e.preventDefault();
    selectZoom(clip, zoom);
    const startX = e.clientX;
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    let began = false;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * secondsPerPx * clip.speed;
      if (!began) {
        if (Math.abs(ev.clientX - startX) < 3) return;
        beginTransformEdit();
        began = true;
      }
      const a = mode === "end" ? zoom.start : zoom.start + delta;
      const b = mode === "start" ? zoom.end : zoom.end + delta;
      placeZoomSpan(clip.id, zoom.id, a, b, true, mode === "move" ? "move" : "resize");
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      if (began) endTransformEdit();
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  }

  return (
    <>
      {clip.zooms.map((zoom) => {
        const span = zoomOnTimeline(clip, zoom);
        if (!span) return null;
        const on = selected?.zoomId === zoom.id;
        const width = Math.max(6, (span.end - span.start) / secondsPerPx);
        return (
          <div
            key={zoom.id}
            data-zoom-band={zoom.id}
            role="button"
            aria-label={t("zoom.band", { n: zoomFactor(zoom).toFixed(1) })}
            title={t("zoom.band", { n: zoomFactor(zoom).toFixed(1) })}
            onPointerDown={(e) => drag(e, zoom, "move")}
            onClick={(e) => e.stopPropagation()}
            className={`absolute z-[3] flex h-3 cursor-grab items-center overflow-hidden rounded-sm text-[9px] leading-none font-bold text-white ${
              on ? "bg-[#a855f7] ring-1 ring-white" : "bg-[#a855f7]/80 hover:bg-[#a855f7]"
            }`}
            style={{ left: (span.start - clip.start) / secondsPerPx, width, top }}
          >
            <span
              className="h-full w-1.5 shrink-0 cursor-ew-resize bg-white/40"
              onPointerDown={(e) => drag(e, zoom, "start")}
            />
            <span className="min-w-0 flex-1 truncate px-0.5">
              {width > 34 ? `${zoomFactor(zoom).toFixed(1)}×` : ""}
            </span>
            <span
              className="h-full w-1.5 shrink-0 cursor-ew-resize bg-white/40"
              onPointerDown={(e) => drag(e, zoom, "end")}
            />
          </div>
        );
      })}
    </>
  );
}

/** Dönüşümün anahtar kareleri: klibin altında elmaslar; tıklayınca imleç oraya gider. */
function KeyMarks({
  clip,
  secondsPerPx,
  bottom,
}: {
  clip: SeqClip;
  secondsPerPx: number;
  bottom: number;
}) {
  const { t } = useTranslation();
  const times = keyTimes(clip.transform).filter(
    (k) => k >= clip.srcStart - 1e-6 && k <= clip.srcEnd + 1e-6,
  );
  if (secondsPerPx <= 0 || times.length === 0) return null;
  return (
    <>
      {times.map((k) => {
        const at = clip.start + (k - clip.srcStart) / clip.speed;
        return (
          <button
            key={k}
            type="button"
            data-key-mark={k}
            aria-label={t("transform.goToKey", { time: formatTimecode(at, 2) })}
            title={t("transform.goToKey", { time: formatTimecode(at, 2) })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              seekTimeline(at);
            }}
            className="absolute z-[2] h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-black bg-[#ffd43b] hover:scale-125"
            style={{ left: (at - clip.start) / secondsPerPx, bottom }}
          />
        );
      })}
    </>
  );
}

/** Açılma/kararma süresi kadar köşeden köşeye koyulaşan gölge. */
function FadeMarks({ clip, secondsPerPx }: { clip: SeqClip; secondsPerPx: number }) {
  const [fadeIn, fadeOut] = clipFades(clip);
  if (secondsPerPx <= 0 || (fadeIn <= 0 && fadeOut <= 0)) return null;
  return (
    <>
      {fadeIn > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/75 to-transparent"
          style={{ width: fadeIn / secondsPerPx }}
        />
      ) : null}
      {fadeOut > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/75 to-transparent"
          style={{ width: fadeOut / secondsPerPx }}
        />
      ) : null}
    </>
  );
}

/** Klibin kaynak aralığına düşen bölüm başlangıçları: kesikli sarı çizgi ve ad.
 * Kaynak zamanına bağlı oldukları için klip taşınınca onunla gider. */
function ChapterMarks({
  clip,
  chapters,
  secondsPerPx,
  width,
  bottom,
}: {
  clip: SeqClip;
  chapters: Chapter[];
  secondsPerPx: number;
  width: number;
  bottom: number;
}) {
  if (chapters.length === 0 || secondsPerPx <= 0) return null;
  const marks = chapters
    .filter((c) => c.end > clip.srcStart + 0.05 && c.start < clip.srcEnd - 0.05)
    .map((c, i, all) => {
      const x = Math.max(0, (c.start - clip.srcStart) / clip.speed / secondsPerPx);
      const next = all[i + 1];
      const nextX = next ? (next.start - clip.srcStart) / clip.speed / secondsPerPx : width;
      return { chapter: c, x, room: nextX - x, index: chapters.indexOf(c) };
    });
  return (
    <>
      {marks.map(({ chapter, x, room, index }) => (
        <div
          key={chapter.start}
          className="pointer-events-none absolute top-0"
          style={{ left: x, bottom }}
        >
          {x > 0.5 ? (
            <div className="absolute inset-y-0 left-0 border-l border-dashed border-[#FFD43B]" />
          ) : null}
          {room > 44 ? (
            <span
              className="absolute bottom-0.5 left-1 truncate rounded-sm bg-[#FFD43B]/90 px-1 text-[10px] leading-4 font-semibold text-black"
              style={{ maxWidth: room - 8 }}
            >
              {chapter.title || `#${index + 1}`}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function ClipWave({
  clip,
  peaks,
  duration,
  left,
  width,
  areaWidth,
  secondsPerPx,
  height,
  color,
}: {
  clip: SeqClip;
  peaks: number[];
  duration: number;
  left: number;
  width: number;
  areaWidth: number;
  secondsPerPx: number;
  height: number;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const visibleFrom = Math.max(0, -left);
  const visibleWidth = Math.max(0, Math.min(width, areaWidth - left) - visibleFrom);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || visibleWidth <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(visibleWidth * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, visibleWidth, height);
    ctx.fillStyle = color;
    const perPxSource = secondsPerPx * clip.speed;
    for (let x = 0; x < visibleWidth; x += 2) {
      const src = clip.srcStart + (visibleFrom + x) * perPxSource;
      const peak = peakInRange(peaks, duration, src, src + perPxSource * 2);
      const h = Math.max(1, peak * (height - 2));
      ctx.fillRect(x, height - h, 1.5, h);
    }
  }, [peaks, duration, clip, visibleFrom, visibleWidth, secondsPerPx, height, color]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute bottom-0 bg-black/45"
      style={{ left: visibleFrom, width: visibleWidth, height }}
    />
  );
}

function Toolbar() {
  const { t } = useTranslation();
  const hint = useHint();
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const snapping = useEditorStore((s) => s.snapping);
  const setSnapping = useEditorStore((s) => s.setSnapping);
  const clips = useEditorStore((s) => s.clips);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const end = sequenceEnd(clips);
  // Kare kaydetme: "busy" sırasında düğme kilitli; sonra kısa durum yazısı.
  const [frameMsg, setFrameMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);

  const saveFrame = async () => {
    if (frameBusy) return;
    setFrameBusy(true);
    try {
      const path = await savePlayheadFrame();
      setFrameMsg({ text: `${t("editor.frameSaved")} · ${path.split(/[\\/]/).pop()}`, ok: true });
    } catch (err) {
      setFrameMsg({ text: localizeError(err, "editor.frameFailed").message, ok: false });
    } finally {
      setFrameBusy(false);
      setTimeout(() => setFrameMsg(null), 3500);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-[var(--dk-border)] px-2 py-1.5">
      <div className="flex flex-1 items-center gap-0.5">
        <span className="flex items-center gap-0.5" data-tour="editor-undo">
          <ToolButton label={hint(t("editor.undo"), "undo")} onClick={undo} disabled={!canUndo}>
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton label={hint(t("editor.redo"), "redo")} onClick={redo} disabled={!canRedo}>
            <Redo2 size={16} />
          </ToolButton>
        </span>
        <span className="mx-1 h-5 w-px bg-[var(--dk-border)]" />
        <span className="flex items-center gap-0.5" data-tour="editor-split">
          <ToolButton label={hint(t("editor.split"), "split")} onClick={splitAtPlayhead}>
            <Scissors size={16} />
          </ToolButton>
          <ToolButton
            label={hint(t("editor.deleteClip"), "deleteClip")}
            onClick={() => deleteSelected()}
            disabled={!hasSelection}
          >
            <Trash2 size={16} />
          </ToolButton>
          <ToolButton
            label={hint(t("editor.duplicate"), "duplicate")}
            onClick={duplicateSelected}
            disabled={!hasSelection}
          >
            <Copy size={16} />
          </ToolButton>
          <ToolButton label={hint(t("editor.closeGaps"), "closeGaps")} onClick={closeAllGaps}>
            <FoldHorizontal size={16} />
          </ToolButton>
        </span>
        <span className="mx-1 h-5 w-px bg-[var(--dk-border)]" />
        <ToolButton
          label={t("editor.magnet")}
          onClick={() => setSnapping(!snapping)}
          active={snapping}
          tour="editor-magnet"
        >
          <Magnet size={16} />
        </ToolButton>
        <ToolButton label={t("editor.addText")} onClick={addText} tour="editor-add-text">
          <Type size={16} />
        </ToolButton>
      </div>

      <div className="flex items-center gap-0.5">
        <ToolButton label={hint(t("editor.toStart"), "toStart")} onClick={toStart}>
          <SkipBack size={16} />
        </ToolButton>
        <ToolButton label={hint(t("editor.back5"), "back5")} onClick={() => stepSeconds(-5)}>
          <ChevronsLeft size={18} />
        </ToolButton>
        <button
          type="button"
          title={hint(playing ? t("editor.pause") : t("editor.play"), "playPause")}
          aria-label={playing ? t("editor.pause") : t("editor.play")}
          onClick={togglePlay}
          className="dk-gradient mx-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg transition hover:brightness-110"
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
        </button>
        <ToolButton label={hint(t("editor.forward5"), "forward5")} onClick={() => stepSeconds(5)}>
          <ChevronsRight size={18} />
        </ToolButton>
        <ToolButton label={hint(t("editor.toEnd"), "toEnd")} onClick={toEnd}>
          <SkipForward size={16} />
        </ToolButton>
        <MarkerJumps />
        <span className="mx-1 h-5 w-px bg-[var(--dk-border)]" />
        <ToolButton
          label={t("editor.saveFrame")}
          onClick={() => void saveFrame()}
          disabled={frameBusy}
        >
          <ImageDown size={16} />
        </ToolButton>
        <p className="ml-2 font-mono text-xs whitespace-nowrap tabular-nums">
          <span className="text-[var(--dk-text)]">{formatTimecode(currentTime)}</span>
          <span className="text-[var(--dk-text-muted)]"> / {formatTimecode(end)}</span>
        </p>
        {frameMsg ? (
          <p
            className={`ml-2 max-w-56 truncate text-xs ${
              frameMsg.ok ? "text-[var(--dk-success)]" : "text-[var(--dk-error)]"
            }`}
            title={frameMsg.text}
          >
            {frameMsg.text}
          </p>
        ) : null}
      </div>

      <div className="flex flex-1 items-center justify-end gap-0.5" data-tour="editor-zoom">
        <ToolButton label={hint(t("editor.zoomOut"), "zoomOut")} onClick={() => zoomTimeline(1.6)}>
          <ZoomOut size={16} />
        </ToolButton>
        <ToolButton
          label={hint(t("editor.zoomIn"), "zoomIn")}
          onClick={() => zoomTimeline(1 / 1.6)}
        >
          <ZoomIn size={16} />
        </ToolButton>
        <ToolButton label={hint(t("editor.zoomFit"), "zoomFit")} onClick={zoomToFit}>
          <Maximize size={15} />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  active,
  tour,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-tour={tour}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
        active
          ? "bg-[var(--dk-accent)]/20 text-[var(--dk-accent-hover)]"
          : "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Ruler({ view, width }: { view: TimelineView; width: number }) {
  const step = tickStep((view.end - view.start) / width);
  const minor = step / 5;
  const ticks: { time: number; major: boolean }[] = [];
  const first = Math.floor(view.start / minor) * minor;
  for (let time = first; time <= view.end + minor && ticks.length < 600; time += minor) {
    const index = Math.round(time / minor);
    ticks.push({ time: index * minor, major: index % 5 === 0 });
  }
  return (
    <div
      className="absolute inset-x-0 top-0 cursor-pointer bg-[var(--dk-bg)]/60"
      style={{ height: RULER_H }}
      data-ruler
    >
      {ticks.map(({ time, major }) => {
        const x = timeToX(time, view, width);
        if (x < -40 || x > width + 40) return null;
        return (
          <div key={time.toFixed(3)} className="absolute top-0 h-full" style={{ left: x }}>
            <div
              className={`absolute bottom-0 w-px ${major ? "h-2.5 bg-[var(--dk-text-muted)]" : "h-1.5 bg-[var(--dk-border-strong)]"}`}
            />
            {major ? (
              <span className="absolute top-1 left-1 font-mono text-[10px] whitespace-nowrap text-[var(--dk-text-muted)] tabular-nums">
                {formatTick(time, step)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Önceki / sonraki an işaretine atlar (işaret yoksa görünmez). */
function MarkerJumps() {
  const { t } = useTranslation();
  const markers = useTimelineMarkers();
  const [found, setFound] = useState<number | null>(null);
  // Ses dalgasından heyecanlı anları bulup işaret koyar (zaman çizelgesinde zaten çizilen veri).
  const findMoments = () => {
    const { sources } = useEditorStore.getState();
    const waves = useWaveStore.getState().byToken;
    let added = 0;
    for (const entry of sources) {
      const peaks = entry.stream ? waves[entry.stream.token] : undefined;
      if (!peaks) continue;
      added += addMarkers(entry.source.path, findHighlights(peaks, entry.duration));
    }
    setFound(added);
    window.setTimeout(() => setFound(null), 2500);
  };
  const finder = (
    <ToolButton
      label={found === null ? t("editor.findMoments") : t("editor.foundMoments", { count: found })}
      onClick={findMoments}
    >
      <Zap size={16} className={found === null ? "" : "text-[#FFD43B]"} />
    </ToolButton>
  );
  if (markers.length === 0) {
    return (
      <>
        <span className="mx-1 h-5 w-px bg-[var(--dk-border)]" />
        {finder}
      </>
    );
  }
  const jump = (dir: 1 | -1) => {
    const now = usePlayerStore.getState().currentTime;
    const target =
      dir > 0
        ? markers.find((m) => m > now + 0.05)
        : [...markers].reverse().find((m) => m < now - 0.05);
    if (target !== undefined) seekTimeline(target);
  };
  return (
    <>
      <span className="mx-1 h-5 w-px bg-[var(--dk-border)]" />
      <ToolButton label={t("editor.markerPrev")} onClick={() => jump(-1)}>
        <span className="flex items-center text-[#FFD43B]">
          <ChevronLeft size={14} />
          <Flag size={13} fill="currentColor" />
        </span>
      </ToolButton>
      {finder}
      <ToolButton label={t("editor.markerNext", { count: markers.length })} onClick={() => jump(1)}>
        <span className="flex items-center text-[#FFD43B]">
          <Flag size={13} fill="currentColor" />
          <ChevronRight size={14} />
        </span>
      </ToolButton>
    </>
  );
}

function Playhead({
  view,
  width,
  height,
  extent,
}: {
  view: TimelineView;
  width: number;
  height: number;
  extent: number;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);

  // Oynatırken imleç görünür aralıktan çıkarsa zaman çizelgesi onu izler.
  useEffect(() => {
    if (!playing) return;
    const state = useEditorStore.getState();
    const next = followPlayhead(state.view, currentTime, extent);
    if (next !== state.view) state.setView(next);
  }, [currentTime, playing, extent]);

  const x = timeToX(currentTime, view, width);
  if (x < -8 || x > width + 8) return null;
  return (
    <div className="pointer-events-none absolute top-0 z-30" style={{ left: x - 1, height }}>
      <div className="h-full w-0.5 bg-white shadow-[0_0_6px_rgb(0_0_0/60%)]" />
      <div className="absolute top-0.5 -left-[6px] h-3.5 w-3.5 rounded-full border-2 border-[var(--dk-accent)] bg-white" />
    </div>
  );
}

/** Her izin solundaki düğmeler: sesi kapat, katmanı gizle.
 * Zaman çizelgesinin koordinatlarını bozmamak için ayrı bir sütunda durur. */
function TrackHeaders({
  rows,
  textRow,
  lanes,
  height,
}: {
  rows: Row[];
  textRow: number;
  lanes: Lane[];
  height: number;
}) {
  const { t } = useTranslation();
  const tracks = useEditorStore((s) => s.tracks);
  const setTrack = useEditorStore((s) => s.setTrack);
  const toggle = (track: number, key: "muted" | "hidden" | "locked") => {
    setTrack(track, { [key]: !tracks[track]?.[key] });
    refreshPlayback();
  };
  return (
    <div
      className="relative w-[68px] shrink-0 border-r border-[var(--dk-border)] bg-[var(--dk-surface-2)]/60"
      style={{ height }}
    >
      {textRow > 0 ? (
        <div
          className="absolute inset-x-0 flex items-center justify-center border-t border-[var(--dk-border)] text-[#c084fc]"
          style={{ top: RULER_H, height: textRow }}
          title={t("editor.textRow")}
        >
          <Type size={13} />
        </div>
      ) : null}
      {lanes.map((lane) => (
        <LaneHeader key={`${lane.kind}-${lane.audioLane ?? ""}`} lane={lane} />
      ))}
      {rows
        .filter((row) => !row.empty)
        .map((row) => {
          const state = tracks[row.track] ?? {};
          const button = (on: boolean) =>
            `flex h-6 w-6 items-center justify-center rounded-md transition ${
              on
                ? "bg-[var(--dk-warning)]/15 text-[var(--dk-warning)]"
                : "text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-white"
            }`;
          return (
            <div
              key={row.track}
              className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-t border-[var(--dk-border)]"
              style={{ top: row.top, height: row.height }}
            >
              <span className="font-mono text-[10px] font-semibold text-[var(--dk-text-muted)]">
                V{row.track + 1}
              </span>
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  className={button(!!state.muted)}
                  aria-pressed={!!state.muted}
                  title={state.muted ? t("editor.trackUnmute") : t("editor.trackMute")}
                  aria-label={state.muted ? t("editor.trackUnmute") : t("editor.trackMute")}
                  onClick={() => toggle(row.track, "muted")}
                >
                  {state.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button
                  type="button"
                  className={button(!!state.hidden)}
                  aria-pressed={!!state.hidden}
                  title={state.hidden ? t("editor.trackShow") : t("editor.trackHide")}
                  aria-label={state.hidden ? t("editor.trackShow") : t("editor.trackHide")}
                  onClick={() => toggle(row.track, "hidden")}
                >
                  {state.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  className={button(!!state.locked)}
                  aria-pressed={!!state.locked}
                  title={state.locked ? t("editor.trackUnlock") : t("editor.trackLock")}
                  aria-label={state.locked ? t("editor.trackUnlock") : t("editor.trackLock")}
                  onClick={() => toggle(row.track, "locked")}
                >
                  {state.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
              </span>
            </div>
          );
        })}
    </div>
  );
}

/** Tüm zaman çizelgesinin küçük haritası; görünür pencere sürüklenerek gezilir.
 * Yalnızca yakınlaştırınca görünür (her şey ekrana sığıyorsa gerek yok). Zaman
 * çizelgesiyle aynı genişlikte çizilir ki imleç noktası hizalı dursun. */
function ScrollMap({ extent }: { extent: number }) {
  const view = useEditorStore((s) => s.view);
  const clips = useEditorStore((s) => s.clips);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const full = fullView(extent);
  const duration = useEditorStore((s) => s.duration);
  const content = contentEnd(clips, duration);
  const zoomed = view.end - view.start < content - 0.01;

  function onPointerDown(event: ReactPointerEvent) {
    const element = ref.current;
    if (!element || event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    const span = view.end - view.start;
    const clicked = xToTime(event.clientX - rect.left, full, rect.width);
    const inside = clicked >= view.start && clicked <= view.end;
    const offset = inside ? clicked - view.start : span / 2;
    const store = useEditorStore.getState();
    store.setView({ start: clicked - offset, end: clicked - offset + span });
    drag(event, (e) => {
      const time = xToTime(e.clientX - rect.left, full, rect.width);
      store.setView({ start: time - offset, end: time - offset + span });
    });
  }

  return (
    <div
      className={`border-t border-[var(--dk-border)] py-1.5 transition-opacity ${zoomed ? "" : "pointer-events-none opacity-0"}`}
      aria-hidden={!zoomed}
    >
      <div
        ref={ref}
        className="relative h-3 cursor-pointer touch-none rounded-full bg-[var(--dk-bg)] select-none"
        onPointerDown={onPointerDown}
      >
        {width > 0 ? (
          <>
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="absolute rounded-sm opacity-80"
                style={{
                  left: timeToX(clip.start, full, width),
                  width: Math.max(
                    2,
                    timeToX(clipEnd(clip), full, width) - timeToX(clip.start, full, width),
                  ),
                  top: clip.track === 0 ? 6 : 1,
                  height: clip.track === 0 ? 5 : 4,
                  background: TRACK_COLORS[clip.track % TRACK_COLORS.length],
                }}
              />
            ))}
            {zoomed ? (
              <div
                className="absolute -inset-y-0.5 rounded-full border-2 border-[var(--dk-accent)] bg-[var(--dk-accent)]/15"
                style={{
                  left: timeToX(view.start, full, width),
                  width: Math.max(
                    8,
                    timeToX(view.end, full, width) - timeToX(view.start, full, width),
                  ),
                }}
              />
            ) : null}
            <div
              className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--dk-accent)] bg-white"
              style={{ left: timeToX(currentTime, full, width) }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ClipMenu({
  x,
  y,
  clipId,
  onClose,
}: {
  x: number;
  y: number;
  clipId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const map = useShortcutStore((s) => s.map);
  const clip = useEditorStore((s) => s.clips.find((c) => c.id === clipId));
  const detached = useEditorStore((s) => s.music.some((m) => m.linkedClipId === clipId));

  if (!clip) return null;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const key = (action: ShortcutAction) => (map[action][0] ? formatCombo(map[action][0]) : "");
  const items: { label: string; shortcut?: string; action: () => void; danger?: boolean }[] = [
    { label: t("editor.playClip"), action: () => playClip(clipId) },
    { label: t("editor.split"), shortcut: key("split"), action: splitAtPlayhead },
    { label: t("editor.duplicate"), shortcut: key("duplicate"), action: duplicateSelected },
    { label: t("editor.keepOnly"), action: keepOnlySelected },
    {
      label: clip && clipVolume(clip) === 0 ? t("editor.unmuteClip") : t("editor.muteClip"),
      shortcut: key("toggleMute"),
      action: toggleMuteSelected,
    },
    {
      label: t("editor.rippleDelete"),
      shortcut: key("rippleDelete"),
      action: rippleDeleteSelected,
    },
    { label: t("editor.copyClips"), shortcut: key("copyClips"), action: () => void copySelected() },
    ...(hasClipboard()
      ? [
          {
            label: t("editor.pasteClips"),
            shortcut: key("pasteClips"),
            action: () => void pasteAtPlayhead(),
          },
        ]
      : []),
    clip.group
      ? { label: t("editor.ungroupClips"), shortcut: key("ungroupClips"), action: ungroupSelected }
      : { label: t("editor.groupClips"), shortcut: key("groupClips"), action: groupSelected },
    {
      label: detached ? t("editor.reattachAudio") : t("editor.detachAudio"),
      shortcut: key("detachAudio"),
      action: () => {
        toggleAudioLink();
      },
    },
    {
      label: t("editor.deleteClip"),
      shortcut: key("deleteClip"),
      action: () => deleteSelected(),
      danger: true,
    },
  ];

  return (
    <ContextMenu x={x} y={y} width={240} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={run(item.action)}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-[var(--dk-accent)]/15 ${
            item.danger ? "text-[var(--dk-error)]" : "text-[var(--dk-text)]"
          }`}
        >
          <span className="flex-1">{item.label}</span>
          {item.shortcut ? (
            <span className="font-mono text-[11px] text-[var(--dk-text-muted)]">
              {item.shortcut}
            </span>
          ) : null}
        </button>
      ))}
      <div className="mt-1 border-t border-[var(--dk-border)] px-2.5 pt-1.5 pb-1">
        <p className="mb-1 text-[11px] text-[var(--dk-text-muted)]">{t("editor.clipSpeed")}</p>
        <div className="flex flex-wrap gap-1">
          {SPEED_PRESETS.map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={run(() => setClipSpeed(clipId, speed))}
              className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${
                clip.speed === speed
                  ? "bg-[var(--dk-accent)] text-white"
                  : "bg-[var(--dk-bg)] text-[var(--dk-text)] hover:bg-white/10"
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
    </ContextMenu>
  );
}
