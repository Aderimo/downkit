import { useTranslation } from "react-i18next";
import { MoveRight, Trash2, Zap, ZoomIn } from "lucide-react";
import { Switch } from "../ui/Switch";
import type { SeqClip } from "../../lib/sequence";
import { ZOOM_MS, ZOOM_SIZE, orderedZooms, zoomFactor } from "../../lib/clipZoom";
import {
  addPanZoomAtPlayhead,
  addZoomAtPlayhead,
  deleteZoom,
  setZoomPan,
  placeZoomSpan,
  selectZoom,
  updateZoom,
  useZoomUi,
  zoomOnTimeline,
} from "../../lib/zoomActions";
import { beginTransformEdit, endTransformEdit } from "../../lib/transformActions";
import { formatTimecode } from "../../lib/timeline";

const RAMPS = [0, 200, 500, 1000];

/** Klibin zamanlı yakınlaştırmaları: ekle, seç, süreleri ve yakınlığı ayarla. */
export function ZoomSection({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const selected = useZoomUi((s) => s.selected);
  const spans = orderedZooms(clip.zooms ?? []).filter((z) => zoomOnTimeline(clip, z));
  const active = spans.find((z) => selected?.clipId === clip.id && selected.zoomId === z.id);
  const field =
    "h-6 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1 text-right font-mono text-[11px] outline-none focus:border-[var(--dk-accent)]";
  const place = active ? zoomOnTimeline(clip, active) : null;
  // Zaman çizelgesi saniyesi ↔ kaynak saniyesi.
  const toSrc = (time: number) => clip.srcStart + (time - clip.start) * clip.speed;

  return (
    <div className="space-y-2" data-zoom-section>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => addZoomAtPlayhead()}
          className="flex items-center justify-center gap-1 rounded-lg bg-[var(--dk-accent)] px-2 py-1.5 text-[11px] font-bold text-white"
        >
          <ZoomIn size={13} />
          {t("zoom.add")}
        </button>
        <button
          type="button"
          onClick={() => addZoomAtPlayhead(true)}
          className="flex items-center justify-center gap-1 rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)]"
        >
          <Zap size={13} />
          {t("zoom.addInstant")}
        </button>
        <button
          type="button"
          onClick={() => addPanZoomAtPlayhead()}
          title={t("zoom.addPanHint")}
          className="col-span-2 flex items-center justify-center gap-1 rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)]"
        >
          <MoveRight size={13} />
          {t("zoom.addPan")}
        </button>
      </div>
      {spans.length > 0 ? (
        <div className="space-y-1" role="list">
          {spans.map((z) => {
            const span = zoomOnTimeline(clip, z)!;
            const on = z === active;
            return (
              <div key={z.id} role="listitem" className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => selectZoom(clip, z)}
                  className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left font-mono text-[11px] ${
                    on ? "bg-[#a855f7]/30 text-white" : "bg-[var(--dk-bg)] hover:bg-white/10"
                  }`}
                >
                  {zoomFactor(z).toFixed(1)}×{z.pan ? ` → ${zoomFactor(z.pan).toFixed(1)}×` : ""} ·{" "}
                  {formatTimecode(span.start, 1)}–{formatTimecode(span.end, 1)}
                </button>
                <button
                  type="button"
                  aria-label={t("zoom.delete")}
                  title={t("zoom.delete")}
                  onClick={() => deleteZoom(clip.id, z.id)}
                  className="rounded p-1 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {active && place ? (
        <div className="space-y-1.5 rounded-lg border border-[#a855f7]/50 p-2" data-zoom-editor>
          <label className="grid grid-cols-[5rem_1fr_3rem] items-center gap-1.5 text-[11px]">
            <span className="text-[var(--dk-text-muted)]">{t("zoom.amount")}</span>
            <input
              type="range"
              min={1 / ZOOM_SIZE.max}
              max={1 / ZOOM_SIZE.min}
              step={0.05}
              value={zoomFactor(active)}
              aria-label={t("zoom.amount")}
              onPointerDown={beginTransformEdit}
              onPointerUp={endTransformEdit}
              onChange={(e) =>
                updateZoom(clip.id, active.id, { size: 1 / Number(e.target.value) }, true)
              }
              className="dk-volume w-full"
            />
            <span className="text-right font-mono">{zoomFactor(active).toFixed(2)}×</span>
          </label>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-[var(--dk-text-muted)]">{t("zoom.pan")}</span>
            <Switch
              checked={active.pan !== undefined}
              label={t("zoom.pan")}
              onChange={(on) => setZoomPan(clip.id, active.id, on)}
            />
          </div>
          {active.pan ? (
            <label className="grid grid-cols-[5rem_1fr_3rem] items-center gap-1.5 text-[11px]">
              <span className="text-[var(--dk-text-muted)]">{t("zoom.panAmount")}</span>
              <input
                type="range"
                min={1 / ZOOM_SIZE.max}
                max={1 / ZOOM_SIZE.min}
                step={0.05}
                value={zoomFactor(active.pan)}
                aria-label={t("zoom.panAmount")}
                onPointerDown={beginTransformEdit}
                onPointerUp={endTransformEdit}
                onChange={(e) =>
                  updateZoom(
                    clip.id,
                    active.id,
                    { pan: { ...active.pan!, size: 1 / Number(e.target.value) } },
                    true,
                  )
                }
                className="dk-volume w-full"
              />
              <span className="text-right font-mono">{zoomFactor(active.pan).toFixed(2)}×</span>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            {(["start", "end"] as const).map((edge) => (
              <label key={edge} className="space-y-0.5 text-[11px]">
                <span className="text-[var(--dk-text-muted)]">{t(`zoom.${edge}`)}</span>
                <input
                  type="number"
                  step={0.1}
                  value={Number(place[edge].toFixed(2))}
                  aria-label={t(`zoom.${edge}`)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    const a = edge === "start" ? toSrc(v) : active.start;
                    const b = edge === "end" ? toSrc(v) : active.end;
                    placeZoomSpan(clip.id, active.id, a, b, false, "resize");
                  }}
                  className={field}
                />
              </label>
            ))}
          </div>
          {(["inMs", "outMs"] as const).map((key) => (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="flex-1 text-[var(--dk-text-muted)]">{t(`zoom.${key}`)}</span>
                <input
                  type="number"
                  min={0}
                  max={ZOOM_MS.max}
                  step={50}
                  value={active[key]}
                  aria-label={t(`zoom.${key}`)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) updateZoom(clip.id, active.id, { [key]: v });
                  }}
                  className={`${field} w-16`}
                />
                <span className="text-[var(--dk-text-muted)]">ms</span>
              </div>
              <div className="flex gap-1" role="group" aria-label={t(`zoom.${key}`)}>
                {RAMPS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    aria-pressed={active[key] === ms}
                    onClick={() => updateZoom(clip.id, active.id, { [key]: ms })}
                    className={`flex-1 rounded py-0.5 text-[10px] ${
                      active[key] === ms
                        ? "bg-[var(--dk-accent)] text-white"
                        : "bg-[var(--dk-bg)] hover:bg-white/10"
                    }`}
                  >
                    {ms === 0 ? t("zoom.instant") : `${ms} ms`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
