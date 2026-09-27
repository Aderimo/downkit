// Görüntüyü tuvalden dosya baytlarına çevirme (PNG / JPEG / WebP). Kodlamayı
// WebView yapar: Rust tarafına ek kodlayıcı gerekmez.

import type { ShotFormat } from "./snipSettings";

export const MIME: Record<ShotFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** Yerel önizleme sunucusundaki görüntüyü yükler. `crossOrigin` şart: yoksa
 * tuval "kirlenir" ve dışa aktarılamaz (sunucu CORS başlığı gönderir). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load"));
    img.src = url;
  });
}

/** Tuvali istenen biçimde kodlar. `quality`: 0–100 (PNG'de yok sayılır). */
export function canvasBytes(
  canvas: HTMLCanvasElement,
  format: ShotFormat,
  quality: number,
): Promise<Uint8Array> {
  let source = canvas;
  if (format === "jpg") {
    // JPEG'de saydamlık yok: saydam alan siyah değil beyaz çıksın.
    source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const ctx = source.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, source.width, source.height);
      ctx.drawImage(canvas, 0, 0);
    }
  }
  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("encode"));
          return;
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      MIME[format],
      format === "png" ? undefined : Math.min(1, Math.max(0.1, quality / 100)),
    );
  });
}

/** Görüntüyü olduğu gibi (düzenlemeden) başka biçime çevirir. */
export async function encodeImage(
  url: string,
  format: ShotFormat,
  quality: number,
): Promise<Uint8Array> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")?.drawImage(img, 0, 0);
  return canvasBytes(canvas, format, quality);
}
