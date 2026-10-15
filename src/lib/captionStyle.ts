// Altyazı ve yazı stilleri: yazı tipi, kontur, gölge, arka plan, büyük harf ve
// konuşulan kelimenin vurgusu. Aynı alanlar önizlemede CSS'e (TextLayer), dışa
// aktarmada ASS altyazısına (captionAss) çevrilir; ikisi aynı modelden beslenir.

/** Windows'ta hazır gelen, Türkçe harfleri olan yazı tipleri (indirme gerekmez). */
export const FONTS = [
  { id: "segoe", family: "Segoe UI", weight: 700 },
  { id: "segoeBlack", family: "Segoe UI Black", weight: 900 },
  { id: "arialBlack", family: "Arial Black", weight: 900 },
  { id: "impact", family: "Impact", weight: 400 },
  { id: "bahnschrift", family: "Bahnschrift", weight: 700 },
  { id: "franklin", family: "Franklin Gothic Medium", weight: 400 },
  { id: "verdana", family: "Verdana", weight: 700 },
  { id: "trebuchet", family: "Trebuchet MS", weight: 700 },
  { id: "georgia", family: "Georgia", weight: 700 },
  { id: "comic", family: "Comic Sans MS", weight: 700 },
  { id: "inkFree", family: "Ink Free", weight: 400 },
  { id: "consolas", family: "Consolas", weight: 700 },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const fontOf = (id: FontId | undefined) => FONTS.find((f) => f.id === id) ?? FONTS[0];
export const isFontId = (v: unknown): v is FontId => FONTS.some((f) => f.id === v);

/** Konuşulan kelimenin vurgusu. */
export type HighlightMode = "color" | "box" | "scale" | "bounce" | "underline";
export const HIGHLIGHT_MODES: HighlightMode[] = ["color", "box", "scale", "bounce", "underline"];

export interface WordHighlight {
  mode: HighlightMode;
  color: string;
}

/** Bir kelimenin zamanı (zaman çizelgesi saniyesi). */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
  /** Anahtar kelime: konuşulmasa da vurgu renginde görünür. */
  emph?: boolean;
}

/** Yazının ayrıntılı görünümü; hepsi isteğe bağlı (yoksa klasik görünüm). */
export interface RichTextStyle {
  font?: FontId;
  /** Kontur kalınlığı: yazı boyunun oranı (0–0.25). */
  stroke?: number;
  strokeColor?: string;
  /** Gölge (0–1). */
  shadow?: number;
  /** Parlama: konturun bulanıklığı (0–1); neon görünüm. */
  glow?: number;
  /** Arka plan şeridi rengi (yoksa yok) ve opaklığı. */
  bg?: string;
  bgOpacity?: number;
  upper?: boolean;
  italic?: boolean;
  /** Harf aralığı: yazı boyunun oranı (−0.05–0.3). */
  spacing?: number;
  /** Konuşulan kelimenin vurgusu (kelime zamanları varsa). */
  highlight?: WordHighlight;
  words?: WordTiming[];
}

const clamp = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Kayıtlı projeden gelen zengin stil alanlarını doğrular (bozuk olan atılır). */
export function parseRichStyle(r: Record<string, unknown>): RichTextStyle {
  const out: RichTextStyle = {};
  if (isFontId(r.font)) out.font = r.font;
  const stroke = clamp(r.stroke, 0, 0.25);
  if (stroke !== undefined) out.stroke = stroke;
  if (isColor(r.strokeColor)) out.strokeColor = r.strokeColor;
  const shadow = clamp(r.shadow, 0, 1);
  if (shadow !== undefined) out.shadow = shadow;
  const glow = clamp(r.glow, 0, 1);
  if (glow !== undefined) out.glow = glow;
  if (isColor(r.bg)) out.bg = r.bg;
  const bgOpacity = clamp(r.bgOpacity, 0, 1);
  if (bgOpacity !== undefined) out.bgOpacity = bgOpacity;
  if (r.upper === true) out.upper = true;
  if (r.italic === true) out.italic = true;
  const spacing = clamp(r.spacing, -0.05, 0.3);
  if (spacing !== undefined) out.spacing = spacing;
  const h = r.highlight as Record<string, unknown> | undefined;
  if (h && HIGHLIGHT_MODES.includes(h.mode as HighlightMode) && isColor(h.color)) {
    out.highlight = { mode: h.mode as HighlightMode, color: h.color };
  }
  if (Array.isArray(r.words)) {
    const words = r.words.filter(
      (w: Record<string, unknown>) =>
        w && typeof w.text === "string" && typeof w.start === "number" && typeof w.end === "number",
    ) as WordTiming[];
    if (words.length > 0) {
      out.words = words.map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        ...(w.emph === true ? { emph: true } : {}),
      }));
    }
  }
  return out;
}

/** Yazı yeni (zengin) görünümü kullanıyor mu: öyleyse dışa aktarmada ASS ile çizilir. */
export function isRichText(t: RichTextStyle): boolean {
  return (
    t.font !== undefined ||
    t.stroke !== undefined ||
    t.shadow !== undefined ||
    t.glow !== undefined ||
    t.bg !== undefined ||
    t.upper === true ||
    t.italic === true ||
    t.spacing !== undefined ||
    t.highlight !== undefined
  );
}

/** Zengin görünümü kaldıran yama (kelime zamanları kalır): yazı bundan sonra klasik
 * stil düğmeleriyle biçimlenir. Altyazı stilindeki yazıda stil düğmesine basınca. */
export function clearRichLook(): Required<{
  [K in Exclude<keyof RichTextStyle, "words">]: undefined;
}> {
  return {
    font: undefined,
    stroke: undefined,
    strokeColor: undefined,
    shadow: undefined,
    glow: undefined,
    bg: undefined,
    bgOpacity: undefined,
    upper: undefined,
    italic: undefined,
    spacing: undefined,
    highlight: undefined,
  };
}

/** Ekrandaki metin: büyük harf seçiliyse Türkçe kurallarıyla (i → İ). */
export function displayText(text: string, upper: boolean | undefined): string {
  return upper ? text.toLocaleUpperCase("tr") : text;
}

/** `t` anında konuşulan kelimenin sırası (yoksa -1). Kelime aralarında son kelime vurgulu kalır. */
export function activeWord(words: readonly WordTiming[] | undefined, t: number): number {
  if (!words || words.length === 0) return -1;
  let index = -1;
  for (let i = 0; i < words.length; i += 1) {
    if (t >= words[i].start - 1e-6) index = i;
    else break;
  }
  return index;
}
