import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { updateBlur, useBlurSelection } from "../../lib/layerActions";
import { blurPosAt, setBlurKey, type BlurItem } from "../../lib/layers";
import { resizeRect, type Handle } from "../../lib/resizeRect";

// Gizleme bölgeleri önizlemede dışa aktarımdaki gibi görünür: bulanık ya da iri pikselli
// (pikseller oynatıcının karesinden çizilir). Seçili kutu sürüklenir, 8 tutamaçtan
// boyutlanır. Hareketli kutuda (anahtar kareli) taşımak o ana anahtar koyar. Konumlar
// kaynak karesinin oranı (dışa aktarımla aynı).

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HANDLES: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
  { h: "nw", style: { left: -6, top: -6 }, cursor: "nwse-resize" },
  { h: "n", style: { left: "calc(50% - 6px)", top: -6 }, cursor: "ns-resize" },
  { h: "ne", style: { right: -6, top: -6 }, cursor: "nesw-resize" },
  { h: "e", style: { right: -6, top: "calc(50% - 6px)" }, cursor: "ew-resize" },
  { h: "se", style: { right: -6, bottom: -6 }, cursor: "nwse-resize" },
  { h: "s", style: { left: "calc(50% - 6px)", bottom: -6 }, cursor: "ns-resize" },
  { h: "sw", style: { left: -6, bottom: -6 }, cursor: "nesw-resize" },
  { h: "w", style: { left: -6, top: "calc(50% - 6px)" }, cursor: "ew-resize" },
];

export function BlurOverlay({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const blurs = useEditorStore((s) => s.blurs);
  const time = usePlayerStore((s) => s.currentTime);
  const selected = useBlurSelection((s) => s.id);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const visible = blurs.filter((b) => b.id === selected || (time >= b.start && time < b.end));
  const shown = visible.length > 0;
  useEffect(() => {
    const el = boxRef.current;
    if (!shown || !el) return;
    const ro = new ResizeObserver(() => setBoxSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);
  if (!shown) return null;

  function drag(e: ReactPointerEvent, item: BlurItem, mode: "move" | Handle) {
    e.stopPropagation();
    e.preventDefault();
    useBlurSelection.getState().select(item.id);
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const start = { x: e.clientX, y: e.clientY };
    const at = usePlayerStore.getState().currentTime;
    const pos = blurPosAt(item, at);
    const rect = {
      x: clamp(pos.x, 0, 1 - item.w),
      y: clamp(pos.y, 0, 1 - item.h),
      w: item.w,
      h: item.h,
    };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    useEditorStore.getState().beginDrag();
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.width;
      const dy = (ev.clientY - start.y) / box.height;
      const next =
        mode === "move"
          ? { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.w), y: clamp(rect.y + dy, 0, 1 - rect.h) }
          : resizeRect(rect, mode, dx, dy);
      // Hareketli kutuda konum o anın anahtarına yazılır; boyut her anda aynıdır.
      const patch = item.keys?.length
        ? { w: next.w, h: next.h, keys: setBlurKey(item, at, next.x, next.y) }
        : next;
      updateBlur(item.id, patch, true);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      useEditorStore.getState().endDrag();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ containerType: "size" }}
    >
      <div
        ref={boxRef}
        className="relative"
        style={{
          width: `min(100cqw, calc(100cqh * ${sourceAspect}))`,
          aspectRatio: String(sourceAspect),
        }}
      >
        {visible.map((b) => {
          const on = time >= b.start && time < b.end;
          const isSelected = b.id === selected;
          const p = blurPosAt(b, time);
          const x = clamp(p.x, 0, 1 - b.w);
          const y = clamp(p.y, 0, 1 - b.h);
          // Dışa aktarımdaki boxblur yarıçapı kutunun kısa kenarına göre; CSS sigması ~0,8 katı.
          const sigma = (0.8 * Math.min(b.w * boxSize.w, b.h * boxSize.h)) / (10 - 6 * b.strength);
          return (
            <div
              key={b.id}
              data-blur={b.id}
              data-blur-mode={b.pixel ? "pixel" : "soft"}
              aria-label={t("editor.blurRegion")}
              onPointerDown={(e) => drag(e, b, "move")}
              onClick={(e) => e.stopPropagation()}
              className={`pointer-events-auto absolute cursor-move ${
                isSelected ? "outline-2 outline-offset-0 outline-white outline-dashed" : ""
              }`}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
                backdropFilter: on && !b.pixel ? `blur(${Math.max(2, sigma)}px)` : undefined,
                WebkitBackdropFilter: on && !b.pixel ? `blur(${Math.max(2, sigma)}px)` : undefined,
                background: on ? undefined : "rgb(255 255 255 / 10%)",
              }}
            >
              {on && b.pixel ? <PixelPreview item={b} x={x} y={y} /> : null}
              {isSelected && !on ? (
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-semibold text-white drop-shadow">
                  {t("editor.blurOffNow")}
                </span>
              ) : null}
              {isSelected
                ? HANDLES.map(({ h, style, cursor }) => (
                    <span
                      key={h}
                      data-blur-handle={h}
                      onPointerDown={(e) => drag(e, b, h)}
                      className="absolute h-3 w-3 rounded-sm border-2 border-black bg-white"
                      style={{ ...style, cursor }}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Pikselli gizlemenin önizlemesi: oynatıcının karesinden bölge küçültülüp kaba
 * piksellerle büyütülür (dışa aktarımdaki blok boyutuyla). */
function PixelPreview({ item, x, y }: { item: BlurItem; x: number; y: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef({ x, y, w: item.w, h: item.h, strength: item.strength });
  useEffect(() => {
    rectRef.current = { x, y, w: item.w, h: item.h, strength: item.strength };
  });
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = canvas
        .closest("[data-tour=editor-player]")
        ?.querySelector<HTMLVideoElement>("video");
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const r = rectRef.current;
      const sw = r.w * video.videoWidth;
      const sh = r.h * video.videoHeight;
      const block = Math.round(8 + 24 * r.strength);
      const cols = Math.max(1, Math.ceil(sw / block));
      const rows = Math.max(1, Math.ceil(sh / block));
      if (canvas.width !== cols || canvas.height !== rows) {
        canvas.width = cols;
        canvas.height = rows;
      }
      try {
        ctx.drawImage(
          video,
          r.x * video.videoWidth,
          r.y * video.videoHeight,
          sw,
          sh,
          0,
          0,
          cols,
          rows,
        );
      } catch {
        // Kare henüz çizilemiyor olabilir.
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
