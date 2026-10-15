// Klipler arası geçişler. Dışa
// aktarımda FFmpeg'in `xfade` filtresiyle yapılır (Rust `ffmpeg::xfade`); burada
// önizlemedeki CSS karşılıkları var. Yönler FFmpeg'in çıktısından ölçüldü: ör.
// `wipeleft`te yeni klip sağdan gelir. Saf fonksiyonlar.

export type XfadeKind =
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "fadegrays"
  | "dissolve"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "smoothleft"
  | "coverleft"
  | "revealright"
  | "circleopen"
  | "circleclose"
  | "horzopen"
  | "vertopen"
  | "diagtl"
  | "radial"
  | "radialccw"
  | "squeezeh"
  | "zoomin"
  | "pixelize"
  | "hblur"
  | "hrslice"
  | "hlwind"
  | "smoothright"
  | "smoothup"
  | "smoothdown"
  | "coverright"
  | "coverup"
  | "coverdown"
  | "revealleft"
  | "revealup"
  | "revealdown"
  | "horzclose"
  | "vertclose"
  | "squeezev"
  | "circlecrop"
  | "rectcrop"
  | "fadefast"
  | "fadeslow"
  | "lightleak"
  | "glitch";

/** Paneldeki sıra: önce temel geçişler, sonra diğerleri. */
export const XFADE_KINDS: XfadeKind[] = [
  "fade",
  "fadeblack",
  "fadewhite",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
  "circleopen",
  "dissolve",
  "zoomin",
  "pixelize",
  "hblur",
  "fadegrays",
  "radial",
  "radialccw",
  "circleclose",
  "smoothleft",
  "slideup",
  "slidedown",
  "wipeup",
  "wipedown",
  "coverleft",
  "revealright",
  "diagtl",
  "horzopen",
  "vertopen",
  "squeezeh",
  "hrslice",
  "hlwind",
  "smoothright",
  "smoothup",
  "smoothdown",
  "coverright",
  "coverup",
  "coverdown",
  "revealleft",
  "revealup",
  "revealdown",
  "horzclose",
  "vertclose",
  "squeezev",
  "circlecrop",
  "rectcrop",
  "fadefast",
  "fadeslow",
  "lightleak",
  "glitch",
];

export type XfadeCategory = "basic" | "wipe" | "slide" | "shape" | "stylized";
export const XFADE_CATEGORIES: XfadeCategory[] = ["basic", "wipe", "slide", "shape", "stylized"];

/** Geçiş tarayıcısındaki kategori. */
export function xfadeCategory(kind: XfadeKind): XfadeCategory {
  if (/^fade|^dissolve$/.test(kind)) return "basic";
  if (/^(wipe|smooth|diag|radial)/.test(kind)) return "wipe";
  if (/^(slide|cover|reveal|squeeze)/.test(kind)) return "slide";
  if (/^(circle|rect|horz|vert)/.test(kind)) return "shape";
  return "stylized";
}

export interface ClipXfade {
  kind: XfadeKind;
  /** Saniye; kesimin iki yanından yarı yarıya alınır (toplam süre değişmez). */
  duration: number;
}

/** Panelden zaman çizelgesine sürüklenen geçiş kartının veri türü. */
export const XFADE_MIME = "application/x-downkit-xfade";

export const XFADE_DEFAULT_SECONDS = 0.8;
export const XFADE_RANGE = { min: 0.2, max: 3 };
export const XFADE_PRESETS = [0.4, 0.8, 1.2, 2];

export function isXfadeKind(v: unknown): v is XfadeKind {
  return XFADE_KINDS.includes(v as XfadeKind);
}

/** Kayıttan/dosyadan gelen değeri doğrular. */
export function parseXfade(v: unknown): ClipXfade | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { kind, duration } = v as Record<string, unknown>;
  if (!isXfadeKind(kind) || typeof duration !== "number" || !Number.isFinite(duration)) {
    return undefined;
  }
  return { kind, duration: clampXfadeSeconds(duration) };
}

export function clampXfadeSeconds(v: number): number {
  return Math.min(XFADE_RANGE.max, Math.max(XFADE_RANGE.min, Math.round(v * 100) / 100));
}

/** Geçiş iki klipten kısa olanı aşamaz (dışa aktarımdaki sınırla aynı). */
export function effectiveSeconds(x: ClipXfade, lengthA: number, lengthB: number): number {
  return Math.max(0, Math.min(clampXfadeSeconds(x.duration), lengthA, lengthB));
}

/** Önizlemede bir katmanın (çıkan ya da giren klip) görünümü. */
export interface XfadeLayer {
  opacity?: number;
  clipPath?: string;
  transform?: string;
  filter?: string;
  mask?: string;
  /** Üstte mi (diğer klibi örter). */
  top: boolean;
}

