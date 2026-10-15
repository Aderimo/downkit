// Görünüm efektleri: glitch, RGB ayrışma, flaş, film greni, ışık sızması, VHS,
// keskinleştirme. Her biri 0–1 şiddet (0 = kapalı). Dışa aktarmada FFmpeg filtresine
// (Rust `ffmpeg::edit::LookFx`), önizlemede CSS katmanlarına çevrilir; zamanla değişen
// efektler (glitch, flaş, ışık sızması) iki tarafta aynı formülü kullanır. Saf fonksiyonlar.

export const LOOK_FX_IDS = [
  "glitch",
  "rgbSplit",
  "strobe",
  "grain",
  "lightLeak",
  "vhs",
  "sharpen",
] as const;
export type LookFxId = (typeof LOOK_FX_IDS)[number];
export type LookFx = Partial<Record<LookFxId, number>>;

export type FxCategory = "glitch" | "light" | "texture" | "detail";

export const FX_CATEGORY: Record<LookFxId, FxCategory> = {
  glitch: "glitch",
  rgbSplit: "glitch",
  vhs: "glitch",
  strobe: "light",
  lightLeak: "light",
  grain: "texture",
  sharpen: "detail",
};

export const FX_CATEGORIES: FxCategory[] = ["glitch", "light", "texture", "detail"];

/** Eklenince başlangıç şiddeti. */
export const DEFAULT_FX_AMOUNT = 0.6;

const clamp01 = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/** Geçerli efektler (bilinmeyen ve 0 olanlar atılır); hiçbiri yoksa undefined. */
export function normalizeFx(raw: unknown): LookFx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: LookFx = {};
  for (const id of LOOK_FX_IDS) {
    const v = clamp01((raw as Record<string, unknown>)[id]);
    if (v > 1e-3) out[id] = Math.round(v * 100) / 100;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** İki efekt kümesi: her efektin büyüğü (efekt şeridi klibin üstüne katılırken). */
export function mergeFx(a: LookFx | undefined, b: LookFx | undefined): LookFx | undefined {
  if (!a) return normalizeFx(b);
  if (!b) return normalizeFx(a);
  const out: LookFx = {};
  for (const id of LOOK_FX_IDS) out[id] = Math.max(a[id] ?? 0, b[id] ?? 0);
  return normalizeFx(out);
}

// ——— Zamanla değişen efektlerin ortak formülleri (Rust ile aynı) ———

/** Glitch anı mı: saniyede 7 kez, sürenin %15'inde bozulma. */
export const glitchOn = (t: number) => (t * 7) % 1 < 0.15;
/** Glitch'te yatay kayma (piksel, kaynağın genişliğine oranlanmaz). */
export const glitchShift = (amount: number, t: number) =>
  glitchOn(t) ? Math.round(8 * amount * Math.sin(t * 80)) : 0;
/** Flaş: saniyede 6 kez, sürenin %20'sinde parlama (eq parlaklık birimi). */
export const strobeLevel = (amount: number, t: number) => ((t * 6) % 1 < 0.2 ? 0.5 * amount : 0);
/** Işık sızması nabzı (0–1): yavaş dalgalanan sıcak parıltı. */
export const leakPulse = (t: number) => (1 + Math.sin(t * 1.3)) / 2;

/** Önizleme: CSS filtre ve dönüşüm parçaları, üstüne çizilecek katmanlar. */
export interface FxPreview {
  filter: string;
  transform: string;
  grain: number;
  scanlines: number;
  /** Işık sızması katmanının saydamlığı ve yatay konumu (0–1). */
  leak: { opacity: number; x: number } | null;
}

export function fxPreview(fx: LookFx | undefined, t: number): FxPreview {
  const out: FxPreview = { filter: "", transform: "", grain: 0, scanlines: 0, leak: null };
  if (!fx) return out;
  const parts: string[] = [];
  const g = fx.glitch ?? 0;
  if (g > 0) {
    const dx = glitchShift(g, t);
    if (dx !== 0) out.transform = `translateX(${dx}px)`;
    if (glitchOn(t)) parts.push(`hue-rotate(${Math.round(90 * g)}deg)`);
  }
  const split = Math.max(fx.rgbSplit ?? 0, (fx.vhs ?? 0) * 0.5);
  if (split > 0) {
    const px = (2 + 10 * split).toFixed(1);
    parts.push(
      `drop-shadow(-${px}px 0 rgb(255 0 0 / 0.55)) drop-shadow(${px}px 0 rgb(0 160 255 / 0.55))`,
    );
  }
  const vhs = fx.vhs ?? 0;
  if (vhs > 0) {
    parts.push(`saturate(${(1 + 0.3 * vhs).toFixed(2)}) contrast(${(1 + 0.1 * vhs).toFixed(2)})`);
    parts.push(`blur(${(0.6 * vhs).toFixed(2)}px)`);
    out.scanlines = vhs;
  }
  const strobe = fx.strobe ?? 0;
  if (strobe > 0) {
    const level = strobeLevel(strobe, t);
    if (level > 0) parts.push(`brightness(${(1 + level * 2).toFixed(2)})`);
  }
  const sharpen = fx.sharpen ?? 0;
  if (sharpen > 0) parts.push(`contrast(${(1 + 0.12 * sharpen).toFixed(2)})`);
  out.grain = Math.max(fx.grain ?? 0, vhs * 0.4);
  const leak = fx.lightLeak ?? 0;
  if (leak > 0)
    out.leak = { opacity: 0.25 + 0.5 * leak * leakPulse(t), x: 0.5 + 0.4 * Math.sin(t * 0.7) };
  out.filter = parts.join(" ");
  return out;
}

export const hasTimedFx = (fx: LookFx | undefined) =>
  !!fx && ((fx.glitch ?? 0) > 0 || (fx.strobe ?? 0) > 0 || (fx.lightLeak ?? 0) > 0);
