import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import {
  BAND_RANGE,
  CAM_SHARE_RANGE,
  SPOT_SIZE_RANGE,
  bandShare,
  effectiveSplit,
  layoutStyle,
  stacked,
  withShare,
  type SplitLayout,
} from "../../lib/splitLayout";
import { textsAt, updateText } from "../../lib/textItems";
import { updateImage } from "../../lib/layerActions";

// Telefon önizlemesinde doğrudan düzenleme (dikey 9:16 çıktı): kamera ile oyun
// arasındaki çizgi sürüklenir, kamera üste / alta alınır, daire / köşe kamera taşınıp
// boyutlanır; yazılar ve logolar telefonun üstünde taşınır. Hepsi dışa aktarmanın
// kendi alanlarına yazılır (önizleme = çıktı).

const W = 1080;
const H = 1920;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Sürükleme: `onMove` her harekette 0–1 telefon koordinatıyla çağrılır. */
function dragOn(
  e: ReactPointerEvent,
  onMove: (fx: number, fy: number, dx: number, dy: number) => void,
  history: { begin: () => void; end: () => void } | null,
) {
  e.stopPropagation();
  e.preventDefault();
  const host = (e.currentTarget as HTMLElement).closest("[data-phone-editor]")!;
  const box = host.getBoundingClientRect();
  const sx = e.clientX;
  const sy = e.clientY;
  const target = e.currentTarget as Element;
  target.setPointerCapture(e.pointerId);
  let began = false;
  const move = (ev: PointerEvent) => {
    if (!began) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return;
      history?.begin();
      began = true;
    }
    onMove(
      (ev.clientX - box.left) / box.width,
      (ev.clientY - box.top) / box.height,
      (ev.clientX - sx) / box.width,
      (ev.clientY - sy) / box.height,
    );
  };
  const up = () => {
    target.removeEventListener("pointermove", move as EventListener);
    target.removeEventListener("pointerup", up);
    if (began) history?.end();
  };
  target.addEventListener("pointermove", move as EventListener);
  target.addEventListener("pointerup", up);
}

const undoable = {
  begin: () => useEditorStore.getState().beginDrag(),
  end: () => useEditorStore.getState().endDrag(),
};

