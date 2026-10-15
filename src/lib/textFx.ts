// Yazı stilleri ve animasyonları. Animasyon formülleri Rust `text_anim_exprs` ile
// aynıdır: önizlemede görülen dışa aktarımda da aynı çıkar.

import type { CSSProperties } from "react";

export type TextStyleId = "classic" | "outline" | "neon" | "highlight" | "comic";
export type TextAnimId = "none" | "fade" | "slideUp" | "pop" | "bounce" | "shake";

export const TEXT_STYLES: TextStyleId[] = ["classic", "outline", "neon", "highlight", "comic"];
export const TEXT_ANIMS: TextAnimId[] = ["none", "fade", "slideUp", "pop", "bounce", "shake"];

export const isTextStyle = (v: unknown): v is TextStyleId => TEXT_STYLES.includes(v as TextStyleId);
export const isTextAnim = (v: unknown): v is TextAnimId => TEXT_ANIMS.includes(v as TextAnimId);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (p: number) => p * p * (3 - 2 * p);

export interface TextAnimFrame {
  opacity: number;
  scale: number;
  /** Karenin oranı olarak kayma. */
  dx: number;
  dy: number;
}

/** `t` anında (zaman çizelgesi saniyesi) yazının animasyon durumu. */
export function textAnimFrame(
  anim: TextAnimId,
  t: number,
  start: number,
  end: number,
): TextAnimFrame {
  const k = clamp01((t - start) / 0.35);
  const o = clamp01((end - t) / 0.3);
  switch (anim) {
    case "fade":
      return { opacity: Math.min(k, o), scale: 1, dx: 0, dy: 0 };
    case "slideUp":
      return { opacity: Math.min(k, o), scale: 1, dx: 0, dy: (1 - ease(k)) * 0.06 };
    case "pop": {
      const x = k - 1;
      return {
        opacity: Math.min(Math.min(k * 3, 1), o),
        scale: 0.3 + 0.7 * (1 + 2.70158 * x * x * x + 1.70158 * x * x),
        dx: 0,
        dy: 0,
      };
    }
    case "bounce":
      return {
        opacity: Math.min(Math.min(k * 2, 1), o),
        scale: 1,
        dx: 0,
        dy: -Math.abs(Math.sin(Math.PI * 2 * k)) * (1 - k) * 0.08,
      };
    case "shake":
      return {
        opacity: Math.min(Math.min(k * 4, 1), o),
        scale: 1,
        dx: Math.sin(t * 40) * 0.004,
        dy: Math.cos(t * 33) * 0.004,
      };
    case "none":
      return { opacity: 1, scale: 1, dx: 0, dy: 0 };
  }
}

function luma(color: string): number {
  const hex = color.replace("#", "");
  const ch = (i: number) => parseInt(hex.slice(i, i + 2), 16) || 255;
  return 0.299 * ch(0) + 0.587 * ch(2) + 0.114 * ch(4);
}

/** Önizlemedeki görünüm (FFmpeg drawtext'e yakın). `box`: klasik stilde kutu. */
export function textStyleCss(style: TextStyleId, color: string, box: boolean): CSSProperties {
  switch (style) {
    case "outline":
      return { color, WebkitTextStroke: "0.06em #000", paintOrder: "stroke fill" };
    case "neon":
      return { color: "#fff", WebkitTextStroke: `0.08em ${color}`, paintOrder: "stroke fill" };
    case "highlight":
      return {
        color: luma(color) > 150 ? "#111" : "#fff",
        background: color,
        padding: "0.15em 0.25em",
      };
    case "comic":
      return {
        color,
        WebkitTextStroke: "0.05em #000",
        paintOrder: "stroke fill",
        textShadow: "0.06em 0.06em 0 #000",
      };
    case "classic":
      return box
        ? { color, background: "rgb(0 0 0 / 55%)", padding: "1.2cqmin" }
        : { color, textShadow: "2px 2px 2px rgb(0 0 0 / 75%)" };
  }
}
