import i18n from "../i18n";
import {
  newClipId,
  useEditorStore,
  type ExportOptions,
  type FrameAspect,
} from "../store/editorStore";
import { layoutOptions, type FrameLayoutId } from "./frameLayouts";
import { sequenceEnd } from "./sequence";
import { newText, type TextItem } from "./textItems";

// Hazır Reels şablonları: düzen (çerçeve, arka plan), yazılar (başlık bandı, soru,
// sinematik başlık, alıntı), kanca yazıları (ilk saniyeler), bitiş ekranı ve ilerleme
// çubuğu tek tıkla projeye uygulanır; hepsi sonradan düzenlenebilir. Aynı türden
// şablon yeniden uygulanınca öncekinin yazıları değişir (üst üste binmez).

export interface ProgressBarOption {
  color: string;
  /** Yükseklik: çıkış yüksekliğinin oranı. */
  height: number;
  top: boolean;
}

export const PROGRESS_COLORS = ["#ffd43b", "#ffffff", "#4f7bff", "#ff4d6d", "#4ade80"];

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export function parseProgressBar(raw: unknown): ProgressBarOption | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isColor(r.color)) return null;
  const height =
    typeof r.height === "number" && Number.isFinite(r.height)
      ? Math.min(0.06, Math.max(0.004, r.height))
      : 0.012;
  return { color: r.color, height, top: r.top === true };
}

export type TemplateKind = "layout" | "hook" | "end";

type TplText = {
  /** Yerelleştirilmiş örnek metin anahtarı (templates.text.*). */
  key: string;
  style: Partial<TextItem>;
  /** Saniye: "full" bütün video; sayı başlangıçtan bu kadar; negatif sondan bu kadar. */
  span: "full" | number;
};

export interface ReelTemplate {
  id: string;
  kind: TemplateKind;
  frame?: Exclude<FrameAspect, "original">;
  layout?: FrameLayoutId;
  gradient?: [string, string];
  progress?: ProgressBarOption | null;
  texts: TplText[];
}

const bold = { bold: true, box: false, color: "#ffffff" };

export const REEL_TEMPLATES: ReelTemplate[] = [
  {
    id: "titleQuestion",
    kind: "layout",
    frame: "9:16",
    layout: "blur",
    progress: { color: "#ffd43b", height: 0.012, top: false },
    texts: [
      {
        key: "title",
        span: "full",
        style: {
          ...bold,
          x: 0.5,
          y: 0.15,
          size: 0.062,
          font: "segoeBlack",
          bg: "#e11d48",
          bgOpacity: 1,
        },
      },
      {
        key: "question",
        span: "full",
        style: {
          ...bold,
          x: 0.5,
          y: 0.72,
          size: 0.05,
          font: "segoeBlack",
          bg: "#111111",
          bgOpacity: 0.85,
        },
      },
    ],
  },
  {
    id: "cinematic",
    kind: "layout",
    frame: "9:16",
    layout: "crop",
    texts: [
      {
        key: "byline",
        span: 3.5,
        style: {
          ...bold,
          bold: false,
          x: 0.5,
          y: 0.42,
          size: 0.04,
          font: "inkFree",
          italic: true,
          anim: "fade",
        },
      },
      {
        key: "cinematicTitle",
        span: 3.5,
        style: {
          ...bold,
          x: 0.5,
          y: 0.485,
          size: 0.11,
          font: "bahnschrift",
          upper: true,
          spacing: 0.22,
          shadow: 0.6,
          anim: "fade",
        },
      },
      {
        key: "place",
        span: 3.5,
        style: {
          ...bold,
          bold: false,
          x: 0.5,
          y: 0.56,
          size: 0.03,
          font: "segoe",
          upper: true,
          spacing: 0.18,
          anim: "fade",
        },
      },
    ],
  },
  {
    id: "lesson",
    kind: "layout",
    frame: "9:16",
    layout: "gradient",
    gradient: ["#0f172a", "#334155"],
    progress: { color: "#4f7bff", height: 0.01, top: true },
    texts: [
      {
        key: "lessonTitle",
        span: "full",
        style: { ...bold, x: 0.5, y: 0.14, size: 0.06, font: "segoeBlack", color: "#facc15" },
      },
      {
        key: "lessonSub",
        span: "full",
        style: { ...bold, bold: false, x: 0.5, y: 0.2, size: 0.035, font: "segoe" },
      },
    ],
  },
  {
    id: "quote",
    kind: "layout",
    frame: "1:1",
    layout: "gradient",
    gradient: ["#1e3a8a", "#9333ea"],
    texts: [
      {
        key: "quoteText",
        span: "full",
        style: { ...bold, x: 0.5, y: 0.7, size: 0.06, font: "georgia", italic: true, shadow: 0.5 },
      },
      {
        key: "speaker",
        span: "full",
        style: {
          ...bold,
          bold: false,
          x: 0.5,
          y: 0.8,
          size: 0.035,
          font: "segoe",
          color: "#e9d5ff",
        },
      },
    ],
  },
  {
    id: "progressOnly",
    kind: "layout",
    progress: { color: "#ffd43b", height: 0.012, top: false },
    texts: [],
  },
  // Kanca: ilk saniyelerde dikkat çeken yazı.
  {
    id: "hookSecret",
    kind: "hook",
    texts: [
      {
        key: "hookSecret",
        span: 3,
        style: {
          ...bold,
          x: 0.5,
          y: 0.3,
          size: 0.075,
          font: "impact",
          upper: true,
          stroke: 0.08,
          anim: "pop",
        },
      },
    ],
  },
  {
    id: "hookStop",
    kind: "hook",
    texts: [
      {
        key: "hookStop",
        span: 2.5,
        style: {
          ...bold,
          x: 0.5,
          y: 0.25,
          size: 0.08,
          font: "segoeBlack",
          bg: "#ffd43b",
          bgOpacity: 1,
          color: "#111111",
          anim: "bounce",
        },
      },
    ],
  },
  {
    id: "hookMistake",
    kind: "hook",
    texts: [
      {
        key: "hookMistake",
        span: 3,
        style: {
          ...bold,
          x: 0.5,
          y: 0.3,
          size: 0.068,
          font: "arialBlack",
          stroke: 0.06,
          color: "#ff4d6d",
          anim: "slideUp",
        },
      },
    ],
  },
  // Bitiş ekranı: son saniyelerde çağrı.
  {
    id: "endFollow",
    kind: "end",
    texts: [
      {
        key: "endFollow",
        span: -3,
        style: {
          ...bold,
          x: 0.5,
          y: 0.5,
          size: 0.07,
          font: "segoeBlack",
          bg: "#4f7bff",
          bgOpacity: 1,
          anim: "pop",
        },
      },
    ],
  },
  {
    id: "endPart2",
    kind: "end",
    texts: [
      {
        key: "endPart2",
        span: -3,
        style: {
          ...bold,
          x: 0.5,
          y: 0.5,
          size: 0.08,
          font: "impact",
          upper: true,
          stroke: 0.07,
          color: "#ffd43b",
          anim: "pop",
        },
      },
    ],
  },
  {
    id: "endFull",
    kind: "end",
    texts: [
      {
        key: "endFull",
        span: -4,
        style: {
          ...bold,
          x: 0.5,
          y: 0.7,
          size: 0.05,
          font: "segoeBlack",
          bg: "#111111",
          bgOpacity: 0.85,
          anim: "slideUp",
        },
      },
    ],
  },
];

