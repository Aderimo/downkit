import { beatTimes } from "../../lib/beats";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, ImagePlus, Link2, Music2, Sparkles, X } from "lucide-react";
import type { ImageItem, MusicItem } from "../../lib/layers";
import { effectKey, type EffectItem } from "../../lib/effectLane";
import {
  laneEnd,
  laneStart,
  volumeDb,
  type Lane,
  type LaneDragMode,
  type LaneItem,
  type LaneKind,
} from "../../lib/laneItems";
import { peakInRange, timeToX, type TimelineView } from "../../lib/timeline";
import { useEditorStore } from "../../store/editorStore";
import { ensureWaveform, useWaveStore } from "../../lib/thumbCache";
import { ensureMediaUrl, useLayerMedia } from "../../lib/layerActions";
import { audioLaneKey } from "../../lib/sequence";
import { refreshPlayback } from "../../lib/sequencePlayer";

// Zaman çizelgesinde katman izleri: logo/resim ve gizleme üstte (görüntünün üstüne
// biner), müzik en altta (ses izi). Bloklar taşınır, kenarından kısaltılır.

const STYLE: Record<LaneKind, { bg: string; ring: string; tint: string }> = {
  effect: { bg: "bg-[#ec4899]/80", ring: "text-[#f472b6]", tint: "bg-[#ec4899]/5" },
  image: { bg: "bg-[#f59e0b]/80", ring: "text-[#fbbf24]", tint: "bg-[#f59e0b]/5" },
  blur: { bg: "bg-[#64748b]/85", ring: "text-[#94a3b8]", tint: "bg-[#64748b]/5" },
  music: { bg: "bg-[#10b981]/75", ring: "text-[#34d399]", tint: "bg-[#10b981]/5" },
};

