import type { CSSProperties } from "react";
import { fontOf, type HighlightMode, type RichTextStyle } from "./captionStyle";

// Zengin yazının önizleme CSS'i (yazı katmanı ve stil galerisi aynı görünümü kullanır).
// Dışa aktarmadaki ASS çizimine (captionAss) olabildiğince yakın tutulur.

type Styled = RichTextStyle & { color: string; bold: boolean; box: boolean };

/** Zengin yazının önizleme görünümü (dışa aktarmadaki ASS ile aynı alanlardan). */
export function richTextCss(item: Styled): CSSProperties {
  const font = fontOf(item.font);
  const stroke = item.stroke ?? 0;
  const shadow = item.shadow ?? 0;
  const glow = item.glow ?? 0;
  const strokeColor = item.strokeColor ?? "#000000";
  const shadows = [
    shadow > 0 ? `${shadow * 0.08}em ${shadow * 0.08}em ${shadow * 0.04}em rgb(0 0 0 / 75%)` : "",
    glow > 0 ? `0 0 ${glow * 0.25}em ${strokeColor}, 0 0 ${glow * 0.5}em ${strokeColor}` : "",
  ].filter(Boolean);
  return {
    fontFamily: `"${font.family}", "Segoe UI", sans-serif`,
    fontWeight: item.bold || font.weight >= 700 ? Math.max(700, font.weight) : 400,
    fontStyle: item.italic ? "italic" : undefined,
    letterSpacing: item.spacing ? `${item.spacing}em` : undefined,
    color: item.color,
    // ASS konturu harfin iki yanına taşar; CSS konturu yarısı içeride: iki katı verilir.
    WebkitTextStroke: stroke > 0 ? `${stroke * 2}em ${strokeColor}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    ...(item.bg
      ? {
          background: hexAlpha(item.bg, item.bgOpacity ?? 0.85),
          padding: "0.12em 0.3em",
          borderRadius: "0.08em",
        }
      : item.box
        ? { background: "rgb(0 0 0 / 55%)", padding: "0.12em 0.3em" }
        : {}),
  };
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) || 0;
  return `rgb(${n(0)} ${n(2)} ${n(4)} / ${Math.round(alpha * 100)}%)`;
}

export function highlightCss(
  mode: HighlightMode,
  color: string,
  time: number,
  start: number,
): CSSProperties {
  switch (mode) {
    case "color":
      return { color };
    case "scale":
      return { color, display: "inline-block", transform: "scale(1.18)" };
    case "bounce": {
      const k = Math.min(1, Math.max(0, (time - start) / 0.22));
      const s = k < 0.4 ? 1 + 0.25 * (k / 0.4) : 1.25 - 0.25 * ((k - 0.4) / 0.6);
      return { color, display: "inline-block", transform: `scale(${s})` };
    }
    case "underline":
      return { color, textDecoration: "underline", textDecorationThickness: "0.08em" };
    case "box":
      return {
        background: color,
        borderRadius: "0.12em",
        padding: "0 0.12em",
        WebkitTextStroke: "0",
      };
  }
}
