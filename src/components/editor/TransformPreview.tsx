import { useTranslation } from "react-i18next";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { currentSegments } from "../../lib/sequencePlayer";
import {
  overlaySegments,
  segmentAt,
  segmentEffects,
  sourceTimeAt,
  type OverlaySegment,
} from "../../lib/sequence";
import { transformAt, transformCss, type TransformValues } from "../../lib/clipTransform";
import { lookCss } from "../../lib/clipLook";
import {
  beginTransformEdit,
  clipSourceTime,
  endTransformEdit,
  playheadInClip,
  setTransformValues,
  useTransformUi,
} from "../../lib/transformActions";
import { useZoomUi, updateZoom } from "../../lib/zoomActions";
import { zoomFactor } from "../../lib/clipZoom";

// Klip dönüşümünün önizlemesi. Video, kaynağın en-boy oranındaki "tuval" kutusunda
// oynar (dışa aktarmadaki kare); dönüşüm bu kutunun içinde CSS ile uygulanır, taşan
// kısım kesilir. Üst izden bindirilen klipler aynı kutuda kendi videolarıyla oynar.
// Formüller dışa aktarımla aynı (lib/clipTransform).

/** Kutu: görüntü alanına sığan, kaynağın oranındaki dikdörtgen. */
function Canvas({
  aspect,
  children,
  className,
  clip = true,
}: {
  aspect: number;
  children: ReactNode;
  className?: string;
  /** Taşan kısım kesilsin (dışa aktarmadaki kare gibi). */
  clip?: boolean;
}) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center ${className ?? ""}`}
      style={{ containerType: "size" }}
    >
      <div
        className={`relative ${clip ? "overflow-hidden" : "pointer-events-none"}`}
        style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: String(aspect) }}
      >
        {children}
      </div>
    </div>
  );
}

/** Ana oynatıcının tuvali: o anki parçanın dönüşümü uygulanır. */
export function ClipCanvas({ aspect, children }: { aspect: number; children: ReactNode }) {
  const t = usePlayerStore((s) => s.currentTime);
  const inGap = usePlayerStore((s) => s.inGap);
  // Klipler değişince parçalar yeniden hesaplansın.
  useEditorStore((s) => s.clips);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const zoomEdit = useZoomUi((s) => s.selected);
  const segment = inGap ? null : segmentAt(currentSegments(), t);
  const src = segment ? sourceTimeAt(segment, t) : 0;
  const css = segment?.transform ? transformCss(transformAt(segment.transform, src)) : null;
  // Yakınlaştırma dönüşümün dışında: karenin tamamına kamera gibi. Bölgesi düzenlenirken
  // (dururken) görüntü yakınlaşmadan gösterilir.
  const editingZoom = !playing && zoomEdit?.clipId === segment?.clipId;
  const zoom = segment?.zoom && !editingZoom ? transformCss(transformAt(segment.zoom, src)) : null;
  return (
    <Canvas aspect={aspect}>
      <div
        className="absolute inset-0"
        data-clip-zoom={zoom ? "" : undefined}
        style={zoom ? { transform: zoom.transform } : undefined}
      >
        <div
          className="absolute inset-0"
          data-clip-transform={css ? "" : undefined}
          style={css ? { transform: css.transform, opacity: css.opacity } : undefined}
        >
          {children}
        </div>
      </div>
    </Canvas>
  );
}

/** Bindirmeye bu kadar kala video yüklenir: başında siyah kare olmasın. */
const LEAD_SECONDS = 1.5;

/** Üst izden bindirilen klipler: her biri kendi (senkron) videosunda. */
export function OverlayClips({ aspect }: { aspect: number }) {
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const t = usePlayerStore((s) => s.currentTime);
  const segments = overlaySegments(clips, tracks);
  const shown = segments.filter((s) => t >= s.tStart - LEAD_SECONDS && t < s.tEnd);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((segment) => (
        <OverlayVideo
          key={`${segment.clipId}-${segment.tStart}`}
          segment={segment}
          aspect={aspect}
          time={t}
        />
      ))}
    </>
  );
}

function OverlayVideo({
  segment,
  aspect,
  time,
}: {
  segment: OverlaySegment;
  aspect: number;
  time: number;
}) {
  const sources = useEditorStore((s) => s.sources);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const rate = usePlayerStore((s) => s.rate);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const entry = sources.find((s) => s.id === segment.sourceId) ?? sources[0] ?? null;
  const url = entry?.stream?.hasVideo ? entry.stream.url : null;
  const ref = useRef<HTMLVideoElement>(null);
  const active = time >= segment.tStart;
  const src = sourceTimeAt(segment, Math.max(time, segment.tStart));
  const effects = segmentEffects(segment, time);

  // Ana oynatıcıyla birlikte ilerler; durunca tam kareye gider.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted || !active;
    video.volume = Math.min(1, Math.max(0, volume * effects.gain));
    const drift = Math.abs(video.currentTime - src);
    if (playing && active) {
      video.playbackRate = Math.min(16, Math.max(0.0625, segment.speed * rate));
      if (video.paused) void video.play().catch(() => {});
      if (drift > 0.25) video.currentTime = src;
    } else {
      if (!video.paused) video.pause();
      if (drift > 0.04) video.currentTime = src;
    }
  });

  if (!url) return null;
  const v = transformAt(segment.transform, src);
  const css = transformCss(v);
  const zoom = segment.zoom ? transformCss(transformAt(segment.zoom, src)) : null;
  const look = lookCss(segment.look ?? null);
  return (
    <Canvas aspect={aspect} className="pointer-events-none">
      <div
        className="absolute inset-0"
        data-overlay-clip={segment.clipId}
        style={{
          transform: css?.transform,
          opacity: active ? v.opacity * effects.opacity : 0,
        }}
      >
        {/* Bindirilen klibin yakınlaştırması kendi karesinde (kenarı kesilir). */}
        <div className="absolute inset-0 overflow-hidden">
          <video
            ref={ref}
            src={url}
            playsInline
            preload="auto"
            className="h-full w-full object-contain"
            style={{
              filter: look.filter || undefined,
              transform: [zoom?.transform, look.transform].filter(Boolean).join(" ") || undefined,
            }}
          />
        </div>
      </div>
    </Canvas>
  );
}

/** Seçili klibin dönüşüm kutusu: gövdesi taşır, köşeleri ölçekler, üstteki tutamaç döndürür. */
export function TransformBox({ aspect }: { aspect: number }) {
  const editing = useTransformUi((s) => s.editing);
  const t = usePlayerStore((s) => s.currentTime);
  const clip = useEditorStore((s) =>
    s.selectedIds.length === 1 ? s.clips.find((c) => c.id === s.selectedIds[0]) : undefined,
  );
  const hidden = useEditorStore((s) => (clip ? s.tracks[clip.track]?.hidden === true : true));
  const svgRef = useRef<SVGSVGElement>(null);
  if (!editing || !clip || hidden || !playheadInClip(clip, t)) return null;
  const v = transformAt(clip.transform, clipSourceTime(clip, t));
  const id = clip.id;

  // Birimler: genişlik = aspect, yükseklik = 1 (SVG viewBox ile aynı).
  const W = aspect;
  const cx = W / 2 + v.x * W;
  const cy = 0.5 + v.y;
  const rad = (v.rotation * Math.PI) / 180;
  const point = (dx: number, dy: number): [number, number] => [
    cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
  const hw = (v.scale * W) / 2;
  const hh = v.scale / 2;
  const corners = [point(-hw, -hh), point(hw, -hh), point(hw, hh), point(-hw, hh)];
  const rotateHandle = point(0, -hh - 0.08);
  const r = 0.018;

  function drag(e: ReactPointerEvent, mode: "move" | "scale" | "rotate") {
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const unit = box.height; // 1 birim = kutunun yüksekliği
    const at = (ev: { clientX: number; clientY: number }) => [
      (ev.clientX - box.left) / unit,
      (ev.clientY - box.top) / unit,
    ];
    const [sx, sy] = at(e);
    const start: TransformValues = v;
    const startDist = Math.hypot(sx - cx, sy - cy) || 1e-3;
    const startAngle = Math.atan2(sy - cy, sx - cx);
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    let began = false;
    const move = (ev: PointerEvent) => {
      if (!began) {
        beginTransformEdit();
        began = true;
      }
      const [px, py] = at(ev);
      if (mode === "move") {
        setTransformValues(id, { x: start.x + (px - sx) / W, y: start.y + (py - sy) }, true);
      } else if (mode === "scale") {
        const k = Math.hypot(px - cx, py - cy) / startDist;
        setTransformValues(id, { scale: start.scale * k }, true);
      } else {
        let deg = start.rotation + ((Math.atan2(py - cy, px - cx) - startAngle) * 180) / Math.PI;
        deg = ((((deg + 180) % 360) + 360) % 360) - 180;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        setTransformValues(id, { rotation: deg }, true);
      }
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
    <Canvas aspect={aspect} className="pointer-events-none z-[4]" clip={false}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} 1`}
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        data-transform-box
        onClick={(e) => e.stopPropagation()}
      >
        <polygon
          points={corners.map((p) => p.join(",")).join(" ")}
          fill="transparent"
          stroke="#ffd43b"
          strokeWidth={0.004}
          strokeDasharray="0.012 0.008"
          className="pointer-events-auto cursor-move"
          data-transform-move
          onPointerDown={(e) => drag(e, "move")}
        />
        <line
          x1={point(0, -hh)[0]}
          y1={point(0, -hh)[1]}
          x2={rotateHandle[0]}
          y2={rotateHandle[1]}
          stroke="#ffd43b"
          strokeWidth={0.003}
        />
        {corners.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={r}
            fill="#ffd43b"
            stroke="#000"
            strokeWidth={0.003}
            className="pointer-events-auto cursor-nwse-resize"
            data-transform-scale={i}
            onPointerDown={(e) => drag(e, "scale")}
          />
        ))}
        <circle
          cx={rotateHandle[0]}
          cy={rotateHandle[1]}
          r={r}
          fill="#fff"
          stroke="#000"
          strokeWidth={0.003}
          className="pointer-events-auto cursor-grab"
          data-transform-rotate
          onPointerDown={(e) => drag(e, "rotate")}
        />
      </svg>
    </Canvas>
  );
}

