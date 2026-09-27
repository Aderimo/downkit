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
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
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
} from "lucide-react";
import {
  contentEnd,
  sourceChapters,
  timelineExtent,
  useEditorStore,
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
import { nearestFromEntries, requestThumbs, useThumbStore } from "../../lib/thumbCache";
import { getEditorWaveform } from "../../lib/tauri-api";
import { refreshPlayback, seekTimeline } from "../../lib/sequencePlayer";
import {
  dropTransition,
  deleteSelected,
  duplicateSelected,
  keepOnlySelected,
  playClip,
  redo,
  setClipSpeed,
  splitAtPlayhead,
  addText,
  stepSeconds,
  toggleMuteSelected,
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
    onEnd?.(moved);
  };
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

export function Timeline() {
  const { t } = useTranslation();
  const clips = useEditorStore((s) => s.clips);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const view = useEditorStore((s) => s.view);
  const duration = useEditorStore((s) => s.duration);
  const source = useEditorStore((s) => s.source);
  const stream = useEditorStore((s) => s.stream);
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(areaRef);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [textMenu, setTextMenu] = useState<{ x: number; y: number; textId: string } | null>(null);

  const texts = useEditorStore((s) => s.texts);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const textRow = texts.length > 0 ? TEXT_H : 0;
  const rows = useMemo(() => layoutRows(clips, textRow), [clips, textRow]);
  const tracksHeight = textRow + rows.reduce((h, r) => h + r.height, 0);
  const extent = timelineExtent(clips, duration);
  const secondsPerPx = width > 0 ? (view.end - view.start) / width : 0;
  const storyboard = source?.kind === "remote" ? source.metadata.storyboard : null;
  const aspect = frameAspect(storyboard, source);
  const token = stream?.token ?? null;
  const waveform = useWaveform(token, duration);
  const tiles = useTileSource(storyboard, token, duration);
  const chapters = useMemo(() => sourceChapters(source), [source]);
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
  // yakınlaştırdıkça kareler ayrıntılanır.
  useEffect(() => {
    if (tiles.kind !== "thumbs" || width === 0) return;
    const tileWidth = Math.max(24, (TRACK_H - 4) * aspect);
    const times: number[] = [];
    for (const clip of clips) {
      const left = timeToX(clip.start, view, width);
      const right = timeToX(clipEnd(clip), view, width);
      if (right < 0 || left > width) continue;
      const first = Math.max(0, Math.floor(-left / tileWidth));
      const last = Math.ceil((Math.min(width, right) - left) / tileWidth);
      for (let i = first; i < last; i += 1) {
        const tt = clip.start + (i + 0.5) * tileWidth * secondsPerPx;
        times.push(clip.srcStart + (tt - clip.start) * clip.speed);
      }
    }
    requestThumbs(tiles.token, times);
  }, [tiles, clips, view, width, aspect, secondsPerPx]);

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
    }
    seekTimeline(timeAt(e.clientX));
    drag(e, (ev) => seekTimeline(timeAt(ev.clientX)));
  }

  function startClipDrag(e: ReactPointerEvent, clip: SeqClip, mode: "move" | "start" | "end") {
    if (e.button !== 0) return;
    const store = useEditorStore.getState();
    if (e.shiftKey || e.ctrlKey) {
      e.stopPropagation();
      store.toggleSelect(clip.id);
      return;
    }
    if (!store.selectedIds.includes(clip.id)) store.select([clip.id]);
    const origin = store.clips;
    const grab = timeAt(e.clientX) - clip.start;
    const length = clipLength(clip);
    const areaTop = areaRef.current?.getBoundingClientRect().top ?? 0;
    const tolerance = SNAP_PX * secondsPerPx;
    const candidates = snapCandidates(origin, clip.id, usePlayerStore.getState().currentTime);
    store.beginDrag();

    drag(
      e,
      (ev, moved) => {
        if (!moved) return;
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
          useEditorStore.getState().dragTo(moveClip(origin, clip.id, start, track));
        } else {
          const snapped = useSnap ? snap(time, candidates, tolerance) : time;
          setSnapLine(snapped !== time ? snapped : null);
          const next =
            mode === "start"
              ? trimStart(origin, clip.id, snapped)
              : trimEnd(origin, clip.id, snapped, useEditorStore.getState().duration);
          useEditorStore.getState().dragTo(next);
          // Kenarı sürüklerken o karedeki görüntü gösterilir.
          const edited = next.find((c) => c.id === clip.id);
          if (edited) seekTimeline(mode === "start" ? edited.start : clipEnd(edited) - 0.04);
        }
      },
      () => {
        setSnapLine(null);
        useEditorStore.getState().endDrag();
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

  function openMenu(e: ReactMouseEvent, clip: SeqClip) {
    e.preventDefault();
    e.stopPropagation();
    const store = useEditorStore.getState();
    if (!store.selectedIds.includes(clip.id)) store.select([clip.id]);
    setMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }

  return (
    <section className="dk-card flex shrink-0 flex-col overflow-hidden" data-tour="editor-timeline">
      <Toolbar />
      <div className="flex">
        <TrackHeaders rows={rows} textRow={textRow} height={RULER_H + tracksHeight} />
        <div
          ref={areaRef}
          className="relative min-w-0 flex-1 cursor-default touch-none overflow-hidden select-none"
          style={{ height: RULER_H + tracksHeight }}
          onPointerDown={onAreaPointerDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          {width > 0 ? (
            <>
              <Ruler view={view} width={width} />
              {textRow > 0 ? (
                <div
                  className="absolute inset-x-0 border-t border-[var(--dk-border)] bg-[#a855f7]/5"
                  style={{ top: RULER_H, height: TEXT_H }}
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
                        className={`absolute top-0.5 flex h-[calc(100%-4px)] cursor-grab items-center overflow-hidden rounded-md bg-[#a855f7]/80 px-2 text-[11px] font-medium whitespace-nowrap text-white active:cursor-grabbing ${
                          item.id === selectedTextId ? "shadow-[0_0_0_2px_white]" : ""
                        }`}
                        style={{ left, width: Math.max(4, right - left) }}
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
                    aspect={aspect}
                    tiles={tiles}
                    waveform={waveform}
                    chapters={chapters}
                    duration={duration}
                    onDrag={startClipDrag}
                    onMenu={openMenu}
                  />
                );
              })}
              {snapLine !== null ? (
                <div
                  className="pointer-events-none absolute top-0 z-20 w-px bg-[#FFD43B]"
                  style={{ left: timeToX(snapLine, view, width), height: RULER_H + tracksHeight }}
                />
              ) : null}
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
    </section>
  );
}

function frameAspect(
  storyboard: Storyboard | null,
  source: ReturnType<typeof useEditorStore.getState>["source"],
): number {
  if (storyboard) return storyboard.width / storyboard.height;
  const w = source?.kind === "local" ? source.info.width : source?.metadata.sourceWidth;
  const h = source?.kind === "local" ? source.info.height : source?.metadata.sourceHeight;
  // Dikey videolarda kareler çok daralmasın.
  return w && h ? Math.min(Math.max(w / h, 0.56), 2.4) : 16 / 9;
}

function useTileSource(
  storyboard: Storyboard | null,
  token: string | null,
  duration: number,
): TileSource {
  const entries = useThumbStore((s) => s.entries);
  const cacheToken = useThumbStore((s) => s.token);
  // İlk açılışta tüm videoya yayılmış kaba bir kare seti istenir.
  useEffect(() => {
    if (!storyboard && token && duration > 0) requestThumbs(token, thumbTimes(duration, 36));
  }, [storyboard, token, duration]);
  return useMemo((): TileSource => {
    if (storyboard) return { kind: "storyboard", storyboard };
    if (!token) return { kind: "none" };
    const usable = cacheToken === token ? entries : {};
    const keys = Object.keys(usable)
      .map(Number)
      .sort((a, b) => a - b);
    return { kind: "thumbs", token, entries: usable, keys };
  }, [storyboard, token, entries, cacheToken]);
}

function useWaveform(token: string | null, duration: number): number[] | null {
  const [state, setState] = useState<{ key: string | null; peaks: number[] }>({
    key: null,
    peaks: [],
  });
  useEffect(() => {
    if (!token || duration <= 0) return;
    let disposed = false;
    // Saniyede 8 kova; 1 saatlik videoda üst sınır 24 bin.
    getEditorWaveform(token, duration, Math.min(24000, Math.ceil(duration * 8)))
      .then((peaks) => {
        if (!disposed) setState({ key: token, peaks });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [token, duration]);
  return state.key === token && state.peaks.length > 0 ? state.peaks : null;
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
  aspect: number;
  tiles: TileSource;
  waveform: number[] | null;
  chapters: Chapter[];
  duration: number;
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
  aspect,
  tiles,
  waveform,
  chapters,
  duration,
  onDrag,
  onMenu,
}: ClipBlockProps) {
  const color = TRACK_COLORS[clip.track % TRACK_COLORS.length];
  // Geçiş sürüklenirken bırakılacak uç: kenara yakınsa o uç (ve oradaki kesim), ortadaysa iki uç.
  const [dropEdge, setDropEdge] = useState<TransitionEdge | null>(null);
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
        dropEdge === "both"
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
        if (!e.dataTransfer.types.includes("application/x-downkit-transition")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDropEdge(transitionEdge(e));
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(e) => {
        setDropEdge(null);
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
          <span className="truncate">{label}</span>
          {clip.speed !== 1 ? (
            <span className="shrink-0 rounded bg-[#FFD43B] px-1 text-[10px] font-bold text-black">
              {clip.speed}×
            </span>
          ) : null}
          {clipVolume(clip) === 0 ? (
            <VolumeX size={12} className="shrink-0 text-[var(--dk-error)]" />
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
            onClick={deleteSelected}
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
        <p className="ml-2 font-mono text-xs whitespace-nowrap tabular-nums">
          <span className="text-[var(--dk-text)]">{formatTimecode(currentTime)}</span>
          <span className="text-[var(--dk-text-muted)]"> / {formatTimecode(end)}</span>
        </p>
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

/** Her izin solundaki düğmeler (Clipchamp'taki gibi): sesi kapat, katmanı gizle.
 * Zaman çizelgesinin koordinatlarını bozmamak için ayrı bir sütunda durur. */
function TrackHeaders({ rows, textRow, height }: { rows: Row[]; textRow: number; height: number }) {
  const { t } = useTranslation();
  const tracks = useEditorStore((s) => s.tracks);
  const setTrack = useEditorStore((s) => s.setTrack);
  const toggle = (track: number, key: "muted" | "hidden") => {
    setTrack(track, { [key]: !tracks[track]?.[key] });
    refreshPlayback();
  };
  return (
    <div
      className="relative w-12 shrink-0 border-r border-[var(--dk-border)] bg-[var(--dk-surface-2)]/60"
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

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

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
      label: t("editor.deleteClip"),
      shortcut: key("deleteClip"),
      action: deleteSelected,
      danger: true,
    },
  ];

  return createPortal(
    <div
      className="fixed z-[60] w-60 rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-1 shadow-2xl shadow-black/60"
      style={{
        left: Math.min(x, window.innerWidth - 250),
        top: Math.min(y, window.innerHeight - 290),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
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
    </div>,
    document.body,
  );
}