export interface XfadeFrame {
  out: XfadeLayer;
  in: XfadeLayer;
  /** Siyah/beyaz geçişte iki klibin arasına giren renk. */
  veil?: { color: string; opacity: number };
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Köşeden köşeye silme: yeni klip sağ alttan gelir (`diagtl`). */
function diagonal(p: number): string {
  // Çizgi x + y = s (0–2): s'nin altı eski klipte kalır.
  const s = 2 * (1 - p);
  if (s >= 1) {
    const a = s - 1;
    return `polygon(100% ${pct(a)}, 100% 100%, ${pct(a)} 100%)`;
  }
  return `polygon(${pct(s)} 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${pct(s)})`;
}

/** `p` (0 = tamamen eski klip, 1 = tamamen yeni klip) anındaki görünüm. */
/** Piksel geçişinde blok boyutları (px): önizlemedeki SVG süzgeçleri bunlarla tanımlı
 * (`PixelFilters`). */
export const PIXEL_SIZES = [2, 3, 4, 6, 8, 12, 16, 24, 32];

/** En yakın tanımlı blok boyutu (1 = pikselleşme yok). */
export function pixelSize(size: number): number {
  if (size < 1.5) return 1;
  return PIXEL_SIZES.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best));
}

/**
 * `progress` anında geçişin önizlemesi. `pixel`: piksel geçişinde en büyük blok boyutu
 * (önizleme alanının genişliğine göre; büyük oynatıcıda büyük, küçük kartta küçük).
 */
