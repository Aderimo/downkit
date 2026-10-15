// Tema paylaşımı: özel renkler, arka plan ayarları ve (varsa) arka plan resmi tek
// bir JSON dosyasında. Dosyadaki her alan doğrulanır; resim yalnızca JPEG veri
// adresi olarak kabul edilir (başka bir adres ya da betik yüklenmez).

import { normalizeBackground, type BackgroundSettings } from "./background";
import { normalizeCustomColors, type CustomColors } from "./themes";

export interface ThemeFile {
  app: "DownKit";
  type: "theme";
  version: 1;
  colors: CustomColors;
  background: BackgroundSettings;
  /** Kaynak resim (`data:image/jpeg;base64,…`); yoksa paylaşılmaz. */
  image?: string;
}

/** Metin dosyası sınırı 2 MB; resim bunun altında kalmalı. */
export const MAX_IMAGE_CHARS = 1_800_000;

const JPEG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export function toThemeFile(
  colors: CustomColors,
  background: BackgroundSettings,
  image: string | null,
): ThemeFile {
  const file: ThemeFile = { app: "DownKit", type: "theme", version: 1, colors, background };
  if (image && image.length <= MAX_IMAGE_CHARS) file.image = image;
  return file;
}

export interface ParsedTheme {
  colors: CustomColors;
  background: BackgroundSettings;
  image: string | null;
}

/** Tema dosyası değilse null. */
export function parseThemeFile(raw: unknown): ParsedTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "theme" || !r.colors) return null;
  const image =
    typeof r.image === "string" && r.image.length <= MAX_IMAGE_CHARS && JPEG_DATA.test(r.image)
      ? r.image
      : null;
  const background = normalizeBackground(r.background);
  return {
    colors: normalizeCustomColors(r.colors),
    background: { ...background, enabled: background.enabled && !!image },
    image,
  };
}
