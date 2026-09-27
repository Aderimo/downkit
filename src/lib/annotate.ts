// Ekran görüntüsü üstüne çizim: şekiller görüntünün piksel koordinatlarında
// tutulur; aynı çizim işlevleri hem ekrandaki tuvali hem tam çözünürlüklü dışa
// aktarımı çizer (ekranda ne görünüyorsa dosyada o çıkar).

export type Tool = "arrow" | "rect" | "ellipse" | "pen" | "highlight" | "text" | "step" | "blur";

export type Shape =
  | {
      kind: "arrow" | "rect" | "ellipse" | "blur";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | { kind: "pen" | "highlight"; points: number[]; color: string; width: number }
  | { kind: "text"; x: number; y: number; text: string; color: string; size: number }
  | { kind: "step"; x: number; y: number; n: number; color: string; size: number };

export const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#111827"];

/** Kalınlık seçimi (1–3) görüntü boyuna göre ölçeklenir: 4K ekranda da ince görünmesin. */
export function strokeWidth(level: number, imageWidth: number, imageHeight: number): number {
  const base = Math.max(2, Math.round(Math.max(imageWidth, imageHeight) / 400));
  return base * [1, 1.8, 3][Math.min(2, Math.max(0, level - 1))];
}

/** Ok ucu: çizginin sonundaki iki kanat noktası. */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): [number, number, number, number] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    x2 - size * Math.cos(angle - spread),
    y2 - size * Math.sin(angle - spread),
    x2 - size * Math.cos(angle + spread),
    y2 - size * Math.sin(angle + spread),
  ];
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Sıradaki numaralı adım (silinen olursa en büyüğün bir fazlası). */
export function nextStep(shapes: readonly Shape[]): number {
  return shapes.reduce((n, s) => (s.kind === "step" ? Math.max(n, s.n) : n), 0) + 1;
}

/** Metni verilen genişliğe sığacak satırlara böler (sözcük sınırından). */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const FONT = '"Segoe UI", system-ui, sans-serif';

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, image: CanvasImageSource) {
  ctx.save();
  switch (shape.kind) {
    case "blur": {
      const r = normalizeRect(shape.x1, shape.y1, shape.x2, shape.y2);
      if (r.w < 2 || r.h < 2) break;
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      // Bulanıklık seçimin boyuna göre: küçük alanda da okunmaz olsun.
      ctx.filter = `blur(${Math.max(6, Math.min(r.w, r.h) / 12)}px)`;
      ctx.drawImage(image, 0, 0);
      break;
    }
    case "rect":
    case "ellipse": {
      const r = normalizeRect(shape.x1, shape.y1, shape.x2, shape.y2);
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      if (shape.kind === "rect") ctx.rect(r.x, r.y, r.w, r.h);
      else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "arrow": {
      const head = Math.max(shape.width * 4, 14);
      const [ax, ay, bx, by] = arrowHead(shape.x1, shape.y1, shape.x2, shape.y2, head);
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = shape.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      // Çizgi ucun ortasında biter: kalın okta uç sivri kalsın.
      ctx.lineTo((ax + bx) / 2, (ay + by) / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(shape.x2, shape.y2);
      ctx.lineTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "pen":
    case "highlight": {
      if (shape.points.length < 4) break;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.kind === "highlight" ? shape.width * 4 : shape.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (shape.kind === "highlight") ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(shape.points[0], shape.points[1]);
      for (let i = 2; i < shape.points.length; i += 2) {
        ctx.lineTo(shape.points[i], shape.points[i + 1]);
      }
      ctx.stroke();
      break;
    }
    case "text": {
      ctx.font = `600 ${shape.size}px ${FONT}`;
      ctx.textBaseline = "top";
      // Her zeminde okunsun diye koyu kontur.
      ctx.lineWidth = Math.max(2, shape.size / 7);
      ctx.strokeStyle = shape.color === "#111827" ? "rgb(255 255 255 / 80%)" : "rgb(0 0 0 / 65%)";
      ctx.lineJoin = "round";
      shape.text.split("\n").forEach((line, i) => {
        const y = shape.y + i * shape.size * 1.25;
        ctx.strokeText(line, shape.x, y);
        ctx.fillStyle = shape.color;
        ctx.fillText(line, shape.x, y);
      });
      break;
    }
    case "step": {
      ctx.fillStyle = shape.color;
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, shape.size / 8);
      ctx.strokeStyle = "white";
      ctx.stroke();
      ctx.fillStyle = shape.color === "#ffffff" ? "#111827" : "white";
      ctx.font = `700 ${shape.size * 1.1}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(shape.n), shape.x, shape.y + shape.size * 0.05);
      break;
    }
  }
  ctx.restore();
}

/** Görsel çeviri kutusu: özgün yazının üstüne koyu zemin ve çevirisi. */
export interface TranslatedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  lineHeight: number;
  text: string;
}

function drawTranslation(ctx: CanvasRenderingContext2D, box: TranslatedBox) {
  ctx.save();
  // Yazı boyu özgün satır boyundan başlar, kutuya sığana kadar küçülür.
  let size = Math.max(10, box.lineHeight * 0.85);
  let lines: string[] = [];
  const width = Math.max(box.width, 40);
  for (; size >= 10; size -= 1) {
    ctx.font = `600 ${size}px ${FONT}`;
    lines = wrapLines(box.text, width, (s) => ctx.measureText(s).width);
    if (lines.length * size * 1.2 <= box.height * 1.25) break;
  }
  const height = Math.max(box.height, lines.length * size * 1.2);
  const pad = Math.max(3, size * 0.25);
  ctx.fillStyle = "rgb(17 21 31 / 88%)";
  ctx.beginPath();
  ctx.roundRect(box.x - pad, box.y - pad, width + pad * 2, height + pad * 2, pad);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, box.x, box.y + i * size * 1.2));
  ctx.restore();
}

/** Görüntüyü, şekilleri ve (istenirse) görsel çeviriyi görüntü koordinatlarında çizer. */
export function render(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  shapes: readonly Shape[],
  translations: readonly TranslatedBox[] = [],
) {
  ctx.drawImage(image, 0, 0);
  for (const box of translations) drawTranslation(ctx, box);
  for (const shape of shapes) drawShape(ctx, shape, image);
}
