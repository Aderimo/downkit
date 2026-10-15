import type { TextItem } from "./textItems";

// Hazır altyazı stilleri: tek tıkla tüm otomatik altyazılara uygulanır.
// Konum, boyut, renk, yazı tipi, kontur, arka plan ve konuşulan kelimenin vurgusu.

export type CaptionCategory = "popular" | "highlight" | "glow" | "minimal" | "fun";

export const CAPTION_CATEGORIES: CaptionCategory[] = [
  "popular",
  "highlight",
  "glow",
  "minimal",
  "fun",
];

/** Stilin değiştirdiği alanlar (metin ve zaman dokunulmaz). */
export type CaptionLook = Pick<
  TextItem,
  | "x"
  | "y"
  | "size"
  | "color"
  | "box"
  | "bold"
  | "anim"
  | "font"
  | "stroke"
  | "strokeColor"
  | "shadow"
  | "glow"
  | "bg"
  | "bgOpacity"
  | "upper"
  | "italic"
  | "spacing"
  | "highlight"
>;

export interface CaptionPreset {
  id: string;
  category: CaptionCategory;
  /** Satır başına kelime (1 = kelime kelime). */
  words: number;
  look: CaptionLook;
}

const base: CaptionLook = {
  x: 0.5,
  y: 0.74,
  size: 0.07,
  color: "#ffffff",
  box: false,
  bold: true,
  anim: "none",
  font: "segoeBlack",
  stroke: 0.06,
  strokeColor: "#000000",
  shadow: 0.4,
  glow: undefined,
  bg: undefined,
  bgOpacity: undefined,
  upper: false,
  italic: false,
  spacing: undefined,
  highlight: undefined,
};

const p = (
  id: string,
  category: CaptionCategory,
  words: number,
  look: Partial<CaptionLook>,
): CaptionPreset => ({
  id,
  category,
  words,
  look: { ...base, ...look },
});

