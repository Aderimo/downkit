import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { currentSegments } from "../../lib/sequencePlayer";
import { handleSourceTime, xfadeAt, type Segment } from "../../lib/sequence";
import { PIXEL_SIZES, xfadeFrame, type XfadeLayer } from "../../lib/xfade";
import { lookCss } from "../../lib/clipLook";

// Klipler arası geçişin önizlemesi. Ana oynatıcı kesime kadar çıkan klibi,
// kesimden sonra giren klibi oynatır; geçiş süresince öbür klip ikinci (sessiz)
// bir video öğesinde gösterilir ve ikisine geçişin CSS karşılığı uygulanır
// (lib/xfade). Dışa aktarımda aynı geçiş FFmpeg ile yapılır.

/** Geçişe bu kadar kala ikinci video yüklenir: geçiş başında siyah kare olmasın. */
const LEAD_SECONDS = 1.5;

function layerStyle(layer: XfadeLayer | null): CSSProperties | undefined {
  if (!layer) return undefined;
  return {
    opacity: layer.opacity,
    clipPath: layer.clipPath,
    transform: layer.transform,
    filter: layer.filter,
    maskImage: layer.mask,
    WebkitMaskImage: layer.mask,
    zIndex: layer.top ? 2 : 1,
  };
}

/** `t` anındaki geçiş: ana oynatıcının rolü ve ikinci videoda gösterilecek parça. */
function useXfadeView() {
  const t = usePlayerStore((s) => s.currentTime);
  // Klipler değişince parçalar yeniden hesaplansın.
  useEditorStore((s) => s.clips);
  const segments = currentSegments();
  const active = xfadeAt(segments, t);
  if (!active) return { t, active: null, near: nearXfade(segments, t) };
  const frame = xfadeFrame(active.xfade.kind, active.progress);
  const mainIsOut = t < active.out.tEnd;
  return {
    t,
    active: {
      frame,
      main: mainIsOut ? frame.out : frame.in,
      overlay: mainIsOut ? frame.in : frame.out,
      other: mainIsOut ? active.in : active.out,
    },
    near: null,
  };
}

/** Yaklaşan geçişin giren parçası (önceden yüklemek için). */
function nearXfade(segments: readonly Segment[], t: number): Segment | null {
  for (let i = 0; i < segments.length - 1; i += 1) {
    const x = segments[i].xfadeOut;
    if (!x) continue;
    const start = segments[i].tEnd - x.duration / 2;
    if (t >= start - LEAD_SECONDS && t < start) return segments[i + 1];
  }
  return null;
}

/** Ana oynatıcının sarmalı: geçişteki rolünün görünümünü alır. */
export function XfadeMain({ children }: { children: ReactNode }) {
  const { active } = useXfadeView();
  return (
    <div className="absolute inset-0" style={layerStyle(active?.main ?? null)}>
      {children}
    </div>
  );
}

/** Geçiş süresince öbür klibi gösteren ikinci video ve siyah/beyaz örtü. */
export function XfadeOverlay() {
  const { t, active, near } = useXfadeView();
  const sources = useEditorStore((s) => s.sources);
  const playing = usePlayerStore((s) => s.playing);
  const rate = usePlayerStore((s) => s.rate);
  const segment = active?.other ?? near;
  const entry = segment
    ? (sources.find((s) => s.id === segment.sourceId) ?? sources[0] ?? null)
    : null;
  const url = entry?.stream?.hasVideo ? entry.stream.url : null;
  const ref = useRef<HTMLVideoElement>(null);

  // İkinci video ana oynatıcıyla birlikte ilerler; durunca tam kareye gider.
  useEffect(() => {
    const video = ref.current;
    if (!video || !segment || !entry) return;
    const want = handleSourceTime(segment, active ? t : segment.tStart, entry.duration);
    const drift = Math.abs(video.currentTime - want);
    if (playing && active) {
      video.playbackRate = Math.min(16, Math.max(0.0625, segment.speed * rate));
      if (video.paused) void video.play().catch(() => {});
      if (drift > 0.25) video.currentTime = want;
    } else {
      if (!video.paused) video.pause();
      if (drift > 0.04) video.currentTime = want;
    }
  });

  if (!segment || !url) return null;
  const look = lookCss(segment.look ?? null);
  const veil = active?.frame.veil;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={active ? layerStyle(active.overlay) : { opacity: 0 }}
      >
        <video
          ref={ref}
          key={url}
          src={url}
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-contain"
          style={{ filter: look.filter || undefined, transform: look.transform || undefined }}
        />
      </div>
      {veil ? (
        <div
          className="pointer-events-none absolute inset-0 z-[3]"
          style={{ background: veil.color, opacity: veil.opacity }}
        />
      ) : null}
    </>
  );
}

/** Piksel geçişinin önizlemesi: her blok boyutu için bir SVG süzgeci (blok ortasındaki
 * renk bloğun tamamına yayılır). Düzenleyicide bir kez bulunur; `filter: url(#dk-px-N)`. */
export function PixelFilters() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {PIXEL_SIZES.map((size) => (
          <filter
            key={size}
            id={`dk-px-${size}`}
            x="0"
            y="0"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feFlood x={size / 2} y={size / 2} width="1" height="1" />
            <feComposite width={size} height={size} />
            <feTile result="dots" />
            <feComposite in="SourceGraphic" in2="dots" operator="in" />
            <feMorphology operator="dilate" radius={size / 2} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
