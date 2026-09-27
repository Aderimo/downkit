/** Rust `snip::SnipImage`: düzenleyicideki görüntü (geçici klasörde ya da diskte). */
export interface SnipImage {
  path: string;
  /** Yerel önizleme sunucusundaki adresi. */
  url: string;
  width: number;
  height: number;
}

/** Seçimden sonra yapılacak iş. */
export type SnipAction = "edit" | "translate" | "copy" | "save";

/** Seçim penceresinin açılış bilgisi (Rust `snip::SnipState`). */
export interface SnipState {
  url: string;
  width: number;
  height: number;
  mode: "edit" | "translate";
}

/** Donmuş görüntünün piksel koordinatlarında dikdörtgen. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine extends PixelRect {
  text: string;
}

export interface OcrOutput {
  language: string;
  lines: OcrLine[];
}

export type TranslateLang = "en" | "tr";
