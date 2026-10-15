import { displayText, fontOf, isRichText } from "./captionStyle";
import { outputRanges, type TextItem } from "./textItems";

// Zengin yazılar (yazı tipi, kontur, arka plan, kelime vurgusu) dışa aktarmada ASS
// altyazısı olarak çizilir (FFmpeg libass). Kelime vurgusu için satır, her kelimenin
// söylendiği aralıkta ayrı bir olay olur: o kelime vurgulu, diğerleri normal.
// Zamanlar çıktı saniyesidir (zaman çizelgesindeki boşluklar ve kesilen yerler atlanır).

type Piece = { tStart: number; tEnd: number };

const two = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** #rrggbb → ASS etiket rengi &HBBGGRR& (saydamlık ayrı: assAlpha). */
export function assColor(hex: string): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** Opaklık (0–1) → ASS saydamlığı &HAA& (00 opak, FF görünmez). */
export function assAlpha(opacity: number): string {
  return `&H${two(Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255))}&`;
}

/** Saniye → ASS zamanı (s:dd:dd.cc). */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(c)}`;
}

/** Kullanıcı metni: ASS etiketleri ({…}) ve ters eğik çizgi metin olarak kalsın. */
export function assEscape(text: string): string {
  return text
    .replace(/\\/g, "⧵")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\r?\n/g, "\\N");
}

/** Zaman çizelgesi aralığını çıktı aralıklarına çevirir (kesilen kısımlar düşer). */
function toOutput(pieces: readonly Piece[], start: number, end: number): [number, number][] {
  return outputRanges(pieces, start, end);
}

interface Frame {
  width: number;
  height: number;
}

/** Yazının ana etiketleri: konum, yazı tipi, renkler, kontur, gölge. */
function baseTags(t: TextItem, frame: Frame): { tags: string; fontSize: number; outline: number } {
  const short = Math.min(frame.width, frame.height);
  const fontSize = Math.max(8, t.size * short);
  const font = fontOf(t.font);
  const stroke = t.stroke ?? (t.style === "outline" || t.style === "comic" ? 0.06 : 0);
  const outline = stroke * fontSize;
  const tags = [
    "\\an5",
    `\\pos(${Math.round(t.x * frame.width)},${Math.round(t.y * frame.height)})`,
    `\\fn${font.family}`,
    `\\fs${Math.round(fontSize)}`,
    `\\b${t.bold || font.weight >= 700 ? 1 : 0}`,
    t.italic ? "\\i1" : "",
    `\\c${assColor(t.color)}`,
    `\\3c${assColor(t.strokeColor ?? "#000000")}`,
    `\\bord${outline.toFixed(1)}`,
    `\\shad${(((t.shadow ?? 0) * fontSize) / 10).toFixed(1)}`,
    `\\4c${assColor("#000000")}\\4a${assAlpha(0.75)}`,
    t.glow ? `\\blur${(t.glow * fontSize * 0.12).toFixed(1)}` : "",
    t.spacing ? `\\fsp${(t.spacing * fontSize).toFixed(1)}` : "",
  ].join("");
  return { tags, fontSize, outline };
}

/** Giriş animasyonu (yalnızca satırın ilk olayında) ve çıkış (son olayında). */
function animTags(t: TextItem, first: boolean, last: boolean, frame: Frame): string {
  const anim = t.anim ?? "none";
  const parts: string[] = [];
  if (anim === "fade") parts.push(`\\fad(${first ? 250 : 0},${last ? 200 : 0})`);
  if (first && anim === "pop") parts.push("\\fscx30\\fscy30\\t(0,250,\\fscx100\\fscy100)");
  if (first && anim === "bounce") {
    parts.push("\\fscx85\\fscy85\\t(0,140,\\fscx112\\fscy112)\\t(140,300,\\fscx100\\fscy100)");
  }
  if (first && anim === "slideUp") {
    const x = Math.round(t.x * frame.width);
    const y = Math.round(t.y * frame.height);
    const from = Math.round(y + 0.06 * frame.height);
    parts.push(`\\move(${x},${from},${x},${y},0,350)`);
  }
  return parts.join("");
}

/** Satırın metni; `active` sıradaki kelime vurgulu. */
function lineText(t: TextItem, active: number, fontSize: number, outline: number): string {
  const words = t.words;
  const h = t.highlight;
  const emphasis = words?.some((w) => w.emph) ?? false;
  if (!words || words.length === 0 || ((!h || active < 0) && !emphasis))
    return assEscape(displayText(t.text, t.upper));
  // Anahtar kelimeler konuşulmasa da vurgu renginde (vurgu yoksa sarı).
  const emphColor = h?.color ?? "#ffd43b";
  return words
    .map((w, i) => {
      const text = assEscape(displayText(w.text.trim(), t.upper));
      if (i !== active || !h) {
        return w.emph ? `{\\c${assColor(emphColor)}}${text}{\\c${assColor(t.color)}}` : text;
      }
      switch (h.mode) {
        case "color":
          return `{\\c${assColor(h.color)}}${text}{\\c${assColor(t.color)}}`;
        case "scale":
          return `{\\c${assColor(h.color)}\\fscx118\\fscy118}${text}{\\c${assColor(t.color)}\\fscx100\\fscy100}`;
        case "bounce":
          return `{\\c${assColor(h.color)}\\t(0,90,\\fscx125\\fscy125)\\t(90,220,\\fscx100\\fscy100)}${text}{\\c${assColor(t.color)}\\fscx100\\fscy100}`;
        case "underline":
          return `{\\c${assColor(h.color)}\\u1}${text}{\\u0\\c${assColor(t.color)}}`;
        case "box": {
          // Kalın, renkli kontur kelimenin arkasında kutu gibi durur.
          const pad = Math.max(outline, fontSize * 0.14).toFixed(1);
          return `{\\3c${assColor(h.color)}\\bord${pad}\\shad0}${text}{\\3c${assColor(t.strokeColor ?? "#000000")}\\bord${outline.toFixed(1)}}`;
        }
      }
    })
    .join(" ");
}

/** Arka plan şeridi: metnin arkasında renkli kutu (ASS'de opak kutu kenarlığı). */
function boxLine(t: TextItem, tags: string, text: string, fontSize: number): string | null {
  const color = t.bg ?? (t.box && t.style !== "highlight" ? "#000000" : undefined);
  if (!color) return null;
  const opacity = t.bg ? (t.bgOpacity ?? 0.85) : 0.55;
  // Kutu ayrı katmanda: kenarlık kutuyu metnin etrafına yayar, metin üst katmanda
  // çizilir. Dikey pay yok (yazı tipinin kendi payı yeter): kaydırılan satırların
  // kutuları üst üste binmez.
  const padX = (fontSize * 0.28).toFixed(1);
  return `${tags}\\3c${assColor(color)}\\3a${assAlpha(opacity)}\\1a&HFF&\\bord0\\xbord${padX}\\ybord0\\shad0\\blur0}${text}`;
}

/**
 * Zengin yazıların ASS betiği. Yazı yoksa null. `frame`: çıkış karesinin boyutu
 * (oran önemlidir; libass gerçek video boyutuna ölçekler).
 */
export function buildAss(
  texts: readonly TextItem[],
  pieces: readonly Piece[],
  frame: Frame,
): string | null {
  const rich = texts.filter((t) => t.text.trim() && isRichText(t));
  if (rich.length === 0) return null;
  const events: string[] = [];
  for (const t of rich) {
    const { tags, fontSize, outline } = baseTags(t, frame);
    // Kelime vurgusu: satır, her kelimenin söylendiği aralığa bölünür.
    const slices: { start: number; end: number; active: number }[] = [];
    const words = t.highlight && t.words && t.words.length > 0 ? t.words : null;
    if (words) {
      for (let i = 0; i < words.length; i += 1) {
        const start = i === 0 ? t.start : Math.max(t.start, words[i].start);
        const end = i === words.length - 1 ? t.end : Math.min(t.end, words[i + 1].start);
        if (end - start > 0.005) slices.push({ start, end, active: i });
      }
    }
    if (slices.length === 0) slices.push({ start: t.start, end: t.end, active: -1 });
    slices.forEach((slice, index) => {
      const ranges = toOutput(pieces, slice.start, slice.end);
      ranges.forEach(([a, b], r) => {
        const first = index === 0 && r === 0;
        const last = index === slices.length - 1 && r === ranges.length - 1;
        const open = `{${tags}${animTags(t, first, last, frame)}`;
        const text = lineText(t, slice.active, fontSize, outline);
        const box = boxLine(t, open, assEscape(displayText(t.text, t.upper)), fontSize);
        if (box) events.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Box,,0,0,0,,${box}`);
        events.push(`Dialogue: 1,${assTime(a)},${assTime(b)},Default,,0,0,0,,${open}}${text}`);
      });
    });
  }
  if (events.length === 0) return null;
  const margin = Math.round(frame.width * 0.05);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.round(frame.width)}`,
    `PlayResY: ${Math.round(frame.height)}`,
    // Akıllı kaydırma: kenardan taşan satır alta geçer (kenarlarda %5 pay).
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Segoe UI,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,${margin},${margin},0,1`,
    `Style: Box,Segoe UI,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,0,0,5,${margin},${margin},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
