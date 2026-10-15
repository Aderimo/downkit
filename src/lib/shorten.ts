import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { suggestEmoji } from "./captionEmoji";
import { findFillers, isSelected, useFillerStore } from "./fillers";
import { markerTimes, useMarkersStore } from "./markers";
import { cutTimeline, mergeRanges, rangesDuration, type TimeRange } from "./rangeCut";
import { sequenceEnd } from "./sequence";
import { currentSilences, findSilences, silenceKey, useSilenceStore } from "./silence";
import type { TextItem } from "./textItems";
import { flatWords, spanRange } from "./transcriptEdit";

// "60 sn altına indir": önce sessizlikler, sonra dolgu kelimeleri kesilir; hâlâ uzunsa
// en az önemli cümleler önerilir (ilk cümle = kanca ve son cümle = kapanış korunur).
// Önem: konuşma yoğunluğu, soru/ünlem, anahtar kelime, an işareti; dolgu çoksa düşer.

export interface SentenceCut extends TimeRange {
  textId: string;
  text: string;
  score: number;
}

export interface ShortenPlan {
  target: number;
  before: number;
  after: number;
  silences: TimeRange[];
  fillers: TimeRange[];
  sentences: SentenceCut[];
  /** Hedefe inildi mi (önerilen cümlelerle birlikte). */
  reached: boolean;
}

export const SHORTEN_TARGETS = [15, 30, 60, 90] as const;

/** Cümlenin önemi (yüksek = kalsın). */
export function sentenceScore(
  line: TextItem,
  markers: readonly number[],
  fillerCount: number,
): number {
  const words = line.words?.length || line.text.split(/\s+/).filter(Boolean).length || 1;
  const duration = Math.max(0.3, line.end - line.start);
  let score = Math.min(4, words / duration) * 0.5;
  if (/[?!]/.test(line.text)) score += 1.5;
  if (line.words?.some((w) => w.emph)) score += 2;
  if (line.emoji || suggestEmoji(line)) score += 1;
  if (markers.some((m) => m >= line.start - 1 && m <= line.end + 1)) score += 4;
  score -= (2 * fillerCount) / words;
  return score;
}

export interface PlanInput {
  texts: readonly TextItem[];
  /** Zaman çizelgesinin şimdiki süresi. */
  duration: number;
  markers: readonly number[];
  silences: readonly TimeRange[];
  fillers: readonly TimeRange[];
  target: number;
}

/**
 * Kesilecek aralıkları hedefin altına inmeyecek kadarla sınırlar: en uzun aralıktan
 * başlayarak eklenir, hedefi aşacak son aralık kısaltılır. Böylece video hiçbir zaman
 * hedeften (ya da kendi süresinden) daha kısa olmaz; tamamı silinmez.
 */
