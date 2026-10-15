import { useMemo } from "react";
import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { cutTimeline, type TimeRange } from "./rangeCut";
import type { TextItem } from "./textItems";

// Dolgu kelimeleri ve tekrarlar: otomatik altyazının kelime zamanlarından bulunur
// ("ııı", "eee", "hmm"; "yani", "şey", "işte"; "bu bu" gibi kekelemeler). Kesilince
// bütün izlerden çıkar (rangeCut), altyazıdaki kelime de düşer.

export type FillerKind = "sound" | "word" | "repeat";

export interface FillerHit {
  key: string;
  textId: string;
  index: number;
  word: string;
  kind: FillerKind;
  /** Kesilecek aralık (zaman çizelgesi): kelime + komşulara taşmayan küçük pay. */
  start: number;
  end: number;
}

/** Ses dolguları: uzatılmış ı/e/a/ö, hmm, um, uh… */
const SOUND = /^(ı+|i{3,}|e+|a{2,}|ö+|m{2,}|h+m+|hı+m+|ı+m+|e+h+|a+h+|u+m+|u+h+m*|e+r+m*)$/;

/** Söz dolguları: anlamlı da olabilir; listede gösterilir, kendiliğinden seçilmez. */
const WORDS = new Set([
  "yani",
  "şey",
  "işte",
  "hani",
  "falan",
  "filan",
  "like",
  "basically",
  "literally",
  "actually",
]);

const clean = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase("tr");

const PAD = 0.04;

/** Otomatik altyazılardaki dolgular (zaman sırasıyla). */
export function findFillers(texts: readonly TextItem[]): FillerHit[] {
  const words = texts
    .filter((t) => t.auto && t.words && t.words.length > 0)
    .sort((a, b) => a.start - b.start)
    .flatMap((t) =>
      t.words!.map((w, index) => ({ ...w, textId: t.id, index, norm: clean(w.text) })),
    )
    .filter((w) => w.norm.length > 0);
  const hits: FillerHit[] = [];
  words.forEach((w, i) => {
    const next = words[i + 1];
    let kind: FillerKind | null = null;
    if (SOUND.test(w.norm)) kind = "sound";
    else if (WORDS.has(w.norm)) kind = "word";
    // Kekeleme: aynı kelime hemen ardından yeniden (ilk söyleniş kesilir).
    else if (next && next.norm === w.norm && next.start - w.end < 0.6) kind = "repeat";
    if (!kind) return;
    const prevEnd = words[i - 1]?.end ?? -Infinity;
    const nextStart = next?.start ?? Infinity;
    hits.push({
      key: `${w.textId}:${w.index}:${w.norm}`,
      textId: w.textId,
      index: w.index,
      word: w.text.trim(),
      kind,
      start: Math.max(0, Math.max(prevEnd, w.start - PAD)),
      // Tekrarda ikinci söyleniş kalır: kesim onun başında biter.
      end: kind === "repeat" ? nextStart : Math.min(nextStart, w.end + PAD),
    });
  });
  return hits.filter((h) => h.end - h.start > 0.05);
}

/** Varsayılan seçim: ses dolguları ve tekrarlar kesilir, söz dolguları sorulur. */
// Tekrarlanan kelime çoğu zaman vurgudur ("lan lan"): yalnızca ses dolguları seçili gelir.
export const defaultSelected = (kind: FillerKind) => kind === "sound";

interface FillerState {
  /** Kullanıcının değiştirdiği seçimler (anahtar → kesilsin mi). */
  choice: Record<string, boolean>;
  toggle: (hit: FillerHit) => void;
  clear: () => void;
}

export const useFillerStore = create<FillerState>((set) => ({
  choice: {},
  toggle: (hit) =>
    set((s) => ({
      choice: { ...s.choice, [hit.key]: !(s.choice[hit.key] ?? defaultSelected(hit.kind)) },
    })),
  clear: () => set({ choice: {} }),
}));

export const isSelected = (hit: FillerHit, choice: Record<string, boolean>) =>
  choice[hit.key] ?? defaultSelected(hit.kind);

/** Şimdiki altyazılardaki dolgular (altyazılar değişince yeniden hesaplanır). */
export function useFillers(): FillerHit[] {
  const texts = useEditorStore((s) => s.texts);
  return useMemo(() => findFillers(texts), [texts]);
}

/** Seçili dolguları keser (tek geri alma adımı). Kesilen süre döner. */
export function removeFillers(): number {
  const editor = useEditorStore.getState();
  const { choice } = useFillerStore.getState();
  const ranges: TimeRange[] = findFillers(editor.texts)
    .filter((h) => isSelected(h, choice))
    .map((h) => ({ start: h.start, end: h.end }));
  if (ranges.length === 0) return 0;
  const result = cutTimeline(editor, ranges, newClipId);
  editor.applyEdit({
    clips: result.clips,
    texts: result.texts,
    images: result.images,
    blurs: result.blurs,
    effects: result.effects,
    music: result.music,
  });
  useFillerStore.getState().clear();
  return result.removed;
}
