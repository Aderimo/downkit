import { create } from "zustand";

/** Düzenleyicinin sol panelinde açık araç (zaman çizelgesinden de açılabilsin diye ortak). */
export type AddTool =
  | "media"
  | "templates"
  | "text"
  | "motion"
  | "music"
  | "images"
  | "transitions"
  | "subtitles"
  | "autocut"
  | "blur"
  | "presets";

export const useAddTool = create<{ tool: AddTool | null; setTool: (tool: AddTool | null) => void }>(
  (set) => ({
    tool: "media",
    setTool: (tool) => set({ tool }),
  }),
);

/** Önizleme araçları: ızgara + güvenli alan ve önce/sonra karşılaştırma. */
export const usePreviewTools = create<{
  grid: boolean;
  compare: boolean;
  /** Karşılaştırma çizgisinin yeri (0–1): solu "önce" (efektsiz). */
  split: number;
  set: (patch: Partial<{ grid: boolean; compare: boolean; split: number }>) => void;
}>((set) => ({ grid: false, compare: false, split: 0.5, set }));

/** Sağ paneldeki araç (Ctrl+K araç aramasından da açılabilsin diye ortak). */
export type EditTool = "clip" | "filters" | "color" | "effects";

export const useEditTool = create<{ tool: EditTool; setTool: (tool: EditTool) => void }>((set) => ({
  tool: "clip",
  setTool: (tool) => set({ tool }),
}));

/** Ctrl+K araç arama penceresi. */
export const usePalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const MODE_KEY = "downkit.editorMode";

/** Basit mod: yalnızca en çok kullanılan araçlar; gelişmiş mod: hepsi. */
export type EditorMode = "simple" | "pro";

function savedMode(): EditorMode {
  try {
    return localStorage.getItem(MODE_KEY) === "simple" ? "simple" : "pro";
  } catch {
    return "pro";
  }
}

export const useEditorMode = create<{ mode: EditorMode; setMode: (mode: EditorMode) => void }>(
  (set) => ({
    mode: savedMode(),
    setMode: (mode) => {
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        // Saklanamazsa yalnızca bu oturumda geçerli.
      }
      set({ mode });
    },
  }),
);

export const SIMPLE_ADD_TOOLS: readonly AddTool[] = [
  "media",
  "templates",
  "text",
  "motion",
  "music",
  "transitions",
  "subtitles",
  "autocut",
];
export const SIMPLE_EDIT_TOOLS: readonly EditTool[] = ["clip", "filters"];

const FORMAT_KEY = "downkit.startFormat";
type StartFrame = "original" | "9:16" | "1:1" | "4:5" | "16:9";

function savedFormat(): StartFrame {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    return v === "9:16" || v === "1:1" || v === "4:5" || v === "16:9" ? v : "original";
  } catch {
    return "original";
  }
}

/** Başlangıç ekranında seçilen video biçimi: dosya açılınca dışa aktarma çerçevesi olur. */
export const useStartFormat = create<{ frame: StartFrame; setFrame: (frame: StartFrame) => void }>(
  (set) => ({
    frame: savedFormat(),
    setFrame: (frame) => {
      try {
        localStorage.setItem(FORMAT_KEY, frame);
      } catch {
        // Saklanamazsa yalnızca bu oturumda geçerli.
      }
      set({ frame });
    },
  }),
);
