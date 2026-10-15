// Çıkartmalar: ok, daire, kutu, işaretçi, yıldız, onay, çarpı, yapışkan not ve etiket.
// Tuvalde PNG olarak çizilir (telifsiz, uygulamanın kendisi üretir), önbelleğe yazılıp
// resim katmanına eklenir: önizleme ve dışa aktarma resim katmanının yolunu kullanır.

import { newClipId, useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { emojiImageWrite } from "./tauri-api";
import { useLayerMedia } from "./layerActions";
import type { ImageItem } from "./layers";
import { sequenceEnd } from "./sequence";

export const STICKER_KINDS = [
  "arrowRight",
  "arrowLeft",
  "arrowUp",
  "arrowDown",
  "circle",
  "box",
  "pointer",
  "star",
  "check",
  "cross",
  "note",
  "tag",
] as const;
export type StickerKind = (typeof STICKER_KINDS)[number];

/** Yazı alan çıkartmalar. */
export const TEXT_STICKERS: ReadonlySet<StickerKind> = new Set(["note", "tag"]);

export const STICKER_COLORS = ["#ffd400", "#ff3b5c", "#ffffff", "#3b82f6", "#22c55e"] as const;

export const STICKER_SECONDS = 3;
const SIZE = 512;

/** Çıkartmanın varsayılan genişliği (çıkış karesine oranı). */
const DEFAULT_WIDTH: Record<StickerKind, number> = {
  arrowRight: 0.22,
  arrowLeft: 0.22,
  arrowUp: 0.16,
  arrowDown: 0.16,
  circle: 0.3,
  box: 0.36,
  pointer: 0.14,
  star: 0.16,
  check: 0.14,
  cross: 0.14,
  note: 0.3,
  tag: 0.32,
};

function arrow(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 14;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(40, 200);
  ctx.lineTo(300, 200);
  ctx.lineTo(300, 110);
  ctx.lineTo(480, 256);
  ctx.lineTo(300, 402);
  ctx.lineTo(300, 312);
  ctx.lineTo(40, 312);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function shadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, start: number) {
  let px = start;
  ctx.font = `900 ${px}px "Bricolage Grotesque Variable", system-ui, sans-serif`;
  while (px > 28 && ctx.measureText(text).width > max) {
    px -= 4;
    ctx.font = `900 ${px}px "Bricolage Grotesque Variable", system-ui, sans-serif`;
  }
  return px;
}

/** Çıkartmayı tuvale çizer (yazılı olanlarda `text`). */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  kind: StickerKind,
  color: string,
  text: string,
) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  const turn = (deg: number) => {
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-SIZE / 2, -SIZE / 2);
  };
  switch (kind) {
    case "arrowRight":
      shadow(ctx);
      arrow(ctx, color);
      break;
    case "arrowLeft":
      shadow(ctx);
      turn(180);
      arrow(ctx, color);
      break;
    case "arrowUp":
      shadow(ctx);
      turn(-90);
      arrow(ctx, color);
      break;
    case "arrowDown":
      shadow(ctx);
      turn(90);
      arrow(ctx, color);
      break;
    case "circle":
      shadow(ctx);
      ctx.strokeStyle = color;
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.ellipse(256, 256, 220, 200, -0.08, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "box":
      shadow(ctx);
      ctx.strokeStyle = color;
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.roundRect(36, 96, 440, 320, 28);
      ctx.stroke();
      break;
    case "pointer":
      shadow(ctx);
      ctx.fillStyle = color;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 16;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(150, 40);
      ctx.lineTo(150, 420);
      ctx.lineTo(240, 340);
      ctx.lineTo(300, 470);
      ctx.lineTo(360, 440);
      ctx.lineTo(300, 315);
      ctx.lineTo(420, 305);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      break;
    case "star": {
      shadow(ctx);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 12;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 230 : 100;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = 256 + r * Math.cos(a);
        const y = 270 + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      break;
    }
    case "check":
    case "cross":
      shadow(ctx);
      ctx.fillStyle = kind === "check" ? "#22c55e" : "#ef4444";
      ctx.beginPath();
      ctx.arc(256, 256, 220, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 52;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (kind === "check") {
        ctx.moveTo(150, 266);
        ctx.lineTo(225, 340);
        ctx.lineTo(370, 180);
      } else {
        ctx.moveTo(170, 170);
        ctx.lineTo(342, 342);
        ctx.moveTo(342, 170);
        ctx.lineTo(170, 342);
      }
      ctx.stroke();
      break;
    case "note": {
      shadow(ctx);
      turn(-4);
      ctx.fillStyle = color;
      ctx.fillRect(56, 56, 400, 400);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(56, 56, 400, 46);
      ctx.fillStyle = color === "#ffffff" || color === "#ffd400" ? "#1f2937" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const words = (text || " ").split(/\s+/);
      const lines: string[] = [];
      for (const w of words) {
        const last = lines[lines.length - 1];
        if (last !== undefined && (last + " " + w).length <= 12)
          lines[lines.length - 1] = `${last} ${w}`;
        else lines.push(w);
      }
      const shown = lines.slice(0, 4);
      const px = Math.min(...shown.map((l) => fitText(ctx, l, 340, 76)));
      ctx.font = `900 ${px}px "Bricolage Grotesque Variable", system-ui, sans-serif`;
      shown.forEach((l, i) => ctx.fillText(l, 256, 280 + (i - (shown.length - 1) / 2) * px * 1.15));
      break;
    }
    case "tag": {
      shadow(ctx);
      turn(-6);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(24, 176, 464, 160, 80);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = color === "#ffffff" || color === "#ffd400" ? "#111827" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitText(ctx, (text || " ").toLocaleUpperCase(), 400, 96);
      ctx.fillText((text || " ").toLocaleUpperCase(), 256, 262);
      break;
    }
  }
  ctx.restore();
}

/** Çıkartmanın PNG veri adresi (tuval yoksa null). */
export function stickerDataUrl(kind: StickerKind, color: string, text = ""): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawSticker(ctx, kind, color, text);
  return canvas.toDataURL("image/png");
}

/** Önbellek dosya adı: içerikten (tür, renk, yazı) onaltılık özet; aynı çıkartma tek dosya. */
export function stickerFileName(kind: StickerKind, color: string, text: string): string {
  let h = 0x811c9dc5;
  for (const ch of `sticker:${kind}:${color}:${text}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `5c-${h.toString(16)}`;
}

/** İmleçte çıkartma ekler (3 sn, ortada). Önizleme hemen veri adresinden gösterir. */
export async function addSticker(
  kind: StickerKind,
  color: string,
  text = "",
): Promise<ImageItem | null> {
  const url = stickerDataUrl(kind, color, text);
  if (!url) return null;
  const path = await emojiImageWrite(
    stickerFileName(kind, color, text),
    url.slice(url.indexOf(",") + 1),
  );
  useLayerMedia.setState((s) => ({ urls: { ...s.urls, [path]: url } }));
  const editor = useEditorStore.getState();
  const start = usePlayerStore.getState().currentTime;
  const limit = Math.max(sequenceEnd(editor.clips), start + STICKER_SECONDS);
  const item: ImageItem = {
    id: newClipId(),
    path,
    name: text.trim() || kind,
    start,
    end: Math.min(limit, start + STICKER_SECONDS),
    x: 0.5,
    y: 0.45,
    size: DEFAULT_WIDTH[kind],
    opacity: 1,
    sticker: true,
  };
  editor.applyLayers({ images: [...editor.images, item] });
  return item;
}