export function PhoneEditor({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const texts = useEditorStore((s) => s.texts);
  const images = useEditorStore((s) => s.images);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const time = usePlayerStore((s) => s.currentTime);
  if (options.frame !== "9:16") return null;
  const setSplit = (split: SplitLayout) =>
    useEditorStore.getState().setExportOptions({ frameSplit: true, split });
  const layout = options.frameSplit ? effectiveSplit(options.split, sourceAspect, W, H) : null;
  const style = layout ? layoutStyle(layout) : null;

  // Alt alta düzende sınırlar (telefon yüksekliğinin oranı).
  let dividers: { y: number; kind: "cam" | "band" }[] = [];
  if (layout && style && stacked(style)) {
    const cs = layout.camShare;
    const b = bandShare(layout);
    dividers = layout.camTop
      ? [{ y: cs, kind: "cam" }, ...(b > 0 ? [{ y: cs + b, kind: "band" as const }] : [])]
      : [{ y: 1 - cs, kind: "cam" }, ...(b > 0 ? [{ y: 1 - cs - b, kind: "band" as const }] : [])];
  }

  function dragDivider(e: ReactPointerEvent, kind: "cam" | "band") {
    if (!layout) return;
    const start = layout;
    dragOn(
      e,
      (_fx, fy) => {
        if (kind === "cam") {
          const share = start.camTop ? fy : 1 - fy;
          setSplit(
            withShare(
              start,
              clamp(share, CAM_SHARE_RANGE.min, CAM_SHARE_RANGE.max),
              sourceAspect,
              W,
              H,
            ),
          );
        } else if (start.band) {
          const share = start.camTop ? fy - start.camShare : 1 - start.camShare - fy;
          setSplit(
            withShare(
              {
                ...start,
                band: { ...start.band, share: clamp(share, BAND_RANGE.min, BAND_RANGE.max) },
              },
              start.camShare,
              sourceAspect,
              W,
              H,
            ),
          );
        }
      },
      null,
    );
  }

  function dragSpot(e: ReactPointerEvent, mode: "move" | "size") {
    if (!layout?.spot) return;
    const start = layout;
    const spot = layout.spot;
    dragOn(
      e,
      (fx, _fy, dx, dy) => {
        if (mode === "move") {
          setSplit({
            ...start,
            spot: { ...spot, x: clamp(spot.x + dx, 0, 1), y: clamp(spot.y + dy, 0, 1) },
          });
        } else {
          const half = Math.abs(fx - spot.x);
          setSplit({
            ...start,
            spot: { ...spot, size: clamp(half * 2, SPOT_SIZE_RANGE.min, SPOT_SIZE_RANGE.max) },
          });
        }
      },
      null,
    );
  }

  const visibleTexts = textsAt(texts, time);
  const visibleImages = images.filter((i) => time >= i.start && time < i.end);

  return (
    <div className="absolute inset-0" data-phone-editor>
      {dividers.map((d) => (
        <div
          key={d.kind}
          data-phone-divider={d.kind}
          role="separator"
          aria-orientation="horizontal"
          aria-label={d.kind === "cam" ? t("phone.camLine") : t("phone.bandLine")}
          title={d.kind === "cam" ? t("phone.camLine") : t("phone.bandLine")}
          onPointerDown={(e) => dragDivider(e, d.kind)}
          className="group absolute inset-x-0 z-[2] h-3 -translate-y-1/2 cursor-ns-resize"
          style={{ top: `${d.y * 100}%` }}
        >
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-[#ffd43b]/0 group-hover:bg-[#ffd43b]" />
          {d.kind === "cam" ? (
            <button
              type="button"
              aria-label={t("phone.swap")}
              title={t("phone.swap")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => layout && setSplit({ ...layout, camTop: !layout.camTop })}
              className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-70 hover:bg-[var(--dk-accent)] hover:opacity-100"
            >
              <ArrowUpDown size={11} />
            </button>
          ) : null}
        </div>
      ))}
      {layout?.spot && (style === "circle" || style === "pip") ? (
        <SpotHandle
          layout={layout}
          circle={style === "circle"}
          onDrag={dragSpot}
          label={t("phone.camera")}
        />
      ) : null}
      {visibleImages.map((image) => (
        <div
          key={image.id}
          data-phone-image={image.id}
          role="button"
          aria-label={t("phone.moveLogo", { name: image.name })}
          className="absolute z-[3] cursor-move rounded-sm hover:outline hover:outline-1 hover:outline-[#ffd43b]"
          style={{
            left: `${(image.x - image.size / 2) * 100}%`,
            top: `${image.y * 100}%`,
            width: `${image.size * 100}%`,
            aspectRatio: "1",
            transform: "translateY(-50%)",
          }}
          onPointerDown={(e) => {
            const start = { x: image.x, y: image.y };
            dragOn(
              e,
              (_fx, _fy, dx, dy) =>
                updateImage(
                  image.id,
                  { x: clamp(start.x + dx, 0, 1), y: clamp(start.y + dy, 0, 1) },
                  true,
                ),
              undoable,
            );
          }}
        />
      ))}
      {visibleTexts.map((item) => {
        // Yazının kutusu kabaca: boyut kısa kenarın (genişliğin) oranı; genişlik harf sayısıyla.
        const lines = item.text.split("\n");
        const longest = Math.max(2, ...lines.map((l) => l.length));
        const width = Math.min(1, 0.55 * longest * item.size + 0.04);
        const height = item.size * (W / H) * 1.4 * lines.length;
        return (
          <div
            key={item.id}
            data-phone-text={item.id}
            role="button"
            aria-label={t("phone.moveText", { text: item.text })}
            className={`absolute z-[4] -translate-x-1/2 -translate-y-1/2 cursor-move rounded-sm ${
              item.id === selectedTextId
                ? "outline outline-1 outline-[#c084fc]"
                : "hover:outline hover:outline-1 hover:outline-[#ffd43b]"
            }`}
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
            }}
            onPointerDown={(e) => {
              useEditorStore.getState().selectText(item.id);
              const start = { x: item.x, y: item.y };
              dragOn(
                e,
                (_fx, _fy, dx, dy) => {
                  const s = useEditorStore.getState();
                  s.dragTexts(updateText(s.texts, item.id, { x: start.x + dx, y: start.y + dy }));
                },
                undoable,
              );
            }}
          />
        );
      })}
    </div>
  );
}

function SpotHandle({
  layout,
  circle,
  onDrag,
  label,
}: {
  layout: SplitLayout;
  circle: boolean;
  onDrag: (e: ReactPointerEvent, mode: "move" | "size") => void;
  label: string;
}) {
  const spot = layout.spot!;
  const w = spot.size;
  // Yükseklik telefonun yüksekliği oranında (daire: genişlikle aynı piksel).
  const h = (circle ? w : w * 0.75) * (W / H);
  const x = clamp(spot.x - w / 2, 0, 1 - w);
  const y = clamp(spot.y - h / 2, 0, 1 - h);
  return (
    <div
      data-phone-spot
      role="button"
      aria-label={label}
      title={label}
      className={`absolute z-[2] cursor-move border border-dashed border-[#ffd43b]/0 hover:border-[#ffd43b] ${circle ? "rounded-full" : "rounded-md"}`}
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
      onPointerDown={(e) => onDrag(e, "move")}
    >
      <span
        data-phone-spot-size
        className="absolute -right-1 -bottom-1 h-2.5 w-2.5 cursor-nwse-resize rounded-full border border-black bg-[#ffd43b]"
        onPointerDown={(e) => onDrag(e, "size")}
      />
    </div>
  );
}
