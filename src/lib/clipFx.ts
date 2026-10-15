// Klip hareketleri ve geçiş stilleri. Formüller Rust `ffmpeg::fx` ile birebir
// aynıdır: önizlemede CSS ile görülen hareket dışa aktarımda FFmpeg ifadesi olarak
// aynen çıkar. Saf fonksiyonlar.

export type MotionId =
  "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight" | "kenBurns" | "shake" | "pulse";

export type TransitionStyle =
  "fade" | "zoom" | "blur" | "slide" | "spin" | "spinCcw" | "whip" | "glitch";

export const MOTIONS: MotionId[] = [
  "none",
  "zoomIn",
  "zoomOut",
  "panLeft",
  "panRight",
  "kenBurns",
  "shake",
  "pulse",
];

export const TRANSITION_STYLES: TransitionStyle[] = [
  "fade",
  "zoom",
  "blur",
  "slide",
  "spin",
  "spinCcw",
  "whip",
  "glitch",
];

export const DEFAULT_STRENGTH = 0.25;
export const STRENGTH_RANGE = { min: 0.05, max: 0.6 };

export function clampStrength(v: number | undefined): number {
  return v !== undefined && Number.isFinite(v) && v > 0
    ? Math.min(STRENGTH_RANGE.max, Math.max(STRENGTH_RANGE.min, v))
    : DEFAULT_STRENGTH;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (p: number) => p * p * (3 - 2 * p);

export interface FxInput {
  motion: MotionId;
  strength: number;
  /** Parçanın klibin içindeki başlangıcı ve klibin tam süresi (saniye). */
  offset: number;
  total: number;
  transition: TransitionStyle;
  /** Parçanın süresi ve geçiş süreleri. */
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

/** `t` anındaki (parçanın kendi saniyesi) görüntü dönüşümü. */
export interface FxFrame {
  zoom: number;
  /** Kırpma merkezi (0–1): CSS `transform-origin` ile aynı anlam. */
  cx: number;
  cy: number;
  /** Derece. */
  rotate: number;
  /** Genişliğin oranı olarak yatay kayma (+ sağa). */
  shiftX: number;
  /** 0–1 bulanıklık (önizlemede px'e çevrilir). */
  blur: number;
  glitch: boolean;
}

export const IDENTITY: FxFrame = {
  zoom: 1,
  cx: 0.5,
  cy: 0.5,
  rotate: 0,
  shiftX: 0,
  blur: 0,
  glitch: false,
};

export function fxFrame(fx: FxInput, t: number): FxFrame {
  const s = clampStrength(fx.strength);
  const total = fx.total > 0.01 ? fx.total : Math.max(fx.duration, 0.01);
  const time = Math.max(0, fx.offset) + t;
  const q = ease(clamp01(time / total));
  let zoom = 1;
  let cx = 0.5;
  let cy = 0.5;
  switch (fx.motion) {
    case "zoomIn":
      zoom = 1 + s * q;
      break;
    case "zoomOut":
      zoom = 1 + s * (1 - q);
      break;
    case "panLeft":
      zoom = 1 + s;
      cx = 1 - q;
      break;
    case "panRight":
      zoom = 1 + s;
      cx = q;
      break;
    case "kenBurns":
      zoom = 1 + s * q;
      cx = 0.3 + 0.4 * q;
      cy = 0.35 + 0.3 * q;
      break;
    case "shake":
      zoom = 1 + s * 0.5;
      cx = 0.5 + 0.45 * Math.sin(time * 31) * Math.cos(time * 7.3);
      cy = 0.5 + 0.45 * Math.cos(time * 27) * Math.sin(time * 5.1);
      break;
    case "pulse":
      zoom = 1 + s * 0.6 * Math.pow(Math.abs(Math.sin(Math.PI * 2 * time)), 4);
      break;
    case "none":
      break;
  }

  const frame: FxFrame = { ...IDENTITY, zoom, cx, cy };
  const hasIn = fx.fadeIn > 0;
  const hasOut = fx.fadeOut > 0;
  if (fx.transition !== "fade" && (hasIn || hasOut)) {
    const pIn = hasIn ? clamp01(t / fx.fadeIn) : 1;
    const outStart = Math.max(0, fx.duration - fx.fadeOut);
    const pOut = hasOut ? clamp01((t - outStart) / fx.fadeOut) : 0;
    const edge = Math.max(1 - ease(pIn), ease(pOut));
    const glitching = ((hasIn && t < fx.fadeIn) || (hasOut && t >= outStart)) && t % 0.12 < 0.06;
    switch (fx.transition) {
      case "zoom":
        frame.zoom *= 1 + 0.6 * edge;
        break;
      case "whip":
        frame.zoom *= 1 + 1.2 * edge;
        frame.blur = edge;
        break;
      case "spin":
      case "spinCcw":
        // Saat yönünde: girişte −180° → 0, çıkışta 0 → 180°; ters yönde işaret döner.
        frame.zoom *= 1 + 0.5 * edge;
        frame.rotate =
          (fx.transition === "spinCcw" ? -1 : 1) * (-(1 - ease(pIn)) + ease(pOut)) * 180;
        break;
      case "slide":
        frame.shiftX = 1 - ease(pIn) - ease(pOut);
        break;
      case "blur":
        frame.blur = edge;
        break;
      case "glitch":
        frame.zoom *= 1.06;
        if (glitching) {
          frame.cx += 0.45 * Math.sin(t * 90);
          frame.cy += 0.3 * Math.cos(t * 70);
          frame.glitch = true;
        }
        break;
    }
  }
  frame.cx = clamp01(frame.cx);
  frame.cy = clamp01(frame.cy);
  return frame;
}

/** Önizleme katmanının CSS'i. */
export function fxCss(frame: FxFrame): {
  transform: string;
  transformOrigin: string;
  filter: string;
} {
  const parts: string[] = [];
  if (Math.abs(frame.shiftX) > 1e-4) parts.push(`translateX(${(frame.shiftX * 100).toFixed(2)}%)`);
  if (Math.abs(frame.rotate) > 1e-3) parts.push(`rotate(${frame.rotate.toFixed(2)}deg)`);
  if (Math.abs(frame.zoom - 1) > 1e-4) parts.push(`scale(${frame.zoom.toFixed(4)})`);
  const filters: string[] = [];
  if (frame.blur > 0.01) filters.push(`blur(${(frame.blur * 14).toFixed(1)}px)`);
  if (frame.glitch) filters.push("drop-shadow(-6px 0 #ff0040) drop-shadow(6px 0 #00e5ff)");
  return {
    transform: parts.join(" "),
    transformOrigin: `${(frame.cx * 100).toFixed(2)}% ${(frame.cy * 100).toFixed(2)}%`,
    filter: filters.join(" "),
  };
}

/** Klipte hareket ya da (süresi olan) özel geçiş var mı. */
export function hasFx(fx: Pick<FxInput, "motion" | "transition" | "fadeIn" | "fadeOut">): boolean {
  return fx.motion !== "none" || (fx.transition !== "fade" && (fx.fadeIn > 0 || fx.fadeOut > 0));
}
