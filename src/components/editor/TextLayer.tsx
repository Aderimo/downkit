import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { FRAME_SIZES, useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { textsAt, updateText, type TextItem } from "../../lib/textItems";
import { TextMenu } from "./TextMenu";

/** Önizlemedeki yazılar. Konum ve boyut, dışa aktarımdaki gibi çıkış karesine
 * göre (dikey çerçeve seçiliyse kırpılan bölgeye göre) hesaplanır; seçili yazı
 * sürüklenerek yerleştirilir. */
export function TextLayer({ sourceAspect }: { sourceAspect: number }) {
  const texts = useEditorStore((s) => s.texts);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const options = useEditorStore((s) => s.exportOptions);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const visible = textsAt(texts, currentTime);
  const selected = texts.find((t) => t.id === selectedTextId);
  // Seçili yazı imleç dışında olsa da düzenlenirken görünsün.
  const shown = selected && !visible.includes(selected) ? [...visible, selected] : visible;
  if (shown.length === 0) return null;

  // Çıkış karesinin videodaki yeri (kırpmada kalan bölge).
  let frameStyle: CSSProperties = { inset: 0 };
  if (options.frame !== "original" && !options.frameFit) {
    const [fw, fh] = FRAME_SIZES[options.frame];
    const target = fw / fh;
    const horizontal = sourceAspect > target;
    const share = horizontal ? target / sourceAspect : sourceAspect / target;
    const offset = `${(1 - share) * options.framePosition * 100}%`;
    frameStyle = horizontal
      ? { top: 0, bottom: 0, left: offset, width: `${share * 100}%` }
      : { left: 0, right: 0, top: offset, height: `${share * 100}%` };
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ containerType: "size" }}
    >
      <div
        className="relative"
        style={{
          width: `min(100cqw, calc(100cqh * ${sourceAspect}))`,
          aspectRatio: String(sourceAspect),
        }}
      >
        <div className="absolute" style={{ ...frameStyle, containerType: "size" }}>
          {shown.map((item) => (
            <TextBox key={item.id} item={item} selected={item.id === selectedTextId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TextBox({ item, selected }: { item: TextItem; selected: boolean }) {
  // Sağ tık menüsü: zaman çizelgesindeki yazı bloğununkiyle aynı (düzenle, çoğalt, sil).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent) {
    e.stopPropagation();
    // Sağ tık yalnızca seçer ve menüyü açar; sürükleme başlatmaz.
    if (e.button !== 0) {
      useEditorStore.getState().selectText(item.id);
      return;
    }
    const store = useEditorStore.getState();
    store.selectText(item.id);
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y };
    let began = false;
    const move = (ev: PointerEvent) => {
      if (!began) {
        useEditorStore.getState().beginDrag();
        began = true;
      }
      const s = useEditorStore.getState();
      s.dragTexts(
        updateText(s.texts, item.id, {
          x: start.ix + (ev.clientX - start.x) / box.width,
          y: start.iy + (ev.clientY - start.y) / box.height,
        }),
      );
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (began) useEditorStore.getState().endDrag();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`pointer-events-auto absolute cursor-move leading-tight whitespace-pre ${
          selected ? "outline-2 outline-offset-4 outline-[#c084fc] outline-dashed" : ""
        }`}
        style={{
          left: `${item.x * 100}%`,
          top: `${item.y * 100}%`,
          transform: "translate(-50%, -50%)",
          // Kısa kenara göre (dışa aktarımdaki min(w,h) gibi): dikeyde de sığar.
          fontSize: `${item.size * 100}cqmin`,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontWeight: item.bold ? 700 : 400,
          color: item.color,
          background: item.box ? "rgb(0 0 0 / 55%)" : "transparent",
          padding: item.box ? "1.2cqmin" : 0,
          textShadow: item.box ? "none" : "2px 2px 2px rgb(0 0 0 / 75%)",
        }}
      >
        {item.text || " "}
      </div>
      {menu ? <TextMenu {...menu} textId={item.id} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
