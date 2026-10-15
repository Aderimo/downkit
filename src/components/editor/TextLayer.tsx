import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FRAME_SIZES, useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { textsAt, updateText, type TextItem } from "../../lib/textItems";
import { TextMenu } from "./TextMenu";
import { ensureMediaUrl, useLayerMedia } from "../../lib/layerActions";
import { textAnimFrame, textStyleCss } from "../../lib/textFx";
import { activeWord, displayText, isRichText } from "../../lib/captionStyle";
import { highlightCss, richTextCss } from "../../lib/captionCss";
import { emojiBox } from "../../lib/captionEmoji";
import { emojiDataUrl } from "../../lib/emojiImage";
import { currentCropPosition } from "../../lib/faceActions";
import { sequenceEnd } from "../../lib/sequence";
import { isMotion } from "../../lib/motion";
import { MotionVideo } from "./MotionVideo";

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
  // Üste bindirilen resimler (logo, çıkartma) de aynı çıkış karesinde gösterilir.
  const images = useEditorStore((s) => s.images);
  const urls = useLayerMedia((s) => s.urls);
  const shownImages = images.filter((i) => currentTime >= i.start && currentTime < i.end);
  useEffect(() => {
    for (const i of images) ensureMediaUrl(i.path, "image");
  }, [images]);
  if (shown.length === 0 && shownImages.length === 0 && !options.progressBar) return null;

  // Çıkış karesinin videodaki yeri (kırpmada kalan bölge).
  let frameStyle: CSSProperties = { inset: 0 };
  let frameAspect = sourceAspect;
  if (options.frame !== "original" && !options.frameFit) {
    const [fw, fh] = FRAME_SIZES[options.frame];
    const target = fw / fh;
    const horizontal = sourceAspect > target;
    const share = horizontal ? target / sourceAspect : sourceAspect / target;
    frameAspect = target;
    const offset = `${(1 - share) * currentCropPosition(currentTime) * 100}%`;
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
          {shownImages.map((image) => {
            const url = urls[image.path];
            if (!url) return null;
            const style: CSSProperties = {
              left: `${image.x * 100}%`,
              top: `${image.y * 100}%`,
              width: `${image.size * 100}%`,
              transform: "translate(-50%, -50%)",
              opacity: image.opacity,
            };
            return isMotion(image) ? (
              <MotionVideo key={image.id} item={image} url={url} style={style} />
            ) : (
              <img
                key={image.id}
                src={url}
                alt=""
                className="pointer-events-none absolute"
                style={style}
              />
            );
          })}
          {options.progressBar ? (
            <ProgressPreview bar={options.progressBar} time={currentTime} />
          ) : null}
          {shown.map((item) =>
            item.emoji && item.text.trim() ? (
              <CaptionEmoji key={`e-${item.id}`} item={item} aspect={frameAspect} />
            ) : null,
          )}
          {shown.map((item) => (
            <TextBox key={item.id} item={item} selected={item.id === selectedTextId} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** İlerleme çubuğu: dışa aktarmadaki gibi zaman çizelgesi süresince soldan dolar. */
function ProgressPreview({
  bar,
  time,
}: {
  bar: { color: string; height: number; top: boolean };
  time: number;
}) {
  const end = useEditorStore((s) => sequenceEnd(s.clips));
  const share = end > 0 ? Math.min(1, Math.max(0, time / end)) : 0;
  return (
    <div
      data-progress-bar
      className="pointer-events-none absolute left-0"
      style={{
        [bar.top ? "top" : "bottom"]: 0,
        height: `${bar.height * 100}cqh`,
        width: `${share * 100}%`,
        background: bar.color,
      }}
    />
  );
}

/** Yazının emojisi: dışa aktarmadaki PNG ve konumla birebir. */
function CaptionEmoji({ item, aspect }: { item: TextItem; aspect: number }) {
  const url = item.emoji ? emojiDataUrl(item.emoji) : null;
  if (!url) return null;
  const box = emojiBox(item, { width: 1000 * aspect, height: 1000 });
  return (
    <img
      src={url}
      alt={item.emoji}
      data-caption-emoji={item.emoji}
      className="pointer-events-none absolute"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.size * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
    />
  );
}

function TextBox({ item, selected }: { item: TextItem; selected: boolean }) {
  // Animasyon dışa aktarımdaki formülle (lib/textFx); seçiliyken düzenlenebilsin diye tam görünür.
  const time = usePlayerStore((s) => s.currentTime);
  const anim = selected ? null : textAnimFrame(item.anim ?? "none", time, item.start, item.end);
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
        className={`pointer-events-auto absolute cursor-move text-center leading-tight ${
          // Zengin yazı dışa aktarımda (ASS) karenin %90'ında kaydırılır; düz yazı kaymaz.
          isRichText(item) ? "w-max max-w-[90%] whitespace-pre-wrap" : "whitespace-pre"
        } ${selected ? "outline-2 outline-offset-4 outline-[#c084fc] outline-dashed" : ""}`}
        style={{
          left: `${item.x * 100}%`,
          top: `${item.y * 100}%`,
          transform: anim
            ? `translate(calc(-50% + ${anim.dx * 100}cqw), calc(-50% + ${anim.dy * 100}cqh)) scale(${anim.scale})`
            : "translate(-50%, -50%)",
          opacity: anim ? anim.opacity : 1,
          // Kısa kenara göre (dışa aktarımdaki min(w,h) gibi): dikeyde de sığar.
          fontSize: `${item.size * 100}cqmin`,
          ...(isRichText(item)
            ? richTextCss(item)
            : {
                fontFamily: '"Segoe UI", system-ui, sans-serif',
                fontWeight: item.bold ? 700 : 400,
                ...textStyleCss(item.style ?? "classic", item.color, item.box),
              }),
        }}
      >
        {isRichText(item) ? <RichWords item={item} time={time} /> : item.text || " "}
      </div>
      {menu ? <TextMenu {...menu} textId={item.id} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

/** Kelimeler ayrı ayrı: konuşulan kelime vurgulu (kelime zamanı yoksa düz metin). */
function RichWords({ item, time }: { item: TextItem; time: number }) {
  const words = item.words;
  if (!words || words.length === 0 || (!item.highlight && !words.some((w) => w.emph)))
    return <>{displayText(item.text, item.upper) || " "}</>;
  const emphColor = item.highlight?.color ?? "#ffd43b";
  const active = activeWord(words, time);
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 ? " " : ""}
          <span
            data-word-active={i === active || undefined}
            style={
              i === active && item.highlight
                ? highlightCss(item.highlight.mode, item.highlight.color, time, w.start)
                : w.emph
                  ? { color: emphColor }
                  : undefined
            }
          >
            {displayText(w.text.trim(), item.upper)}
          </span>
        </span>
      ))}
    </>
  );
}
