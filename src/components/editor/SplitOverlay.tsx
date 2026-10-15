import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { FRAME_SIZES, useEditorStore } from "../../store/editorStore";
import {
  effectiveSplit,
  layoutStyle,
  moveRect,
  resizeRect,
  slotAspects,
  type Rect,
  type SplitLayout,
} from "../../lib/splitLayout";
import { drawLayout } from "../../lib/splitDraw";
import { useWorkspaceStore } from "../../lib/workspaces";

// Kamera + oyun düzeni önizlemede: kaynak videonun üstünde kutular (sarı kamera,
// turuncu ikinci kamera, mavi oyun) sürüklenir ve sağ alt köşesinden büyütülür; köşedeki
// küçük telefon, dışa aktarımın nasıl görüneceğini aynı video karesinden canlı çizer
// (alt alta, iki kamera, daire kamera, köşede kamera).

const CAM_COLOR = "#FFD43B";
const CAM2_COLOR = "#ff9f43";
const GAME_COLOR = "#4f7bff";

type Which = "cam" | "cam2" | "game";

export function SplitOverlay({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const boxRef = useRef<HTMLDivElement>(null);
  const phonePanel = useWorkspaceStore((s) => s.open.includes("phone"));
  if (options.frame === "original" || !options.frameSplit) return null;
  const [fw, fh] = FRAME_SIZES[options.frame];
  const layout = effectiveSplit(options.split, sourceAspect, fw, fh);
  const style = layoutStyle(layout);
  const slots = slotAspects(layout.camShare, fw, fh, style);
  const aspectOf = (which: Which) => (which === "game" ? slots.game : slots.cam);

  function drag(e: ReactPointerEvent, which: Which, mode: "move" | "resize") {
    e.stopPropagation();
    e.preventDefault();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const start = { x: e.clientX, y: e.clientY };
    const origin: SplitLayout = layout;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.width;
      const dy = (ev.clientY - start.y) / box.height;
      const rect = origin[which];
      if (!rect) return;
      const next =
        mode === "move"
          ? moveRect(rect, dx, dy)
          : resizeRect(rect, dx, aspectOf(which), sourceAspect);
      setOptions({ split: { ...origin, [which]: next } });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const label = (which: Which) =>
    style === "podcast"
      ? t(which === "cam" ? "layouts.person1" : "layouts.person2")
      : which === "game"
        ? t("editor.splitGame")
        : which === "cam2"
          ? t("editor.splitCam2")
          : t("editor.splitCam");

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
        {(style === "duo" ? (["game", "cam", "cam2"] as const) : (["game", "cam"] as const)).map(
          (which) => {
            const rect = layout[which];
            return rect ? (
              <SplitBox
                key={which}
                which={which}
                rect={rect}
                label={label(which)}
                round={style === "circle" && which === "cam"}
                onDrag={(e, mode) => drag(e, which, mode)}
              />
            ) : null;
          },
        )}
      </div>
      {phonePanel ? null : <PhonePreview layout={layout} frame={[fw, fh]} />}
    </div>
  );
}

/** Kamera / oyun kutusu: sürüklenir, sağ alt köşesinden büyütülür. */
function SplitBox({
  which,
  rect: r,
  label,
  round,
  onDrag,
}: {
  which: Which;
  rect: Rect;
  label: string;
  round: boolean;
  onDrag: (e: ReactPointerEvent, mode: "move" | "resize") => void;
}) {
  const color = which === "cam" ? CAM_COLOR : which === "cam2" ? CAM2_COLOR : GAME_COLOR;
  return (
    <div
      role="group"
      aria-label={label}
      data-split={which}
      onPointerDown={(e) => onDrag(e, "move")}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute cursor-move"
      style={{
        left: `${r.x * 100}%`,
        top: `${r.y * 100}%`,
        width: `${r.w * 100}%`,
        height: `${r.h * 100}%`,
        border: `2px solid ${color}`,
        background: `${color}14`,
        borderRadius: round ? "50%" : undefined,
        zIndex: which === "game" ? 1 : 2,
      }}
    >
      <span
        className="absolute top-1 left-1 rounded px-1.5 text-[10px] font-bold whitespace-nowrap text-black"
        style={{ background: color }}
      >
        {label}
      </span>
      <span
        onPointerDown={(e) => onDrag(e, "resize")}
        className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-black"
        style={{ background: color }}
      />
    </div>
  );
}

/** Köşedeki telefon: bölgeler, ana oynatıcının video karesinden canlı çizilir. */
function PhonePreview({ layout, frame }: { layout: SplitLayout; frame: [number, number] }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      // İlk video ana oynatıcıdır (geçiş katmanının ikinci videosu ondan sonra gelir).
      const video = canvas
        .closest("[data-tour=editor-player]")
        ?.querySelector<HTMLVideoElement>("video");
      const { width: W, height: H } = canvas;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      drawLayout(ctx, video, layoutRef.current, W, H);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const width = 108;
  return (
    // Telefon kamera kutusunun öbür köşesinde durur: kutuyu örtmesin.
    <div
      className={`pointer-events-none absolute top-2 z-10 rounded-[14px] border-2 border-white/80 bg-black p-1 shadow-lg ${
        layout.cam.x + layout.cam.w / 2 > 0.5 ? "left-2" : "right-2"
      }`}
    >
      <canvas
        ref={canvasRef}
        width={width * 2}
        height={Math.round((width * 2 * frame[1]) / frame[0])}
        style={{ width, height: Math.round((width * frame[1]) / frame[0]) }}
        className="block rounded-[10px]"
        aria-label={t("editor.splitPhone")}
        data-split-phone={layoutStyle(layout)}
      />
    </div>
  );
}