/** Seçili yakınlaştırmanın bölgesi: gövdesi taşır, köşesi büyütür (oran karenin oranı). */
export function ZoomBox({ aspect }: { aspect: number }) {
  const { t } = useTranslation();
  const selected = useZoomUi((s) => s.selected);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const clip = useEditorStore((s) =>
    selected && s.selectedIds.includes(selected.clipId)
      ? s.clips.find((c) => c.id === selected.clipId)
      : undefined,
  );
  const zoom = clip?.zooms?.find((z) => z.id === selected?.zoomId);
  const boxRef = useRef<HTMLDivElement>(null);
  if (!clip || !zoom || playing) return null;
  const clipId = clip.id;
  const zoomId = zoom.id;

  function drag(e: ReactPointerEvent, mode: "move" | "size", which: "from" | "to" = "from") {
    e.stopPropagation();
    e.preventDefault();
    const host = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!host || !zoom) return;
    const pan = which === "to" ? zoom.pan : undefined;
    const region = pan ?? zoom;
    const set = (patch: Partial<{ x: number; y: number; size: number }>) =>
      updateZoom(clipId, zoomId, pan ? { pan: { ...pan, ...patch } } : patch, true);
    const start = { x: e.clientX, y: e.clientY, zx: region.x, zy: region.y };
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    let began = false;
    const move = (ev: PointerEvent) => {
      if (!began) {
        beginTransformEdit();
        began = true;
      }
      if (mode === "move") {
        set({
          x: start.zx + (ev.clientX - start.x) / host.width,
          y: start.zy + (ev.clientY - start.y) / host.height,
        });
      } else {
        const cx = host.left + start.zx * host.width;
        const cy = host.top + start.zy * host.height;
        const half = Math.max(
          Math.abs(ev.clientX - cx) / host.width,
          Math.abs(ev.clientY - cy) / host.height,
        );
        set({ size: half * 2 });
      }
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
    <Canvas aspect={aspect} className="pointer-events-none z-[4]" clip={false}>
      <div
        ref={boxRef}
        data-zoom-box
        className="pointer-events-auto absolute cursor-move border-2 border-dashed border-[#a855f7] bg-[#a855f7]/10 shadow-[0_0_0_9999px_rgb(0_0_0/45%)]"
        style={{
          left: `${(zoom.x - zoom.size / 2) * 100}%`,
          top: `${(zoom.y - zoom.size / 2) * 100}%`,
          width: `${zoom.size * 100}%`,
          height: `${zoom.size * 100}%`,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => drag(e, "move")}
      >
        <span className="pointer-events-none absolute top-1 left-1 rounded bg-[#a855f7] px-1 font-mono text-[10px] font-bold text-white">
          {zoomFactor(zoom).toFixed(1)}×
        </span>
        <span
          data-zoom-size
          className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-black bg-[#a855f7]"
          onPointerDown={(e) => drag(e, "size")}
        />
      </div>
      {zoom.pan ? (
        <div
          data-zoom-pan-box
          className="pointer-events-auto absolute cursor-move border-2 border-dashed border-[#22d3ee] bg-[#22d3ee]/10"
          style={{
            left: `${(zoom.pan.x - zoom.pan.size / 2) * 100}%`,
            top: `${(zoom.pan.y - zoom.pan.size / 2) * 100}%`,
            width: `${zoom.pan.size * 100}%`,
            height: `${zoom.pan.size * 100}%`,
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => drag(e, "move", "to")}
        >
          <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-[#22d3ee] px-1 font-mono text-[10px] font-bold text-black">
            {t("zoom.panEnd")} {zoomFactor(zoom.pan).toFixed(1)}×
          </span>
          <span
            data-zoom-pan-size
            className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-black bg-[#22d3ee]"
            onPointerDown={(e) => drag(e, "size", "to")}
          />
        </div>
      ) : null}
    </Canvas>
  );
}
