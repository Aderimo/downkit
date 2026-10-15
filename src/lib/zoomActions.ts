import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { clipEnd, layersAt, type SeqClip } from "./sequence";
import {
  DEFAULT_ZOOM_SECONDS,
  clampZoom,
  defaultPan,
  newZoom,
  orderedZooms,
  placeZoom,
  type ZoomSpan,
} from "./clipZoom";
import { refreshPlayback, seekTimeline } from "./sequencePlayer";
import { clipSourceTime, playheadInClip } from "./transformActions";

// Zamanlı yakınlaştırma komutları: panel, zaman çizelgesindeki bant ve videodaki bölge
// kutusu aynı işlevleri kullanır. Seçili aralık düzenlenirken önizleme yakınlaşmadan
// (bölge kutusuyla) gösterilir; oynatınca yakınlaşma görünür.

export const useZoomUi = create<{
  selected: { clipId: string; zoomId: string } | null;
  select: (selected: { clipId: string; zoomId: string } | null) => void;
}>((set) => ({ selected: null, select: (selected) => set({ selected }) }));

const editor = () => useEditorStore.getState();
const playhead = () => usePlayerStore.getState().currentTime;

function withZooms(clips: SeqClip[], id: string, next: (zooms: ZoomSpan[]) => ZoomSpan[]) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const zooms = orderedZooms(next(c.zooms ?? []));
    const out: SeqClip = { ...c, zooms };
    if (zooms.length === 0) delete out.zooms;
    return out;
  });
}

/** Yakınlaştırmanın ekleneceği klip: seçili tek klip (imleç üstündeyse), yoksa imleçteki görüntü. */
export function zoomTarget(): SeqClip | null {
  const s = editor();
  const t = playhead();
  const selected =
    s.selectedIds.length === 1 ? s.clips.find((c) => c.id === s.selectedIds[0]) : null;
  if (selected && playheadInClip(selected, t)) return selected;
  const visible = s.clips.filter((c) => !s.tracks[c.track]?.hidden);
  return layersAt(visible, t).base;
}

/** İmleçte yeni yakınlaştırma (2 sn; `instant`: anında yaklaş / uzaklaş). */
export function addZoomAtPlayhead(instant = false): string | null {
  const clip = zoomTarget();
  if (!clip) return null;
  const start = clipSourceTime(clip);
  const end = Math.min(clip.srcEnd, start + DEFAULT_ZOOM_SECONDS * clip.speed);
  if (end - start < 0.2) return null;
  const zoom = newZoom(newClipId(), start, end);
  if (instant) {
    zoom.inMs = 0;
    zoom.outMs = 0;
  }
  editor().apply((clips) =>
    withZooms(clips, clip.id, (zooms) =>
      placeZoom([...zooms, zoom], zoom.id, start, end, { min: clip.srcStart, max: clip.srcEnd }),
    ),
  );
  editor().select([clip.id]);
  useZoomUi.getState().select({ clipId: clip.id, zoomId: zoom.id });
  refreshPlayback();
  return zoom.id;
}

const PAN_SECONDS = 6;

/** Kaydır & yakınlaştır: imleçten itibaren (en çok 6 sn) yavaşça kayan yakınlık. */
export function addPanZoomAtPlayhead(): string | null {
  const clip = zoomTarget();
  if (!clip) return null;
  const start = clipSourceTime(clip);
  const end = Math.min(clip.srcEnd, start + PAN_SECONDS * clip.speed);
  if (end - start < 0.2) return null;
  const zoom = newZoom(newClipId(), start, end);
  zoom.size = 0.8;
  zoom.x = 0.4;
  zoom.inMs = 0;
  zoom.outMs = 0;
  zoom.pan = defaultPan(zoom);
  editor().apply((clips) =>
    withZooms(clips, clip.id, (zooms) =>
      placeZoom([...zooms, clampZoom(zoom)], zoom.id, start, end, {
        min: clip.srcStart,
        max: clip.srcEnd,
      }),
    ),
  );
  editor().select([clip.id]);
  useZoomUi.getState().select({ clipId: clip.id, zoomId: zoom.id });
  refreshPlayback();
  return zoom.id;
}

/** Aralığa bitiş bölgesi ekler (kaydırma) ya da kaldırır. */
export function setZoomPan(clipId: string, zoomId: string, on: boolean) {
  const zoom = editor()
    .clips.find((c) => c.id === clipId)
    ?.zooms?.find((z) => z.id === zoomId);
  if (!zoom) return;
  updateZoom(clipId, zoomId, { pan: on ? defaultPan(zoom) : undefined });
}

export function updateZoom(
  clipId: string,
  zoomId: string,
  patch: Partial<Omit<ZoomSpan, "id">>,
  live = false,
) {
  const s = editor();
  const change = (clips: SeqClip[]) =>
    withZooms(clips, clipId, (zooms) =>
      zooms.map((z) => (z.id === zoomId ? clampZoom({ ...z, ...patch }) : z)),
    );
  if (live) s.dragTo(change(s.clips));
  else {
    s.apply(change);
    refreshPlayback();
  }
}

/** Aralığı taşır ya da uzatır (kaynak saniyesi; klibin içinde, komşusuyla çakışmadan). */
export function placeZoomSpan(
  clipId: string,
  zoomId: string,
  start: number,
  end: number,
  live = false,
  mode: "move" | "resize" = "move",
) {
  const s = editor();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip) return;
  const change = (clips: SeqClip[]) =>
    withZooms(clips, clipId, (zooms) =>
      placeZoom(zooms, zoomId, start, end, { min: clip.srcStart, max: clip.srcEnd }, mode),
    );
  if (live) s.dragTo(change(s.clips));
  else {
    s.apply(change);
    refreshPlayback();
  }
}

export function deleteZoom(clipId: string, zoomId: string) {
  editor().apply((clips) =>
    withZooms(clips, clipId, (zooms) => zooms.filter((z) => z.id !== zoomId)),
  );
  if (useZoomUi.getState().selected?.zoomId === zoomId) useZoomUi.getState().select(null);
  refreshPlayback();
}

/** Aralığı seçer ve imleci başına götürür. */
export function selectZoom(clip: SeqClip, zoom: ZoomSpan) {
  editor().select([clip.id]);
  useZoomUi.getState().select({ clipId: clip.id, zoomId: zoom.id });
  const at = clip.start + (Math.max(zoom.start, clip.srcStart) - clip.srcStart) / clip.speed;
  if (at < clip.start || at >= clipEnd(clip)) return;
  seekTimeline(at);
}

/** Aralığın zaman çizelgesindeki yeri (klibin içinde kalan kısmı). */
export function zoomOnTimeline(
  clip: SeqClip,
  zoom: ZoomSpan,
): { start: number; end: number } | null {
  const a = Math.max(zoom.start, clip.srcStart);
  const b = Math.min(zoom.end, clip.srcEnd);
  if (b - a < 1e-3) return null;
  return {
    start: clip.start + (a - clip.srcStart) / clip.speed,
    end: clip.start + (b - clip.srcStart) / clip.speed,
  };
}