export function limitCut(
  ranges: readonly TimeRange[],
  duration: number,
  target: number,
): TimeRange[] {
  const budget = Math.max(0, duration - Math.max(target, 0));
  const out: TimeRange[] = [];
  let used = 0;
  for (const r of [...mergeRanges([...ranges])].sort(
    (a, b) => b.end - b.start - (a.end - a.start),
  )) {
    if (used >= budget - 1e-6) break;
    const len = r.end - r.start;
    if (used + len <= budget) {
      out.push(r);
      used += len;
    } else {
      out.push({ start: r.start, end: r.start + (budget - used) });
      used = budget;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function planShorten(input: PlanInput): ShortenPlan {
  // Sessizlik ve dolgu hedefin altına indirecekse yalnızca gereken kadarı kesilir.
  const all = mergeRanges([...input.silences, ...input.fillers]);
  const base =
    input.duration - rangesDuration(all) < input.target
      ? limitCut(all, input.duration, input.target)
      : all;
  const plan: ShortenPlan = {
    target: input.target,
    before: input.duration,
    after: input.duration - rangesDuration(base),
    silences: base === all ? [...input.silences] : base,
    fillers: base === all ? [...input.fillers] : [],
    sentences: [],
    reached: false,
  };
  if (plan.after <= input.target) return { ...plan, reached: true };

  const lines = input.texts
    .filter((t) => t.auto && t.text.trim())
    .sort((a, b) => a.start - b.start);
  const words = flatWords(input.texts);
  const fillerCount = (line: TextItem) =>
    input.fillers.filter((f) => f.start < line.end && f.end > line.start).length;
  // İlk ve son cümle korunur; az cümlede öneri yok.
  const candidates = lines.slice(1, -1).flatMap((line) => {
    const first = words.findIndex((w) => w.textId === line.id);
    if (first < 0) return [];
    let last = first;
    while (words[last + 1]?.textId === line.id) last += 1;
    const range = spanRange(words, [first, last]);
    return [
      {
        ...range,
        textId: line.id,
        text: line.text,
        score: sentenceScore(line, input.markers, fillerCount(line)),
      },
    ];
  });
  // Önemi düşük olan önce; eşitse uzun olan (daha az cümleyle hedefe inilsin).
  candidates.sort((a, b) => a.score - b.score || b.end - b.start - (a.end - a.start));
  const chosen: SentenceCut[] = [];
  let after = plan.after;
  for (const c of candidates) {
    if (after <= input.target) break;
    chosen.push(c);
    after = input.duration - rangesDuration(mergeRanges([...base, ...chosen]));
  }
  return {
    ...plan,
    after,
    sentences: chosen.sort((a, b) => a.start - b.start),
    reached: after <= input.target,
  };
}

interface ShortenState {
  target: number;
  plan: ShortenPlan | null;
  /** Öneriden çıkarılan cümleler. */
  skipped: string[];
  busy: boolean;
  error: unknown;
  setTarget: (target: number) => void;
  toggleSentence: (textId: string) => void;
  reset: () => void;
}

export const useShortenStore = create<ShortenState>((set) => ({
  target: 60,
  plan: null,
  skipped: [],
  busy: false,
  error: null,
  setTarget: (target) => set({ target, plan: null, skipped: [] }),
  toggleSentence: (id) =>
    set((s) => ({
      skipped: s.skipped.includes(id) ? s.skipped.filter((x) => x !== id) : [...s.skipped, id],
    })),
  reset: () => set({ plan: null, skipped: [], error: null }),
}));

/** Zaman çizelgesindeki an işaretleri (kaynaklardaki işaretlerin klip yerleri). */
function timelineMarkers(): number[] {
  const { clips, sources } = useEditorStore.getState();
  const byPath = useMarkersStore.getState().byPath;
  return sources.flatMap((s) =>
    byPath[s.source.path]?.length
      ? markerTimes(clips, s.id, sources[0]?.id, byPath[s.source.path])
      : [],
  );
}

/** Planı çıkarır: sessizlikler henüz bulunmadıysa önce onlar bulunur. */
export async function makeShortenPlan(): Promise<ShortenPlan | null> {
  useShortenStore.setState({ busy: true, error: null, plan: null, skipped: [] });
  try {
    const editor = useEditorStore.getState();
    const hasAudio = editor.sources.some((s) => s.source.info.audioCodec !== null);
    if (hasAudio && useSilenceStore.getState().status !== "done") await findSilences();
    const kept = useSilenceStore.getState().kept;
    const silences = currentSilences().filter((r) => !kept.includes(silenceKey(r)));
    const choice = useFillerStore.getState().choice;
    const fillers = findFillers(editor.texts)
      .filter((h) => h.kind !== "repeat" && isSelected(h, choice))
      .map((h) => ({ start: h.start, end: h.end }));
    const plan = planShorten({
      texts: editor.texts,
      duration: sequenceEnd(editor.clips),
      markers: timelineMarkers(),
      silences,
      fillers,
      target: useShortenStore.getState().target,
    });
    useShortenStore.setState({ plan, busy: false });
    return plan;
  } catch (error) {
    useShortenStore.setState({ busy: false, error });
    return null;
  }
}

/** Planı uygular (tek geri alma adımı). Kesilen süre döner. */
export function applyShortenPlan(): number {
  const { plan, skipped } = useShortenStore.getState();
  if (!plan) return 0;
  const ranges = [
    ...plan.silences,
    ...plan.fillers,
    ...plan.sentences.filter((s) => !skipped.includes(s.textId)),
  ];
  if (ranges.length === 0) return 0;
  const editor = useEditorStore.getState();
  const result = cutTimeline(editor, ranges, newClipId);
  editor.applyEdit({
    clips: result.clips,
    texts: result.texts,
    images: result.images,
    blurs: result.blurs,
    effects: result.effects,
    music: result.music,
  });
  useShortenStore.setState({ plan: null, skipped: [] });
  useSilenceStore.setState({ kept: [] });
  useFillerStore.getState().clear();
  return result.removed;
}

/** Plan, atlanan cümleler çıkarılınca kaç saniyeye iner. */
export function planResult(plan: ShortenPlan, skipped: readonly string[]): number {
  const ranges = mergeRanges([
    ...plan.silences,
    ...plan.fillers,
    ...plan.sentences.filter((s) => !skipped.includes(s.textId)),
  ]);
  return plan.before - rangesDuration(ranges);
}
