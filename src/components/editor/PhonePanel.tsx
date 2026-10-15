import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { FRAME_SIZES, useEditorStore, type ExportOptions } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { currentCropPosition } from "../../lib/faceActions";
import { drawLayout } from "../../lib/splitDraw";
import { effectiveSplit, layoutStyle } from "../../lib/splitLayout";
import { SAFE_TEMPLATES, usePhoneTemplate, type SafeZone } from "../../lib/phoneSafe";
import { textsAt, type TextItem } from "../../lib/textItems";
import {
  overlaySegments,
  segmentAt,
  segmentEffects,
  sequenceEnd,
  sourceTimeAt,
} from "../../lib/sequence";
import { currentSegments } from "../../lib/sequencePlayer";
import { transformAt, type TransformValues } from "../../lib/clipTransform";
import { lookCss } from "../../lib/clipLook";
import { useLayerMedia } from "../../lib/layerActions";
import { isMotion } from "../../lib/motion";
import {
  currentLayout,
  FRAME_LAYOUTS,
  layoutOptions,
  type FrameLayoutId,
} from "../../lib/frameLayouts";
import { DEFAULT_BAND, stacked } from "../../lib/splitLayout";
import { PhoneEditor } from "./PhoneEditor";

// Telefon paneli: dışa aktarmanın telefonda nasıl görüneceği, ana videonun canlı
// kopyasından (kırpma, sığdırma + arka plan, kamera + oyun düzenleri dışa aktarmadaki
// hesapla). Kısa video uygulamalarının düğme / açıklama alanları seçilen şablona göre
// çizilir; yazı bu alanlara girerse uyarır. Panel küçülüp büyüdükçe telefon sığar.

const W = 216;
const H = 384;
const SCALE = 2;

type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Yazının telefon ekranındaki kutusu (0–1). `frame`: çıktı karesinin telefondaki yeri. */
function textRect(item: TextItem, frame: Rect, ctx: CanvasRenderingContext2D): Rect {
  const size = item.size * Math.min(frame.w * W, frame.h * H);
  ctx.font = `${item.bold ? 700 : 400} ${size}px system-ui, sans-serif`;
  const width = ctx.measureText(item.text).width;
  const cx = (frame.x + item.x * frame.w) * W;
  const cy = (frame.y + item.y * frame.h) * H;
  return {
    x: (cx - width / 2 - 4) / W,
    y: (cy - size * 0.7) / H,
    w: (width + 8) / W,
    h: (size * 1.4) / H,
  };
}

/** Kaynak karesi `r` kutusunda (piksel): içerik kutuya sığdırılıp (bindirilen klip başka
 * oranda olabilir) dönüşümüyle çizilir, taşan kısım kesilir. */
function paintTransformed(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  r: { x: number; y: number; w: number; h: number },
  v: TransformValues,
  alpha: number,
) {
  const scale = Math.min(r.w / video.videoWidth, r.h / video.videoHeight);
  const cw = video.videoWidth * scale;
  const ch = video.videoHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.globalAlpha = Math.max(0, Math.min(1, v.opacity * alpha));
  ctx.translate(r.x + r.w / 2 + v.x * r.w, r.y + r.h / 2 + v.y * r.h);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(v.scale, v.scale);
  ctx.drawImage(video, -cw / 2, -ch / 2, cw, ch);
  ctx.restore();
}