export function LaneRow({
  lane,
  view,
  width,
  selectedId,
  onDrag,
  onRemove,
  onOpen,
  onMenu,
  multiSelected = [],
}: {
  lane: Lane;
  view: TimelineView;
  width: number;
  selectedId: string | null;
  onDrag: (e: ReactPointerEvent, kind: LaneKind, item: LaneItem, mode: LaneDragMode) => void;
  onRemove: (kind: LaneKind, id: string) => void;
  onOpen: (kind: LaneKind) => void;
  onMenu?: (e: React.MouseEvent, kind: LaneKind, item: LaneItem) => void;
  multiSelected?: readonly { kind: string; id: string }[];
}) {
  const { t } = useTranslation();
  const style = STYLE[lane.kind];
  return (
    <div
      className={`absolute inset-x-0 border-t border-[var(--dk-border)] ${style.tint}`}
      style={{ top: lane.top, height: lane.height }}
    >
      {lane.items.map((item) => {
        const left = timeToX(laneStart(item), view, width);
        const right = timeToX(laneEnd(item), view, width);
        if (right < -4 || left > width + 4) return null;
        const fx = lane.kind === "effect" ? effectKey(item as EffectItem) : null;
        const label = fx
          ? fx.id
            ? t(`${fx.key}.${fx.id}`)
            : t(fx.key)
          : lane.kind === "blur"
            ? t("editor.laneBlur")
            : (item as ImageItem | MusicItem).name || t("editor.laneImage");
        // Çakışan bloklar kendi satırında (üst üste binmez).
        const rowH = lane.height / (lane.rowCount ?? 1);
        const row = lane.rows?.get(item.id) ?? 0;
        return (
          <div
            key={item.id}
            data-lane={lane.kind}
            data-audio-lane={lane.audioLane}
            data-lane-item={item.id}
            title={`${label} · ${t("editor.laneHint")}`}
            className={`group absolute flex cursor-grab items-center overflow-hidden rounded-md px-2 text-[11px] font-medium whitespace-nowrap text-white active:cursor-grabbing ${style.bg} ${
              item.id === selectedId ||
              multiSelected.some((b) => b.kind === lane.kind && b.id === item.id)
                ? "shadow-[0_0_0_2px_white]"
                : ""
            }`}
            style={{
              left,
              width: Math.max(6, right - left),
              top: row * rowH + 2,
              height: rowH - 4,
            }}
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const edge = Math.min(10, rect.width / 3);
              onDrag(
                e,
                lane.kind,
                item,
                x <= edge ? "start" : x >= rect.width - edge ? "end" : "move",
              );
            }}
            onDoubleClick={() => onOpen(lane.kind)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu?.(e, lane.kind, item);
            }}
          >
            {/* Kenarlar: kısaltma/uzatma imleci (klipler gibi). */}
            <span className="absolute inset-y-0 left-0 z-[1] w-2 cursor-ew-resize" />
            <span className="absolute inset-y-0 right-0 z-[1] w-2 cursor-ew-resize" />
            {lane.kind === "music" ? (
              <MusicWave
                item={item as MusicItem}
                left={left}
                width={Math.max(6, right - left)}
                areaWidth={width}
                view={view}
                height={lane.height - 4}
              />
            ) : null}
            {lane.kind === "music" && (item as MusicItem).envelope ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                data-envelope-line
              >
                <polyline
                  fill="none"
                  stroke="#fef08a"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  points={(item as MusicItem)
                    .envelope!.map(
                      ([s, v]) =>
                        `${(s / (item as MusicItem).length) * 100},${100 - (v / 2) * 100}`,
                    )
                    .join(" ")}
                />
              </svg>
            ) : null}
            {lane.kind === "music"
              ? beatTimes(item as MusicItem).map((bt) => (
                  <span
                    key={bt}
                    data-beat
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/45"
                    style={{
                      left: `${((bt - (item as MusicItem).start) / (item as MusicItem).length) * 100}%`,
                    }}
                  />
                ))
              : null}
            {lane.kind === "music" ? (
              (item as MusicItem).linkedClipId ? (
                <Link2
                  size={12}
                  className="relative mr-1 shrink-0"
                  aria-label={t("editor.laneDetached")}
                />
              ) : (
                <Music2 size={12} className="relative mr-1 shrink-0" />
              )
            ) : lane.kind === "image" ? (
              <ImagePlus size={11} className="mr-1 shrink-0" />
            ) : lane.kind === "effect" ? (
              <Sparkles size={11} className="mr-1 shrink-0" />
            ) : (
              <EyeOff size={11} className="mr-1 shrink-0" />
            )}
            <span className="relative truncate">{label}</span>
            {lane.kind === "music" && Math.abs((item as MusicItem).volume - 1) > 0.01 ? (
              <span className="relative ml-1.5 shrink-0 rounded bg-black/35 px-1 font-mono text-[10px]">
                {volumeDb((item as MusicItem).volume)}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={t("editor.laneRemove")}
              title={t("editor.laneRemove")}
              className="relative ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded bg-black/40 group-hover:flex hover:bg-black/70"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(lane.kind, item.id);
              }}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function LaneHeader({ lane }: { lane: Lane }) {
  const { t } = useTranslation();
  if (lane.kind === "music" && lane.audioLane !== undefined)
    return <AudioLaneHeader lane={lane} index={lane.audioLane} />;
  const Icon =
    lane.kind === "music"
      ? Music2
      : lane.kind === "image"
        ? ImagePlus
        : lane.kind === "effect"
          ? Sparkles
          : EyeOff;
  const title = t(
    lane.kind === "music"
      ? "editor.laneMusic"
      : lane.kind === "image"
        ? "editor.laneImage"
        : lane.kind === "effect"
          ? "effectLane.title"
          : "editor.laneBlur",
  );
  return (
    <div
      className={`absolute inset-x-0 flex items-center justify-center border-t border-[var(--dk-border)] ${STYLE[lane.kind].ring}`}
      style={{ top: lane.top, height: lane.height }}
      title={title}
    >
      <Icon size={13} />
    </div>
  );
}

/** Ses izi başlığı: A1, A2… ve sessiz (M) / yalnız dinle (S). */
function AudioLaneHeader({ lane, index }: { lane: Lane; index: number }) {
  const { t } = useTranslation();
  const state = useEditorStore((s) => s.tracks[audioLaneKey(index)]) ?? {};
  const setTrack = useEditorStore((s) => s.setTrack);
  const toggle = (key: "muted" | "solo") => {
    setTrack(audioLaneKey(index), { [key]: !state[key] });
    refreshPlayback();
  };
  const button = (on: boolean, tone: string) =>
    `flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold transition ${
      on ? tone : "text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-white"
    }`;
  return (
    <div
      className="absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 border-t border-[var(--dk-border)] text-[#34d399]"
      style={{ top: lane.top, height: lane.height }}
      title={t("editor.laneAudio", { n: index + 1 })}
    >
      <span className="font-mono text-[10px] font-semibold">A{index + 1}</span>
      <span className="flex gap-0.5">
        <button
          type="button"
          className={button(!!state.muted, "bg-[var(--dk-warning)]/20 text-[var(--dk-warning)]")}
          aria-pressed={!!state.muted}
          aria-label={t("editor.audioLaneMute", { n: index + 1 })}
          title={t("editor.audioLaneMute", { n: index + 1 })}
          onClick={() => toggle("muted")}
        >
          M
        </button>
        <button
          type="button"
          className={button(!!state.solo, "bg-[#34d399]/25 text-[#34d399]")}
          aria-pressed={!!state.solo}
          aria-label={t("editor.audioLaneSolo", { n: index + 1 })}
          title={t("editor.audioLaneSolo", { n: index + 1 })}
          onClick={() => toggle("solo")}
        >
          S
        </button>
      </span>
    </div>
  );
}

/** Ses bloğunun dalga formu: dosya bir kaynaksa onun dalga formu, değilse müziğin kendi önizlemesinden. */
function MusicWave({
  item,
  left,
  width,
  areaWidth,
  view,
  height,
}: {
  item: MusicItem;
  left: number;
  width: number;
  areaWidth: number;
  view: TimelineView;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sourceToken = useEditorStore(
    (s) => s.sources.find((e) => e.source.path === item.path)?.stream?.token,
  );
  const musicToken = useLayerMedia((s) => s.tokens[item.path]);
  const token = sourceToken ?? musicToken;
  const peaks = useWaveStore((s) => (token ? s.byToken[token] : undefined));

  useEffect(() => {
    if (!sourceToken) ensureMediaUrl(item.path, "music");
  }, [item.path, sourceToken]);
  useEffect(() => {
    if (token) ensureWaveform(token, item.sourceDuration);
  }, [token, item.sourceDuration]);

  const visibleFrom = Math.max(0, -left);
  const visibleWidth = Math.max(0, Math.min(width, areaWidth - left) - visibleFrom);
  const secondsPerPx = areaWidth > 0 ? (view.end - view.start) / areaWidth : 0;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks || visibleWidth <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(visibleWidth * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, visibleWidth, height);
    ctx.fillStyle = "rgba(236, 253, 245, 0.55)";
    const mid = height / 2;
    for (let x = 0; x < visibleWidth; x += 2) {
      const src = item.srcStart + (visibleFrom + x) * secondsPerPx;
      const peak =
        peakInRange(peaks, item.sourceDuration, src, src + secondsPerPx * 2) *
        Math.min(1, item.volume);
      const h = Math.max(1, peak * (height - 4));
      ctx.fillRect(x, mid - h / 2, 1.5, h);
    }
  }, [peaks, item, visibleFrom, visibleWidth, secondsPerPx, height]);

  if (!peaks) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0.5"
      style={{ left: visibleFrom, width: visibleWidth, height }}
    />
  );
}