export function xfadeFrame(kind: XfadeKind, progress: number, pixel = 24): XfadeFrame {
  const p = clamp01(progress);
  const rest = 1 - p;
  const still: XfadeLayer = { top: false };
  switch (kind) {
    case "fade":
    case "dissolve":
      return { out: still, in: { top: true, opacity: p } };
    case "fadegrays":
      return {
        out: { top: false, filter: `grayscale(${clamp01(p * 2)})` },
        in: { top: true, opacity: p, filter: `grayscale(${clamp01(rest * 2)})` },
      };
    case "fadeblack":
    case "fadewhite":
      return {
        out: still,
        in: { top: true, opacity: p < 0.5 ? 0 : 1 },
        veil: {
          color: kind === "fadeblack" ? "#000" : "#fff",
          opacity: p < 0.5 ? p * 2 : rest * 2,
        },
      };
    case "wipeleft":
    case "hlwind":
      return { out: still, in: { top: true, clipPath: `inset(0 0 0 ${pct(rest)})` } };
    case "wiperight":
    case "hrslice":
      return { out: still, in: { top: true, clipPath: `inset(0 ${pct(rest)} 0 0)` } };
    case "wipeup":
      return { out: still, in: { top: true, clipPath: `inset(${pct(rest)} 0 0 0)` } };
    case "wipedown":
      return { out: still, in: { top: true, clipPath: `inset(0 0 ${pct(rest)} 0)` } };
    case "smoothleft": {
      const edge = rest * 120 - 10;
      return {
        out: still,
        in: {
          top: true,
          mask: `linear-gradient(to right, transparent ${edge - 10}%, #000 ${edge + 10}%)`,
        },
      };
    }
    case "slideleft":
      return {
        out: { top: false, transform: `translateX(${pct(-p)})` },
        in: { top: true, transform: `translateX(${pct(rest)})` },
      };
    case "slideright":
      return {
        out: { top: false, transform: `translateX(${pct(p)})` },
        in: { top: true, transform: `translateX(${pct(-rest)})` },
      };
    case "slideup":
      return {
        out: { top: false, transform: `translateY(${pct(-p)})` },
        in: { top: true, transform: `translateY(${pct(rest)})` },
      };
    case "slidedown":
      return {
        out: { top: false, transform: `translateY(${pct(p)})` },
        in: { top: true, transform: `translateY(${pct(-rest)})` },
      };
    case "coverleft":
      return { out: still, in: { top: true, transform: `translateX(${pct(rest)})` } };
    case "revealright":
      return { out: { top: true, transform: `translateX(${pct(p)})` }, in: still };
    case "circleopen":
      return { out: still, in: { top: true, clipPath: `circle(${pct(p * 0.72)} at 50% 50%)` } };
    case "circleclose":
      return {
        out: { top: true, clipPath: `circle(${pct(rest * 0.72)} at 50% 50%)` },
        in: still,
      };
    case "horzopen":
      return { out: still, in: { top: true, clipPath: `inset(${pct(rest / 2)} 0)` } };
    case "vertopen":
      return { out: still, in: { top: true, clipPath: `inset(0 ${pct(rest / 2)})` } };
    case "diagtl":
      return { out: still, in: { top: true, clipPath: diagonal(p) } };
    case "radial": {
      // Tepeden saat yönünde açılır (FFmpeg "radial" ile aynı yön).
      const deg = Math.round(p * 3600) / 10;
      return {
        out: still,
        in: { top: true, mask: `conic-gradient(#000 ${deg}deg, transparent ${deg}deg)` },
      };
    }
    case "radialccw": {
      // Tepeden saat yönünün tersine açılır.
      const deg = Math.round((1 - p) * 3600) / 10;
      return {
        out: still,
        in: { top: true, mask: `conic-gradient(transparent ${deg}deg, #000 ${deg}deg)` },
      };
    }
    case "squeezeh":
      return { out: { top: true, transform: `scaleY(${rest})` }, in: still };
    case "zoomin":
      return {
        out: { top: false, transform: `scale(${1 + p})` },
        in: { top: true, opacity: clamp01((p - 0.5) * 2) },
      };
    case "pixelize": {
      // Bloklar ortaya doğru büyür, ortada görüntü değişir, sonra küçülür (FFmpeg gibi).
      const size = pixelSize((1 - Math.abs(2 * p - 1)) * pixel);
      const filter = size > 1 ? `url(#dk-px-${size})` : undefined;
      return {
        out: { top: false, filter },
        in: { top: true, opacity: p < 0.5 ? 0 : 1, filter },
      };
    }
    case "smoothright": {
      const edge = p * 120 - 10;
      return {
        out: still,
        in: {
          top: true,
          mask: `linear-gradient(to right, #000 ${edge - 10}%, transparent ${edge + 10}%)`,
        },
      };
    }
    case "smoothup": {
      const edge = rest * 120 - 10;
      return {
        out: still,
        in: {
          top: true,
          mask: `linear-gradient(to bottom, transparent ${edge - 10}%, #000 ${edge + 10}%)`,
        },
      };
    }
    case "smoothdown": {
      const edge = p * 120 - 10;
      return {
        out: still,
        in: {
          top: true,
          mask: `linear-gradient(to bottom, #000 ${edge - 10}%, transparent ${edge + 10}%)`,
        },
      };
    }
    case "coverright":
      return { out: still, in: { top: true, transform: `translateX(${pct(-rest)})` } };
    case "coverup":
      return { out: still, in: { top: true, transform: `translateY(${pct(rest)})` } };
    case "coverdown":
      return { out: still, in: { top: true, transform: `translateY(${pct(-rest)})` } };
    case "revealleft":
      return { out: { top: true, transform: `translateX(${pct(-p)})` }, in: still };
    case "revealup":
      return { out: { top: true, transform: `translateY(${pct(-p)})` }, in: still };
    case "revealdown":
      return { out: { top: true, transform: `translateY(${pct(p)})` }, in: still };
    case "horzclose":
      return { out: { top: true, clipPath: `inset(${pct(p / 2)} 0)` }, in: still };
    case "vertclose":
      return { out: { top: true, clipPath: `inset(0 ${pct(p / 2)})` }, in: still };
    case "squeezev":
      return { out: { top: true, transform: `scaleX(${rest})` }, in: still };
    case "circlecrop":
      // Eski klip daireyle siyaha kapanır, yeni klip daireyle açılır.
      return p < 0.5
        ? {
            out: { top: true, clipPath: `circle(${pct((1 - 2 * p) * 0.72)} at 50% 50%)` },
            in: { top: false, opacity: 0 },
          }
        : {
            out: { top: false, opacity: 0 },
            in: { top: true, clipPath: `circle(${pct((2 * p - 1) * 0.72)} at 50% 50%)` },
          };
    case "rectcrop":
      return p < 0.5
        ? {
            out: { top: true, clipPath: `inset(${pct(p)})` },
            in: { top: false, opacity: 0 },
          }
        : {
            out: { top: false, opacity: 0 },
            in: { top: true, clipPath: `inset(${pct(rest)})` },
          };
    case "fadefast":
      return { out: still, in: { top: true, opacity: Math.sqrt(p) } };
    case "fadeslow":
      return { out: still, in: { top: true, opacity: p * p } };
    case "lightleak":
      return {
        out: still,
        in: { top: true, opacity: p },
        veil: { color: "#ffa04a", opacity: Math.sin(Math.PI * p) * 0.6 },
      };
    case "glitch": {
      // Ortada değişir; bu sırada görüntü yana titrer ve rengi kayar.
      const strength = Math.sin(Math.PI * p);
      const dx = Math.round(Math.sin(p * 60) * 6 * strength * 10) / 10;
      const filter = strength > 0.2 ? `hue-rotate(${Math.round(90 * strength)}deg)` : undefined;
      return {
        out: { top: false, transform: `translateX(${dx}%)`, filter },
        in: { top: true, opacity: p < 0.5 ? 0 : 1, transform: `translateX(${-dx}%)`, filter },
      };
    }
    case "hblur": {
      const blur = (1 - Math.abs(2 * p - 1)) * 14;
      return {
        out: { top: false, filter: `blur(${blur.toFixed(1)}px)` },
        in: { top: true, opacity: p, filter: `blur(${blur.toFixed(1)}px)` },
      };
    }
  }
}