export const templateById = (id: string) => REEL_TEMPLATES.find((t) => t.id === id);

/** Şablonun yazıları: video süresine göre zamanlanır; aynı türün eski yazıları kalkar. */
export function templateTexts(
  tpl: ReelTemplate,
  duration: number,
  newId: () => string,
  label: (key: string) => string,
): TextItem[] {
  const end = Math.max(1, duration);
  return tpl.texts.map((x) => {
    let start = 0;
    let stop = end;
    if (typeof x.span === "number") {
      if (x.span >= 0) stop = Math.min(end, x.span);
      else start = Math.max(0, end + x.span);
    }
    return {
      ...newText(newId(), start, label(x.key)),
      ...x.style,
      end: stop,
      tpl: tpl.kind,
    } as TextItem;
  });
}

/** Şablonu projeye uygular. Sesi olmayan dışa aktarma seçenekleri geri alınmaz;
 * yazılar tek geri alma adımıdır. İlk yazı seçilir (hemen düzenlensin). */
export function applyTemplate(id: string, sourceAspect: number) {
  const tpl = templateById(id);
  if (!tpl) return;
  const editor = useEditorStore.getState();
  const patch: Partial<ExportOptions> = {};
  if (tpl.frame) patch.frame = tpl.frame;
  if (tpl.layout) {
    const withFrame = { ...editor.exportOptions, ...patch } as ExportOptions;
    Object.assign(patch, layoutOptions(tpl.layout, withFrame, sourceAspect));
  }
  if (tpl.gradient) patch.frameGradient = tpl.gradient;
  if (tpl.progress !== undefined) patch.progressBar = tpl.progress;
  if (Object.keys(patch).length > 0) editor.setExportOptions(patch);
  if (tpl.texts.length === 0) return;
  const duration = sequenceEnd(editor.clips);
  const items = templateTexts(tpl, duration, newClipId, (k) => i18n.t(`templates.text.${k}`));
  editor.applyTexts((texts) => [...texts.filter((x) => x.tpl !== tpl.kind), ...items]);
  editor.selectText(items[0].id);
}

/** Şablonun bıraktığı yazıları (o türden) kaldırır. */
export function removeTemplateTexts(kind: TemplateKind) {
  useEditorStore.getState().applyTexts((texts) => texts.filter((x) => x.tpl !== kind));
}
