import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { FRAME_SIZES, useEditorStore } from "../../store/editorStore";

/** Önizlemede dikey/kare çerçevenin kalacak bölgesi: dışı karartılır, çerçeve
 * sürüklenerek konum ayarlanır. Videonun kutudaki yeri CSS ile (object-contain
 * gibi) hesaplanır; ölçüm gerekmediği için pencere boyutu değişse de kaymaz.
 * `sourceAspect`: kaynak videonun en/boy oranı. */
export function CropOverlay({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const videoRef = useRef<HTMLDivElement>(null);

  if (options.frame === "original" || options.frameFit) return null;
  const [fw, fh] = FRAME_SIZES[options.frame];
  const target = fw / fh;
  // Kaynak hedeften genişse yatayda, darsa dikeyde kırpılır.
  const horizontal = sourceAspect > target;
  const share = horizontal ? target / sourceAspect : sourceAspect / target;
  const pos = options.framePosition;
  const offset = `${(1 - share) * pos * 100}%`;
  const size = `${share * 100}%`;

  function onPointerDown(e: ReactPointerEvent) {
    e.stopPropagation();
    const video = videoRef.current?.getBoundingClientRect();
    if (!video) return;
    const slack = (horizontal ? video.width : video.height) * (1 - share);
    if (slack <= 0) return;
    const startPos = pos;
    const start = horizontal ? e.clientX : e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta = (horizontal ? ev.clientX : ev.clientY) - start;
      setOptions({ framePosition: Math.min(1, Math.max(0, startPos + delta / slack)) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ containerType: "size" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={videoRef}
        className="relative"
        style={{
          width: `min(100cqw, calc(100cqh * ${sourceAspect}))`,
          aspectRatio: String(sourceAspect),
        }}
      >
        <div
          role="slider"
          aria-label={t("editor.framePosition")}
          aria-valuenow={Math.round(pos * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={onPointerDown}
          className={`absolute border-2 border-[#FFD43B] shadow-[0_0_0_9999px_rgb(0_0_0/55%)] ${
            horizontal ? "inset-y-0 cursor-ew-resize" : "inset-x-0 cursor-ns-resize"
          }`}
          style={horizontal ? { left: offset, width: size } : { top: offset, height: size }}
        >
          <span className="absolute top-1 left-1 rounded bg-[#FFD43B] px-1.5 text-[10px] font-bold text-black">
            {options.frame}
          </span>
        </div>
      </div>
    </div>
  );
}
