import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { cutTimeline, moveRange, type TimeRange } from "./rangeCut";
import type { TextItem } from "./textItems";

// Metinden kurgu: transkriptte kelimeler seçilir (sürükle ya da Shift+tık); seçili
// kısım videodan kesilir ya da başka bir cümlenin önüne taşınır. Zaman aralığı
// kelimelerin söylendiği andan gelir; komşu kelimeye taşmayan küçük pay eklenir.

export interface WordRef {
  textId: string;
  index: number;
}

export interface FlatWord extends WordRef {
  text: string;
  start: number;
  end: number;
}

const PAD = 0.05;

/** Otomatik altyazıların kelimeleri, zaman sırasıyla (kelime zamanı yoksa satır tek kelime). */
export function flatWords(texts: readonly TextItem[]): FlatWord[] {
  return texts
    .filter((t) => t.auto && t.text.trim())
    .sort((a, b) => a.start - b.start)
    .flatMap((t) =>
      t.words && t.words.length > 0
        ? t.words.map((w, index) => ({
            textId: t.id,
            index,
            text: w.text,
            start: w.start,
            end: w.end,
          }))
        : [{ textId: t.id, index: 0, text: t.text, start: t.start, end: t.end }],
    );
}

const same = (a: WordRef, b: WordRef) => a.textId === b.textId && a.index === b.index;

/** İki kelime arası (sıradan bağımsız) seçili kelimelerin sıraları. */
export function selectionSpan(
  words: readonly FlatWord[],
  anchor: WordRef | null,
  focus: WordRef | null,
): [number, number] | null {
  if (!anchor || !focus) return null;
  const i = words.findIndex((w) => same(w, anchor));
  const j = words.findIndex((w) => same(w, focus));
  if (i < 0 || j < 0) return null;
  return [Math.min(i, j), Math.max(i, j)];
}

/** Seçimin zaman aralığı: ilk kelimenin başından son kelimenin sonuna, küçük payla. */
export function spanRange(words: readonly FlatWord[], [i, j]: [number, number]): TimeRange {
  const prevEnd = words[i - 1]?.end ?? -Infinity;
  const nextStart = words[j + 1]?.start ?? Infinity;
  return {
    start: Math.max(0, prevEnd, words[i].start - PAD),
    end: Math.min(nextStart, words[j].end + PAD),
  };
}

interface SelectionState {
  anchor: WordRef | null;
  focus: WordRef | null;
  /** Taşıma: hedef cümle seçiliyor. */
  moving: boolean;
  select: (anchor: WordRef | null, focus?: WordRef | null) => void;
  extend: (focus: WordRef) => void;
  setMoving: (moving: boolean) => void;
  clear: () => void;
}

export const useTranscriptSelection = create<SelectionState>((set) => ({
  anchor: null,
  focus: null,
  moving: false,
  select: (anchor, focus = anchor) => set({ anchor, focus, moving: false }),
  extend: (focus) => set((s) => ({ focus, anchor: s.anchor ?? focus })),
  setMoving: (moving) => set({ moving }),
  clear: () => set({ anchor: null, focus: null, moving: false }),
}));

function selectedRange(): TimeRange | null {
  const { anchor, focus } = useTranscriptSelection.getState();
  const words = flatWords(useEditorStore.getState().texts);
  const span = selectionSpan(words, anchor, focus);
  return span ? spanRange(words, span) : null;
}

function apply(result: ReturnType<typeof cutTimeline>) {
  useEditorStore.getState().applyEdit({
    clips: result.clips,
    texts: result.texts,
    images: result.images,
    blurs: result.blurs,
    effects: result.effects,
    music: result.music,
  });
}

/** Seçili kelimeleri videodan keser (bütün izler). Kesilen süre döner. */
export function cutSelection(): number {
  const range = selectedRange();
  if (!range) return 0;
  const result = cutTimeline(useEditorStore.getState(), [range], newClipId);
  apply(result);
  useTranscriptSelection.getState().clear();
  return result.removed;
}

/** Bir satırın (cümlenin) tamamını videodan keser. */
export function cutLine(textId: string): number {
  const words = flatWords(useEditorStore.getState().texts);
  const first = words.findIndex((w) => w.textId === textId);
  if (first < 0) return 0;
  let last = first;
  while (words[last + 1]?.textId === textId) last += 1;
  const result = cutTimeline(
    useEditorStore.getState(),
    [spanRange(words, [first, last])],
    newClipId,
  );
  apply(result);
  useTranscriptSelection.getState().clear();
  return result.removed;
}

/** Seçili kısmı hedef satırın önüne taşır. */
export function moveSelectionBefore(textId: string): boolean {
  const range = selectedRange();
  const editor = useEditorStore.getState();
  const words = flatWords(editor.texts);
  const target = words.find((w) => w.textId === textId);
  if (!range || !target) return false;
  // Hedef: satırın ilk kelimesinden hemen önce (önceki kelimeye taşmadan).
  const i = words.indexOf(target);
  const at = Math.max(words[i - 1]?.end ?? 0, target.start - PAD);
  if (at > range.start - 1e-6 && at < range.end + 1e-6) return false;
  apply(moveRange(editor, range, at, newClipId));
  useTranscriptSelection.getState().clear();
  return true;
}
