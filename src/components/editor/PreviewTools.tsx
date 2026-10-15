import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { useWaveStore } from "../../lib/thumbCache";
import { useLayerMedia } from "../../lib/layerActions";
import { audibleMusic } from "../../lib/layers";
import { flatten } from "../../lib/sequence";
import { peakInRange } from "../../lib/timeline";
import { usePreviewTools } from "../../lib/editorPanel";

// Önizleme araçları: ızgara + güvenli alan, önce/sonra karşılaştırma, ses göstergesi.

/** Videonun çerçeve içinde göründüğü dikdörtgen (object-fit: contain). */
function useVideoRect(sourceAspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const fit = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w <= 0 || h <= 0) return;
      const width = Math.min(w, h * sourceAspect);
      const height = width / sourceAspect;
      setRect({ left: (w - width) / 2, top: (h - height) / 2, width, height });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [sourceAspect]);
  return { ref, rect };
}

/** Üçte bir çizgileri, merkez ve güvenli alanlar (%90 yazı, %95 görüntü). */
export function GridOverlay({ sourceAspect }: { sourceAspect: number }) {
  const on = usePreviewTools((s) => s.grid);
  const { ref, rect } = useVideoRect(sourceAspect);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden>
      {on && rect.width > 0 ? (
        <svg
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          data-preview-grid
        >
          {[100 / 3, 200 / 3].map((p) => (
            <g
              key={p}
              stroke="rgb(255 255 255 / 45%)"
              strokeWidth="0.25"
              vectorEffect="non-scaling-stroke"
            >
              <line x1={p} y1="0" x2={p} y2="100" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1={p} x2="100" y2={p} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <g stroke="rgb(255 255 255 / 60%)" vectorEffect="non-scaling-stroke">
            <line x1="48" y1="50" x2="52" y2="50" vectorEffect="non-scaling-stroke" />
            <line x1="50" y1="47" x2="50" y2="53" vectorEffect="non-scaling-stroke" />
          </g>
          <rect
            x="2.5"
            y="2.5"
            width="95"
            height="95"
            fill="none"
            stroke="rgb(56 189 248 / 55%)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x="5"
            y="5"
            width="90"
            height="90"
            fill="none"
            stroke="rgb(250 204 21 / 65%)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}

/** Önce / sonra: çizginin solunda efektsiz (ham) görüntü, sağında uygulanmış hâli. */
export function CompareOverlay({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const on = usePreviewTools((s) => s.compare);
  const split = usePreviewTools((s) => s.split);
  const setTools = usePreviewTools((s) => s.set);
  const { ref, rect } = useVideoRect(sourceAspect);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const splitRef = useRef(split);
  useEffect(() => {
    splitRef.current = split;
  });

  useEffect(() => {
    if (!on) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = canvas
        .closest("[data-tour=editor-player]")
        ?.querySelector<HTMLVideoElement>("video");
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
      if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!video || video.readyState < 2) return;
      // CSS filtresi ve hareket tuvale geçmez: çizilen kare "önce" hâlidir.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * splitRef.current, h);
      ctx.clip();
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {on && rect.width > 0 ? (
        <div
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          data-compare
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div
            className="pointer-events-auto absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${split * 100}%` }}
            role="slider"
            aria-label={t("editor.compareSlider")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const move = (ev: PointerEvent) =>
                setTools({
                  split: Math.min(0.98, Math.max(0.02, (ev.clientX - box.left) / box.width)),
                });
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgb(0_0_0/60%)]" />
            <span className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60" />
          </div>
          <span className="absolute top-2 left-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {t("editor.compareBefore")}
          </span>
          <span className="absolute top-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {t("editor.compareAfter")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** O andaki ses düzeyi (0–1): videonun ve duyulan ses izlerinin dalga formundan. */
function levelAt(t: number): number {
  const s = useEditorStore.getState();
  const waves = useWaveStore.getState().byToken;
  const span = 0.05;
  let sum = 0;
  const segment = flatten(s.clips, s.tracks).find((g) => t >= g.tStart && t < g.tEnd);
  if (segment && segment.volume > 0) {
    const entry = s.sources.find((e) => e.id === (segment.sourceId ?? s.sources[0]?.id));
    const peaks = entry?.stream?.token ? waves[entry.stream.token] : undefined;
    if (peaks && entry) {
      const src = segment.srcStart + (t - segment.tStart) * segment.speed;
      sum += (peakInRange(peaks, entry.duration, src - span, src + span) * segment.volume) ** 2;
    }
  }
  const tokens = useLayerMedia.getState().tokens;
  for (const m of audibleMusic(s.music, s.tracks)) {
    if (t < m.start || t >= m.start + m.length) continue;
    const token = s.sources.find((e) => e.source.path === m.path)?.stream?.token ?? tokens[m.path];
    const peaks = token ? waves[token] : undefined;
    if (!peaks) continue;
    const src = m.srcStart + (t - m.start);
    sum += (peakInRange(peaks, m.sourceDuration, src - span, src + span) * m.volume) ** 2;
  }
  return Math.min(1.2, Math.sqrt(sum));
}

/** Ses göstergesi: yeşil → sarı → kırmızı; kırmızı kısım kırpılma (seviye çok yüksek) uyarısı. */
export function LevelMeter() {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let hold = 0;
    let holdAt = 0;
    let shown = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const p = usePlayerStore.getState();
      const target = p.muted ? 0 : levelAt(p.currentTime) * p.volume;
      // Hızlı yükselir, yavaş iner (gerçek göstergeler gibi).
      shown = target > shown ? target : shown * 0.9 + target * 0.1;
      if (shown >= hold || now - holdAt > 1200) {
        hold = shown;
        holdAt = now;
      }
      const pct = (v: number) => `${Math.min(100, (v / 1.2) * 100)}%`;
      if (barRef.current) barRef.current.style.clipPath = `inset(0 calc(100% - ${pct(shown)}) 0 0)`;
      if (peakRef.current) peakRef.current.style.left = pct(hold);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="relative h-2 w-16 overflow-hidden rounded-full bg-[var(--dk-bg)]"
      title={t("editor.levelMeter")}
      aria-label={t("editor.levelMeter")}
      data-level-meter
    >
      <div
        ref={barRef}
        className="absolute inset-0 bg-[linear-gradient(90deg,#22c55e_0%,#22c55e_62%,#eab308_75%,#ef4444_86%)]"
        style={{ clipPath: "inset(0 100% 0 0)" }}
      />
      <div ref={peakRef} className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: 0 }} />
    </div>
  );
}