export const CAPTION_PRESETS: CaptionPreset[] = [
  // Popüler
  p("classic", "popular", 4, {}),
  p("yellowWord", "popular", 3, {
    font: "segoeBlack",
    upper: true,
    size: 0.08,
    stroke: 0.07,
    shadow: 0.8,
    highlight: { mode: "color", color: "#ffd43b" },
  }),
  p("bigCenter", "popular", 2, {
    font: "impact",
    upper: true,
    size: 0.11,
    y: 0.55,
    stroke: 0.09,
    anim: "pop",
    highlight: { mode: "scale", color: "#ffd43b" },
  }),
  p("boxed", "popular", 5, {
    font: "segoe",
    stroke: 0,
    shadow: 0,
    bg: "#000000",
    bgOpacity: 0.7,
    size: 0.055,
    y: 0.8,
  }),
  p("oneWord", "popular", 1, {
    font: "arialBlack",
    upper: true,
    size: 0.1,
    y: 0.62,
    stroke: 0.08,
    color: "#ffd43b",
    anim: "pop",
  }),
  p("podcast", "popular", 4, {
    font: "bahnschrift",
    size: 0.06,
    stroke: 0,
    shadow: 0,
    bg: "#0f172a",
    bgOpacity: 0.6,
    y: 0.8,
    highlight: { mode: "color", color: "#4ade80" },
  }),
  // Vurgulu
  p("greenHighlight", "highlight", 3, {
    font: "arialBlack",
    upper: true,
    size: 0.075,
    highlight: { mode: "color", color: "#4ade80" },
  }),
  p("blueBox", "highlight", 3, {
    font: "arialBlack",
    size: 0.07,
    stroke: 0.04,
    highlight: { mode: "box", color: "#3b82f6" },
  }),
  p("redBox", "highlight", 3, {
    font: "impact",
    upper: true,
    size: 0.08,
    stroke: 0.05,
    highlight: { mode: "box", color: "#ef4444" },
  }),
  p("orangePop", "highlight", 3, {
    font: "segoeBlack",
    upper: true,
    size: 0.08,
    highlight: { mode: "scale", color: "#fb923c" },
  }),
  p("pinkBounce", "highlight", 2, {
    font: "arialBlack",
    size: 0.08,
    highlight: { mode: "bounce", color: "#f472b6" },
  }),
  p("underline", "highlight", 4, {
    font: "segoe",
    size: 0.065,
    stroke: 0.03,
    shadow: 0.6,
    highlight: { mode: "underline", color: "#facc15" },
  }),
  // Parlak / neon
  p("neonPurple", "glow", 3, {
    font: "bahnschrift",
    stroke: 0.05,
    strokeColor: "#a855f7",
    glow: 0.8,
    shadow: 0,
    size: 0.08,
  }),
  p("neonBlue", "glow", 3, {
    font: "trebuchet",
    italic: true,
    upper: true,
    stroke: 0.05,
    strokeColor: "#0ea5e9",
    glow: 0.9,
    shadow: 0,
    size: 0.075,
    color: "#e0f2fe",
    highlight: { mode: "scale", color: "#67e8f9" },
  }),
  p("neonGreen", "glow", 3, {
    font: "consolas",
    stroke: 0.05,
    strokeColor: "#22c55e",
    glow: 0.7,
    shadow: 0,
    size: 0.075,
    color: "#dcfce7",
  }),
  p("fire", "glow", 3, {
    font: "impact",
    upper: true,
    stroke: 0.06,
    strokeColor: "#f97316",
    glow: 0.9,
    shadow: 0,
    size: 0.09,
    color: "#fff7ed",
    highlight: { mode: "color", color: "#fde047" },
  }),
  // Sade
  p("clean", "minimal", 6, { font: "segoe", stroke: 0, shadow: 0.7, size: 0.055, y: 0.82 }),
  p("thin", "minimal", 6, {
    font: "franklin",
    bold: false,
    upper: true,
    spacing: 0.08,
    stroke: 0.015,
    shadow: 0.4,
    size: 0.045,
    y: 0.84,
  }),
  p("strip", "minimal", 6, {
    font: "segoe",
    stroke: 0,
    shadow: 0,
    bg: "#111827",
    bgOpacity: 0.85,
    size: 0.05,
    y: 0.86,
  }),
  p("typewriter", "minimal", 5, {
    font: "consolas",
    stroke: 0,
    shadow: 0,
    bg: "#ffffff",
    bgOpacity: 0.92,
    color: "#111111",
    size: 0.05,
    y: 0.82,
  }),
  // Eğlenceli
  p("comic", "fun", 3, {
    font: "comic",
    upper: true,
    color: "#ffd43b",
    stroke: 0.07,
    shadow: 0.9,
    size: 0.075,
  }),
  p("meme", "fun", 5, {
    font: "impact",
    upper: true,
    stroke: 0.09,
    shadow: 0,
    size: 0.085,
    y: 0.14,
  }),
  p("handwritten", "fun", 4, {
    font: "inkFree",
    stroke: 0.03,
    shadow: 0.5,
    size: 0.08,
    color: "#fef3c7",
  }),
  p("elegant", "fun", 5, {
    font: "georgia",
    italic: true,
    stroke: 0,
    shadow: 0.8,
    size: 0.065,
    color: "#fde68a",
  }),
  p("purpleBox", "highlight", 3, {
    font: "segoeBlack",
    size: 0.075,
    stroke: 0.04,
    highlight: { mode: "box", color: "#8b5cf6" },
  }),
  p("redAlert", "highlight", 2, {
    font: "impact",
    upper: true,
    size: 0.1,
    y: 0.6,
    stroke: 0.08,
    anim: "bounce",
    highlight: { mode: "color", color: "#ef4444" },
  }),
  p("gamer", "glow", 2, {
    font: "consolas",
    upper: true,
    color: "#a3e635",
    stroke: 0.05,
    glow: 0.5,
    shadow: 0,
    size: 0.09,
    y: 0.62,
    anim: "pop",
    highlight: { mode: "scale", color: "#facc15" },
  }),
  p("whiteStrip", "minimal", 4, {
    font: "segoeBlack",
    stroke: 0,
    shadow: 0,
    bg: "#ffffff",
    bgOpacity: 1,
    color: "#111111",
    size: 0.055,
    y: 0.78,
  }),
  p("softPill", "minimal", 4, {
    font: "verdana",
    stroke: 0,
    shadow: 0,
    bg: "#1f2937",
    bgOpacity: 0.6,
    color: "#f9fafb",
    size: 0.048,
    y: 0.8,
    highlight: { mode: "color", color: "#93c5fd" },
  }),
  p("cinema", "minimal", 7, {
    font: "georgia",
    bold: false,
    stroke: 0,
    shadow: 0.9,
    size: 0.045,
    y: 0.88,
    spacing: 0.03,
  }),
  p("yellowStrip", "fun", 3, {
    font: "arialBlack",
    upper: true,
    stroke: 0,
    shadow: 0,
    bg: "#facc15",
    bgOpacity: 1,
    color: "#111111",
    size: 0.065,
    anim: "pop",
  }),
  p("retro", "fun", 3, {
    font: "trebuchet",
    upper: true,
    italic: true,
    color: "#f472b6",
    stroke: 0.07,
    strokeColor: "#1e1b4b",
    shadow: 1,
    size: 0.08,
  }),
];

export const presetById = (id: string) =>
  CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];

/** Stili yazıya uygular: metin, zaman ve kelimeler korunur; önceki zengin alanlar silinir. */
export function applyLook(item: TextItem, look: CaptionLook): TextItem {
  const next: TextItem = { ...item };
  for (const key of Object.keys(look) as (keyof CaptionLook)[]) {
    const value = look[key];
    if (value === undefined) delete (next as Partial<TextItem>)[key];
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  // Eski klasik stil alanı ASS'de konturu değiştirmesin.
  delete next.style;
  return next;
}
