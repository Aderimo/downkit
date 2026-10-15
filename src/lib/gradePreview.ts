import { create } from "zustand";
import { cubeGrayAxis } from "./colorGrade";
import { textFileRead } from "./tauri-api";

// Renk düzeltmenin önizleme yardımcıları: LUT dosyalarının gri eksen tablosu (bir kez
// okunur) ve önizleme videosundan küçük kare örneği (kapsamlar, damlalık, otomatik
// düzeltme; video `crossOrigin` ile açıldığı için tuvale çizilebilir).

type Axis = [number, number, number][];

export const useLutCache = create<{ axes: Record<string, Axis | null> }>(() => ({ axes: {} }));
const loading = new Set<string>();

/** LUT'un önizleme tablosu: yüklenmediyse yüklemeye başlar ve şimdilik undefined döner. */
export function lutAxis(path: string | undefined): Axis | null | undefined {
  if (!path) return undefined;
  const known = useLutCache.getState().axes[path];
  if (known !== undefined || loading.has(path)) return known;
  loading.add(path);
  textFileRead(path)
    .then((text) => cubeGrayAxis(text))
    .catch(() => null)
    .then((axis) => {
      loading.delete(path);
      useLutCache.setState((s) => ({ axes: { ...s.axes, [path]: axis } }));
    });
  return undefined;
}

/** Önizleme videosunun o anki karesi (en çok `width` piksel genişlik); okunamazsa null. */
export function sampleViewerFrame(width = 192): ImageData | null {
  const video = document.querySelector<HTMLVideoElement>("[data-main-viewer] video");
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const scale = Math.min(1, width / video.videoWidth);
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    // Kaynak çapraz kökenli ve izinsizse tuval okunamaz.
    return null;
  }
}

/** Örnek karenin `x`,`y` (0–1) noktasındaki rengi (3×3 ortalama). */
export function pixelAt(frame: ImageData, x: number, y: number): [number, number, number] {
  const cx = Math.min(frame.width - 1, Math.max(0, Math.round(x * (frame.width - 1))));
  const cy = Math.min(frame.height - 1, Math.max(0, Math.round(y * (frame.height - 1))));
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
      const i = (py * frame.width + px) * 4;
      sum[0] += frame.data[i]!;
      sum[1] += frame.data[i + 1]!;
      sum[2] += frame.data[i + 2]!;
      n++;
    }
  }
  return sum.map((v) => v / n) as [number, number, number];
}

/** Tabloları örnek kareye uygular (kapsamlar düzeltilmiş görüntüyü göstersin). */
export function applyTables(
  frame: ImageData,
  tables: readonly [Float32Array, Float32Array, Float32Array],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.data.length);
  for (let i = 0; i < frame.data.length; i += 4) {
    out[i] = tables[0][frame.data[i]!]! * 255;
    out[i + 1] = tables[1][frame.data[i + 1]!]! * 255;
    out[i + 2] = tables[2][frame.data[i + 2]!]! * 255;
    out[i + 3] = 255;
  }
  return out;
}
