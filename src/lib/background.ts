// Özel arka plan resmi (Ayarlar → Tema → Özel).
//
// Bulanıklık ve renk filtreleri canlı CSS `filter` ile uygulanmaz: ekran kartı her
// karede yeniden çizerdi. Ayar değişince resim bir kez canvas'ta işlenir, JPEG
// olarak uygulama klasörüne yazılır ve öyle gösterilir. Yalnızca saydamlık ve
// yerleşim canlıdır (ucuz).

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export const BACKGROUND_FITS = ["cover", "contain", "center"] as const;
export type BackgroundFit = (typeof BACKGROUND_FITS)[number];

export interface BackgroundSettings {
  /** Resim varsa gösterilsin mi (resim silinmeden kapatılabilir). */
  enabled: boolean;
  /** Resmin görünürlüğü: 0.1–1. */
  opacity: number;
  /** Bulanıklık (px, 2560 px genişliğe göre): 0–40. */
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  fit: BackgroundFit;
  /** Panellerin (kart, kenar çubuğu) örtücülüğü: 0.4–1. */
  panelAlpha: number;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  enabled: false,
  opacity: 0.6,
  blur: 0,
  brightness: 0.8,
  contrast: 1,
  saturate: 1,
  fit: "cover",
  panelAlpha: 0.85,
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function normalizeBackground(raw: unknown): BackgroundSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BACKGROUND;
  return {
    enabled: r.enabled === true,
    opacity: clamp(r.opacity, 0.1, 1, d.opacity),
    blur: clamp(r.blur, 0, 40, d.blur),
    brightness: clamp(r.brightness, 0.2, 1.5, d.brightness),
    contrast: clamp(r.contrast, 0.5, 1.5, d.contrast),
    saturate: clamp(r.saturate, 0, 2, d.saturate),
    fit: BACKGROUND_FITS.includes(r.fit as BackgroundFit) ? (r.fit as BackgroundFit) : d.fit,
    panelAlpha: clamp(r.panelAlpha, 0.4, 1, d.panelAlpha),
  };
}

/** Resme işlenen filtreler (canvas `filter` söz dizimi). */
export function bakedFilter(b: BackgroundSettings, scale = 1): string {
  const parts = [];
  if (b.blur > 0) parts.push(`blur(${(b.blur * scale).toFixed(1)}px)`);
  if (b.brightness !== 1) parts.push(`brightness(${b.brightness})`);
  if (b.contrast !== 1) parts.push(`contrast(${b.contrast})`);
  if (b.saturate !== 1) parts.push(`saturate(${b.saturate})`);
  return parts.length ? parts.join(" ") : "none";
}

/** Uzun kenarı en fazla bu kadar: 4K ekranda da yeterince keskin, dosya küçük. */
const MAX_SIDE = 2560;
const QUALITY = 0.86;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

function canvasFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  return { canvas, ctx };
}

/** Kullanıcının seçtiği dosyayı küçültüp JPEG'e çevirir (kaynak resim). */
export async function prepareSource(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const { canvas, ctx } = canvasFor(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Kaynak resme filtreleri bir kez işler. Bulanıklıkta kenarlar soluklaşmasın
 * diye resim biraz taşırılarak çizilir. */
export async function bakeBackground(source: string, b: BackgroundSettings): Promise<string> {
  const filter = bakedFilter(b);
  if (filter === "none") return source;
  const img = await loadImage(source);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const { canvas, ctx } = canvasFor(w, h);
  // Bulanıklık 2560 px genişliğe göre; küçük resimde oranla azalır.
  const scale = Math.max(w, h) / MAX_SIDE;
  ctx.filter = bakedFilter(b, scale);
  const pad = b.blur * scale * 2;
  ctx.drawImage(img, -pad, -pad, w + pad * 2, h + pad * 2);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

// --- Kayıtlı resimler (Rust `theme_bg`) ---

const inTauri = () => "__TAURI_INTERNALS__" in window;

interface BackgroundImageState {
  /** Ekranda görünen (işlenmiş) resim. */
  image: string | null;
  /** İşlenmemiş kaynak; ayar ekranında gerekince yüklenir. */
  source: string | null;
  /** Kaynak bu oturumda yüklendi mi (yoksa diskte de yok demektir). */
  sourceLoaded: boolean;
}

export const useBackgroundImage = create<BackgroundImageState>(() => ({
  image: null,
  source: null,
  sourceLoaded: false,
}));

/** Açılışta bir kez: işlenmiş resim varsa yüklenir. */
export async function loadBackgroundImage(): Promise<void> {
  if (!inTauri()) return;
  const image = await invoke<string | null>("theme_bg_load", { kind: "image" }).catch(() => null);
  useBackgroundImage.setState({ image });
}

export async function loadBackgroundSource(): Promise<string | null> {
  const state = useBackgroundImage.getState();
  if (state.sourceLoaded) return state.source;
  const source = inTauri()
    ? await invoke<string | null>("theme_bg_load", { kind: "source" }).catch(() => null)
    : null;
  useBackgroundImage.setState({ source, sourceLoaded: true });
  return source;
}

async function save(kind: "source" | "image", dataUrl: string) {
  if (inTauri()) await invoke("theme_bg_save", { kind, dataUrl });
}

/** Yeni kaynak resim: kaydedilir, ayarlara göre işlenir ve gösterilir. */
export async function setBackgroundSource(source: string, b: BackgroundSettings): Promise<void> {
  await save("source", source);
  useBackgroundImage.setState({ source, sourceLoaded: true });
  await rebake(b);
}

/** Ayarlar değişince kaynak yeniden işlenir. */
export async function rebake(b: BackgroundSettings): Promise<void> {
  const source = await loadBackgroundSource();
  if (!source) return;
  const image = await bakeBackground(source, b);
  await save("image", image);
  useBackgroundImage.setState({ image });
}

export async function clearBackground(): Promise<void> {
  if (inTauri()) await invoke("theme_bg_clear").catch(() => {});
  useBackgroundImage.setState({ image: null, source: null, sourceLoaded: true });
}

/** Arka plan katmanının CSS değişkenleri (bkz. globals.css `body::before`). */
export function applyBackground(
  image: string | null,
  b: BackgroundSettings,
  root: HTMLElement = document.documentElement,
): boolean {
  const on = b.enabled && !!image;
  if (on) {
    root.style.setProperty("--dk-bg-image", `url("${image}")`);
    root.style.setProperty("--dk-bg-opacity", String(b.opacity));
    root.style.setProperty(
      "--dk-bg-size",
      b.fit === "cover" ? "cover" : b.fit === "contain" ? "contain" : "auto",
    );
    root.dataset.bg = "1";
  } else {
    root.style.removeProperty("--dk-bg-image");
    root.style.removeProperty("--dk-bg-opacity");
    root.style.removeProperty("--dk-bg-size");
    delete root.dataset.bg;
  }
  return on;
}
