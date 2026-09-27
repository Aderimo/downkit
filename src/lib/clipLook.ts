// Klibin görünümü (Clipchamp'taki sağ araçlar): hazır filtre, renk ayarları ve
// efektler. Dışa aktarımda FFmpeg filtresine (Rust `ffmpeg::edit::Look`),
// önizlemede CSS filtresine çevrilir; ikisi birbirine yakın görünür.

export type FilterId = "none" | "bw" | "sepia" | "vivid" | "cool" | "warm" | "cinema" | "faded";

export interface ClipLook {
  filter: FilterId;
  /** −1…1, 0 = olduğu gibi. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** −1 soğuk (mavi) … 1 sıcak (turuncu). */
  temperature: number;
  /** 0…1 */
  blur: number;
  mirror: boolean;
  vignette: boolean;
}

export const DEFAULT_LOOK: ClipLook = {
  filter: "none",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  blur: 0,
  mirror: false,
  vignette: false,
};

export const FILTERS: FilterId[] = [
  "none",
  "bw",
  "sepia",
  "vivid",
  "cool",
  "warm",
  "cinema",
  "faded",
];

/** Hazır filtrelerin önizlemedeki karşılığı (FFmpeg karşılığıyla aynı yönde). */
const FILTER_CSS: Record<FilterId, string> = {
  none: "",
  bw: "grayscale(1)",
  sepia: "sepia(0.9)",
  vivid: "saturate(1.5) contrast(1.08)",
  cool: "saturate(1.05) hue-rotate(-12deg) brightness(1.02)",
  warm: "sepia(0.25) saturate(1.2)",
  cinema: "contrast(1.15) saturate(0.85)",
  faded: "contrast(0.85) brightness(1.08) saturate(0.8)",
};

export function filterCss(id: FilterId): string {
  return FILTER_CSS[id] ?? "";
}

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

/** Kayıtlı ya da eksik değerlerden geçerli görünüm. */
export function normalizeLook(raw: Partial<ClipLook> | undefined | null): ClipLook {
  const r = raw ?? {};
  return {
    filter: FILTERS.includes(r.filter as FilterId) ? (r.filter as FilterId) : "none",
    brightness: clamp(r.brightness ?? 0, -1, 1),
    contrast: clamp(r.contrast ?? 0, -1, 1),
    saturation: clamp(r.saturation ?? 0, -1, 1),
    temperature: clamp(r.temperature ?? 0, -1, 1),
    blur: clamp(r.blur ?? 0, 0, 1),
    mirror: r.mirror === true,
    vignette: r.vignette === true,
  };
}

export function isDefaultLook(look: Partial<ClipLook> | undefined | null): boolean {
  const l = normalizeLook(look);
  return (
    l.filter === "none" &&
    Math.abs(l.brightness) < 1e-3 &&
    Math.abs(l.contrast) < 1e-3 &&
    Math.abs(l.saturation) < 1e-3 &&
    Math.abs(l.temperature) < 1e-3 &&
    l.blur < 1e-3 &&
    !l.mirror &&
    !l.vignette
  );
}

/** Önizleme: CSS `filter` ve `transform` değerleri. */
export function lookCss(look: Partial<ClipLook> | undefined | null): {
  filter: string;
  transform: string;
  vignette: boolean;
} {
  const l = normalizeLook(look);
  const parts = [filterCss(l.filter)];
  if (Math.abs(l.brightness) > 1e-3) parts.push(`brightness(${1 + l.brightness * 0.5})`);
  if (Math.abs(l.contrast) > 1e-3) parts.push(`contrast(${1 + l.contrast * 0.6})`);
  if (Math.abs(l.saturation) > 1e-3) parts.push(`saturate(${1 + l.saturation})`);
  if (l.temperature > 1e-3) parts.push(`sepia(${l.temperature * 0.35})`);
  if (l.temperature < -1e-3) parts.push(`hue-rotate(${l.temperature * 15}deg)`);
  if (l.blur > 1e-3) parts.push(`blur(${(l.blur * 8).toFixed(1)}px)`);
  return {
    filter: parts.filter(Boolean).join(" "),
    transform: l.mirror ? "scaleX(-1)" : "",
    vignette: l.vignette,
  };
}