/** Ana parçanın dönüşümü ve bindirilen klipler (kaynak karesinin kutusunda). */
function paintSource(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  r: { x: number; y: number; w: number; h: number },
) {
  const t = usePlayerStore.getState().currentTime;
  const { clips, tracks } = useEditorStore.getState();
  const segment = segmentAt(currentSegments(), t);
  const src = segment ? sourceTimeAt(segment, t) : 0;
  ctx.save();
  // Klibin (ve efekt şeridinin) görünümü: filtre ve renk ayarları önizlemedekiyle aynı.
  const look = lookCss(segment?.look ?? null);
  if (look.filter) ctx.filter = look.filter;
  // Yakınlaştırma karenin tamamına (dönüşüm ve bindirmelerden önce kamera gibi).
  if (segment?.zoom) {
    const z = transformAt(segment.zoom, src);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.translate(r.x + r.w / 2 + z.x * r.w, r.y + r.h / 2 + z.y * r.h);
    ctx.scale(z.scale, z.scale);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  if (segment?.transform) {
    ctx.fillStyle = "#000";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    paintTransformed(ctx, video, r, transformAt(segment.transform, src), 1);
  } else {
    ctx.drawImage(video, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
  ctx.filter = "none";
  for (const o of overlaySegments(clips, tracks)) {
    if (t < o.tStart || t >= o.tEnd) continue;
    const el = document.querySelector<HTMLVideoElement>(`[data-overlay-clip="${o.clipId}"] video`);
    if (!el || el.readyState < 2 || !el.videoWidth) continue;
    paintTransformed(
      ctx,
      el,
      r,
      transformAt(o.transform, sourceTimeAt(o, t)),
      segmentEffects(o, t).opacity,
    );
  }
}

/** Videonun telefondaki çizimi; çıktı karesinin telefondaki yeri döner. */
function drawVideo(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, o: ExportOptions): Rect {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vertical = o.frame === "9:16";
  if (vertical && o.frameSplit) {
    const [fw, fh] = FRAME_SIZES["9:16"];
    drawLayout(ctx, video, effectiveSplit(o.split, vw / vh, fw, fh), W, H);
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const cover = Math.max(W / vw, H / vh);
  const fit = Math.min(W / vw, H / vh);
  if (vertical && !o.frameFit) {
    const pos = o.frameTrack
      ? currentCropPosition(usePlayerStore.getState().currentTime)
      : o.framePosition;
    paintSource(ctx, video, {
      x: (W - vw * cover) * pos,
      y: (H - vh * cover) / 2,
      w: vw * cover,
      h: vh * cover,
    });
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  if (vertical && o.frameBlur) {
    ctx.filter = "blur(10px) brightness(0.7)";
    ctx.drawImage(video, (W - vw * cover) / 2, (H - vh * cover) / 2, vw * cover, vh * cover);
    ctx.filter = "none";
  } else if (vertical && o.frameGradient) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, o.frameGradient[0]);
    g.addColorStop(1, o.frameGradient[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const dw = vw * fit;
  const dh = vh * fit;
  paintSource(ctx, video, { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh });
  return vertical
    ? { x: 0, y: 0, w: 1, h: 1 }
    : { x: (W - dw) / 2 / W, y: (H - dh) / 2 / H, w: dw / W, h: dh / H };
}

function drawZones(ctx: CanvasRenderingContext2D, zones: readonly SafeZone[]) {
  for (const z of zones) {
    ctx.fillStyle = "rgb(255 255 255 / 10%)";
    ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgb(255 255 255 / 45%)";
    ctx.lineWidth = 1;
    ctx.strokeRect(z.x * W + 0.5, z.y * H + 0.5, z.w * W - 1, z.h * H - 1);
    ctx.setLineDash([]);
    // Yer tutucu: sağ sütunda düğmeler, altta açıklama satırları.
    ctx.fillStyle = "rgb(255 255 255 / 55%)";
    if (z.kind === "side") {
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc((z.x + z.w / 2) * W, (z.y + (i + 0.5) * (z.h / 4)) * H, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (z.kind === "bottom") {
      ctx.fillRect(W * 0.05, (z.y + z.h * 0.3) * H, W * 0.4, 5);
      ctx.fillRect(W * 0.05, (z.y + z.h * 0.55) * H, W * 0.62, 4);
    }
  }
}

/** Bindirilen resimlerin (logo) tuvalde çizilecek öğeleri: adrese göre bir kez yüklenir. */
const imageCache = new Map<string, HTMLImageElement>();
function loadedImage(url: string): HTMLImageElement | null {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    imageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Ana oynatıcının videosu (geçiş katmanındaki ikinci video değil). */
const mainVideo = () => document.querySelector<HTMLVideoElement>("[data-tour=editor-player] video");

export function PhonePanel() {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const sourceAspect = useEditorStore((s) => {
    const info = s.source?.info;
    return info?.width && info.height ? info.width / info.height : 16 / 9;
  });
  const layoutId = currentLayout(options);
  const split = options.frameSplit && options.split ? options.split : null;
  const canBand = options.frameSplit && stacked(split?.style ?? "stack");
  const template = usePhoneTemplate((s) => s.template);
  const setTemplate = usePhoneTemplate((s) => s.set);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const zonesRef = useRef(SAFE_TEMPLATES[template]);
  const [blocked, setBlocked] = useState(false);
  const [cssH, setCssH] = useState(H);
  useEffect(() => {
    optionsRef.current = options;
    zonesRef.current = SAFE_TEMPLATES[template];
  });

  // Panelin boyuna (ve enine) göre telefon büyür/küçülür.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () =>
      setCssH(Math.max(140, Math.min(host.clientHeight - 12, ((host.clientWidth - 16) * H) / W)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let lastBlocked = false;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.filter = "none";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const video = mainVideo();
      let frame: Rect = { x: 0, y: 0, w: 1, h: 1 };
      if (video && video.readyState >= 2 && video.videoWidth) {
        frame = drawVideo(ctx, video, optionsRef.current);
      }
      const zones = zonesRef.current;
      const now = usePlayerStore.getState().currentTime;
      // Logolar ve çıkartmalar: çıkış karesine göre (dışa aktarmadaki gibi).
      const urls = useLayerMedia.getState().urls;
      for (const image of useEditorStore.getState().images) {
        if (now < image.start || now >= image.end || !urls[image.path]) continue;
        // Hareketli başlıklar telefon önizlemesinde çizilmez (video).
        if (isMotion(image)) continue;
        const img = loadedImage(urls[image.path]);
        if (!img) continue;
        const iw = image.size * frame.w * W;
        const ih = (iw * img.naturalHeight) / img.naturalWidth;
        ctx.globalAlpha = image.opacity;
        ctx.drawImage(
          img,
          (frame.x + image.x * frame.w) * W - iw / 2,
          (frame.y + image.y * frame.h) * H - ih / 2,
          iw,
          ih,
        );
        ctx.globalAlpha = 1;
      }
      let hit = false;
      for (const item of textsAt(useEditorStore.getState().texts, now)) {
        const size = item.size * Math.min(frame.w * W, frame.h * H);
        const rect = textRect(item, frame, ctx);
        const cx = (frame.x + item.x * frame.w) * W;
        const cy = (frame.y + item.y * frame.h) * H;
        if (item.bg) {
          // Yazının kendi şeridi (renk ve opaklık dışa aktarmadaki gibi).
          ctx.globalAlpha = item.bgOpacity ?? 1;
          ctx.fillStyle = item.bg;
          ctx.fillRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
          ctx.globalAlpha = 1;
        } else if (item.box) {
          ctx.fillStyle = "rgb(0 0 0 / 55%)";
          ctx.fillRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(1, size / 8);
        ctx.strokeStyle = "rgb(0 0 0 / 70%)";
        ctx.strokeText(item.upper ? item.text.toLocaleUpperCase("tr") : item.text, cx, cy);
        ctx.fillStyle = item.color;
        ctx.fillText(item.upper ? item.text.toLocaleUpperCase("tr") : item.text, cx, cy);
        if (zones.some((z) => overlaps(rect, z))) {
          hit = true;
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rect.x * W, rect.y * H, rect.w * W, rect.h * H);
        }
      }
      // İlerleme çubuğu (dışa aktarmadaki gibi süre boyunca dolar).
      const bar = optionsRef.current.progressBar;
      if (bar) {
        const end = sequenceEnd(useEditorStore.getState().clips);
        const share = end > 0 ? Math.min(1, now / end) : 0;
        const h = Math.max(2, bar.height * frame.h * H);
        ctx.fillStyle = bar.color;
        ctx.fillRect(
          frame.x * W,
          bar.top ? frame.y * H : (frame.y + frame.h) * H - h,
          share * frame.w * W,
          h,
        );
      }
      drawZones(ctx, zones);
      if (hit !== lastBlocked) {
        lastBlocked = hit;
        setBlocked(hit);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex h-full flex-col" data-phone-panel>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--dk-border)] px-2 py-1">
        <select
          value={template}
          aria-label={t("phone.template")}
          onChange={(e) => setTemplate(e.target.value as keyof typeof SAFE_TEMPLATES)}
          className="h-6 min-w-[7rem] flex-1 basis-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1.5 text-[11px]"
        >
          {(Object.keys(SAFE_TEMPLATES) as (keyof typeof SAFE_TEMPLATES)[]).map((k) => (
            <option key={k} value={k}>
              {t(`phone.templates.${k}`)}
            </option>
          ))}
        </select>
        {options.frame === "9:16" ? (
          <select
            value={layoutId}
            aria-label={t("layouts.title")}
            onChange={(e) =>
              useEditorStore
                .getState()
                .setExportOptions(
                  layoutOptions(e.target.value as FrameLayoutId, options, sourceAspect),
                )
            }
            className="h-6 min-w-0 flex-1 rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1 text-[11px]"
          >
            {FRAME_LAYOUTS.map((id) => (
              <option key={id} value={id}>
                {t(`layouts.name.${id}`)}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => useEditorStore.getState().setExportOptions({ frame: "9:16" })}
            className="h-6 shrink-0 rounded-md bg-[var(--dk-accent)] px-2 text-[11px] font-bold text-white"
          >
            {t("phone.makeVertical")}
          </button>
        )}
        {canBand && options.frame === "9:16" ? (
          <button
            type="button"
            aria-pressed={!!split?.band}
            title={t("phone.band")}
            aria-label={t("phone.band")}
            onClick={() => {
              const o = useEditorStore.getState().exportOptions;
              const base = o.split ?? null;
              if (!base) {
                useEditorStore.getState().setExportOptions({
                  ...layoutOptions("stackTop", o, sourceAspect),
                });
              }
              const cur = useEditorStore.getState().exportOptions.split;
              if (!cur) return;
              useEditorStore.getState().setExportOptions({
                split: { ...cur, band: cur.band ? null : { ...DEFAULT_BAND } },
              });
            }}
            className={`h-6 shrink-0 rounded-md px-1.5 text-[11px] ${
              split?.band
                ? "bg-[var(--dk-accent)] text-white"
                : "border border-[var(--dk-border)] hover:bg-white/5"
            }`}
          >
            {t("phone.bandShort")}
          </button>
        ) : null}
        {blocked ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded bg-[var(--dk-error)]/90 px-1.5 py-0.5 text-[10px] text-white"
            title={t("editor.phoneBlocked")}
            data-phone-blocked
          >
            <TriangleAlert size={11} />
            {t("phone.blocked")}
          </span>
        ) : null}
      </div>
      <div ref={hostRef} className="flex min-h-0 flex-1 items-center justify-center p-1.5">
        <div className="relative rounded-[22px] border-[4px] border-[#1f2937] bg-black">
          <PhoneEditorSlot sourceAspect={sourceAspect} />
          <canvas
            ref={canvasRef}
            width={W * SCALE}
            height={H * SCALE}
            style={{ width: (cssH * W) / H, height: cssH }}
            className="block rounded-[18px]"
            aria-label={t("editor.phoneView")}
            data-phone-style={
              options.frameSplit && options.split
                ? layoutStyle(options.split)
                : options.frameSplit
                  ? "stack"
                  : "frame"
            }
          />
          <span className="pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-[#1f2937]" />
        </div>
      </div>
    </div>
  );
}

/** Düzenleme katmanı tuvalin üstünde (çerçevenin içi). */
function PhoneEditorSlot({ sourceAspect }: { sourceAspect: number }) {
  return <PhoneEditor sourceAspect={sourceAspect} />;
}
