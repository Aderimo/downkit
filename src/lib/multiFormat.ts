import type { ExportOptions, FrameAspect } from "../store/editorStore";
import { TEXT_SIZE, type TextItem, type TextPlace } from "./textItems";

// Tek projeden çoklu biçim (9:16 + 1:1 + 16:9…): her biçim ayrı dosya olarak dışa
// aktarılır. Yazı konumları biçim başına ayrıdır: yazının x/y/boyutu her zaman
// önizlenen biçimindir, öteki biçimlerdeki yeri `at` içinde durur. Biçim değişince
// konumlar yer değiştirir; o biçimde hiç yerleştirilmemiş yazı son konumunu korur.

export type FramedAspect = Exclude<FrameAspect, "original">;

export const FORMAT_FRAMES: FramedAspect[] = ["9:16", "1:1", "4:5", "16:9"];

/** Biçim adlarının çeviri anahtarı (i18next ":" işaretini ad alanı ayırıcısı sayar). */
export const FRAME_KEYS: Record<FrameAspect, string> = {
  original: "original",
  "9:16": "vertical",
  "1:1": "square",
  "4:5": "portrait",
  "16:9": "landscape",
};

const ALL_FRAMES: FrameAspect[] = ["original", ...FORMAT_FRAMES];

const place = (t: TextItem): TextPlace => ({ x: t.x, y: t.y, size: t.size });

/** Önizlenen biçim `from`'dan `to`'ya geçerken yazıların konumlarını değiştirir. */
export function swapPlacement(
  texts: readonly TextItem[],
  from: FrameAspect,
  to: FrameAspect,
): TextItem[] {
  if (from === to) return texts as TextItem[];
  return texts.map((t) => {
    const { [to]: next, ...rest } = t.at ?? {};
    const at = { ...rest, [from]: place(t) };
    return next ? { ...t, ...next, at } : { ...t, at };
  });
}

/** `frame` biçiminde dışa aktarılacak yazılar (önizlenen biçim `current`). */
export function textsForFrame(
  texts: readonly TextItem[],
  frame: FrameAspect,
  current: FrameAspect,
): TextItem[] {
  if (frame === current) return texts as TextItem[];
  return texts.map((t) => {
    const p = t.at?.[frame];
    return p ? { ...t, ...p } : t;
  });
}

/** Önizlenen biçimdeki konumlar bütün biçimlerde kullanılsın (biçime özel yerler silinir). */
export function clearPlacements(texts: readonly TextItem[]): TextItem[] {
  return texts.map((t) => {
    if (!t.at) return t;
    const next = { ...t };
    delete next.at;
    return next;
  });
}

/** Seçilen biçimlerden birinde yazı başka yerde mi (eşitle düğmesi buna göre). */
export function placementsDiffer(texts: readonly TextItem[], frames: readonly FrameAspect[]) {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  return texts.some((t) =>
    frames.some((f) => {
      const p = t.at?.[f];
      return !!p && !(near(p.x, t.x) && near(p.y, t.y) && near(p.size, t.size));
    }),
  );
}

/** Dışa aktarılacak biçimler: önizlenen biçim önce, ardından seçilen ek biçimler. */
export function exportFrames(o: Pick<ExportOptions, "frame" | "alsoFrames">): FrameAspect[] {
  if (o.frame === "original") return ["original"];
  return [o.frame, ...FORMAT_FRAMES.filter((f) => f !== o.frame && o.alsoFrames.includes(f))];
}

/** Ek biçimi açar / kapatır. */
export function toggleFrame(o: Pick<ExportOptions, "frame" | "alsoFrames">, f: FramedAspect) {
  const rest = o.alsoFrames.filter((x) => x !== f && x !== o.frame);
  return o.alsoFrames.includes(f) ? rest : [...rest, f];
}

/** Önizlemeyi kümedeki başka biçime geçirir; eski biçim kümede kalır. */
export function previewFrame(
  o: Pick<ExportOptions, "frame" | "alsoFrames">,
  f: FramedAspect,
): Pick<ExportOptions, "frame" | "alsoFrames"> {
  const set = exportFrames(o).filter((x): x is FramedAspect => x !== "original");
  return { frame: f, alsoFrames: set.filter((x) => x !== f) };
}

/** Dosya adına eklenecek biçim etiketi ("9x16"). */
export const frameSuffix = (f: FrameAspect) => f.replace(":", "x");

/** Kayıttan gelen ek biçim listesi. */
export function parseAlsoFrames(raw: unknown): FramedAspect[] {
  if (!Array.isArray(raw)) return [];
  return FORMAT_FRAMES.filter((f) => raw.includes(f));
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Kayıttan gelen biçime özel konumlar (bozuk olan atılır). */
export function parsePlacement(raw: unknown): TextItem["at"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: NonNullable<TextItem["at"]> = {};
  for (const f of ALL_FRAMES) {
    const p = (raw as Record<string, unknown>)[f] as Record<string, unknown> | undefined;
    if (!p || !isNum(p.x) || !isNum(p.y) || !isNum(p.size)) continue;
    out[f] = {
      x: clamp(p.x, 0, 1),
      y: clamp(p.y, 0, 1),
      size: clamp(p.size, TEXT_SIZE.min, TEXT_SIZE.max),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
