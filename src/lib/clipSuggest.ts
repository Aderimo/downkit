import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { suggestEmoji } from "./captionEmoji";
import { findHighlights, markerTimes, useMarkersStore } from "./markers";
import { currentProjectData } from "./project";
import { serializeProject } from "./projectFile";
import { cutTimeline, type TimeRange } from "./rangeCut";
import { sequenceEnd, timelineTimeOfSource } from "./sequence";
import { chooseDownloadDir, projectSave } from "./tauri-api";
import type { TextItem } from "./textItems";
import { useWaveStore } from "./thumbCache";

// Klip önerileri: uzun videodan paylaşılabilir parçalar. Adaylar an işaretleri,
// sesteki heyecanlı anlar ve bölüm başlarından çıkar; konuşma yoğunluğu ve anahtar
// kelimelerle puanlanır; cümle ortasından başlamasın diye altyazı satırlarına oturur.
// Seçilen öneri düzenleyicide açılır ya da hepsi ayrı dikey taslak projeler olur.

export type SuggestReason = "marker" | "highlight" | "chapter" | "speech";

export interface ClipSuggestion extends TimeRange {
  score: number;
  title: string;
  reasons: SuggestReason[];
}

export interface SuggestInput {
  /** Zaman çizelgesinin süresi. */
  duration: number;
  /** İstenen klip süresi (saniye). */
  length: number;
  count: number;
  markers: readonly number[];
  highlights: readonly number[];
  chapters: readonly { start: number; title: string }[];
  /** Otomatik altyazılar (kelime zamanlı). */
  lines: readonly TextItem[];
}

export const SUGGEST_LENGTHS = [15, 30, 60] as const;

const inside = (t: number, r: TimeRange) => t >= r.start && t < r.end;

/** Pencereyi cümle sınırlarına oturtur: başı bir satırın başına, sonu bir satırın sonuna. */
function snapToLines(r: TimeRange, lines: readonly TextItem[], length: number): TimeRange {
  if (lines.length === 0) return r;
  const starts = lines.map((l) => l.start).filter((s) => s >= r.start - 3 && s <= r.start + 1.5);
  const start = starts.length
    ? starts.reduce((a, b) => (Math.abs(b - r.start) < Math.abs(a - r.start) ? b : a))
    : r.start;
  const wanted = start + length;
  const ends = lines.map((l) => l.end).filter((e) => e > start + length * 0.6 && e <= wanted + 2);
  const end = ends.length
    ? ends.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a))
    : wanted;
  return { start, end };
}

function score(r: TimeRange, input: SuggestInput): { score: number; reasons: SuggestReason[] } {
  const reasons = new Set<SuggestReason>();
  let s = 0;
  for (const m of input.markers) {
    if (inside(m, r)) {
      s += 5;
      reasons.add("marker");
    }
  }
  for (const h of input.highlights) {
    if (inside(h, r)) {
      s += 3;
      reasons.add("highlight");
    }
  }
  if (input.chapters.some((c) => Math.abs(c.start - r.start) < 2)) {
    s += 1;
    reasons.add("chapter");
  }
  let spoken = 0;
  for (const line of input.lines) {
    if (line.end <= r.start || line.start >= r.end) continue;
    for (const w of line.words ?? [{ start: line.start, end: line.end }]) {
      spoken += Math.max(0, Math.min(w.end, r.end) - Math.max(w.start, r.start));
    }
    if (line.words?.some((w) => w.emph) || line.emoji || suggestEmoji(line)) s += 0.5;
    if (/[?!]/.test(line.text)) s += 0.5;
  }
  const density = spoken / Math.max(1, r.end - r.start);
  s += density * 3;
  if (density > 0.35) reasons.add("speech");
  return { score: s, reasons: [...reasons] };
}

/** Öneriler (en iyisi önce). Video istenen sürenin 1.5 katından kısaysa öneri yok. */
export function suggestClips(input: SuggestInput): ClipSuggestion[] {
  const { duration, length } = input;
  if (duration < length * 1.5) return [];
  const lines = [...input.lines].sort((a, b) => a.start - b.start);
  const clamp = (start: number) => Math.min(Math.max(0, start), Math.max(0, duration - length));
  // Adaylar: işaret ve heyecanlı an pencerenin üçte birine düşsün; bölüm başı pencere başı.
  const anchors = [
    ...input.markers.map((m) => clamp(m - length * 0.3)),
    ...input.highlights.map((h) => clamp(h - length * 0.3)),
    ...input.chapters.map((c) => clamp(c.start)),
  ];
  // Az aday varsa video yarım pencere arayla taranır (konuşma yoğunluğu seçsin).
  for (let t = 0; t + length <= duration + 1e-6; t += length / 2) anchors.push(t);
  const candidates = anchors.map((start) => {
    const r = snapToLines({ start, end: start + length }, lines, length);
    const range = { start: Math.max(0, r.start), end: Math.min(duration, r.end) };
    return { ...range, ...score(range, { ...input, lines }) };
  });
  candidates.sort((a, b) => b.score - a.score);
  const chosen: ClipSuggestion[] = [];
  for (const c of candidates) {
    if (chosen.length >= input.count) break;
    const overlaps = chosen.some(
      (x) => Math.min(x.end, c.end) - Math.max(x.start, c.start) > length * 0.2,
    );
    if (overlaps || c.end - c.start < length * 0.5) continue;
    const firstLine = lines.find((l) => l.start >= c.start - 0.01 && l.start < c.end);
    const chapter = input.chapters.find((ch) => Math.abs(ch.start - c.start) < 2);
    const title = (firstLine?.text ?? chapter?.title ?? "").trim();
    chosen.push({
      ...c,
      title: title.length > 48 ? `${title.slice(0, 46)}…` : title,
    });
  }
  return chosen;
}

// ——— Düzenleyiciye bağlama ———

interface SuggestState {
  length: number;
  count: number;
  list: ClipSuggestion[] | null;
  setLength: (length: number) => void;
  setList: (list: ClipSuggestion[] | null) => void;
}

export const useSuggestStore = create<SuggestState>((set) => ({
  length: 30,
  count: 5,
  list: null,
  setLength: (length) => set({ length, list: null }),
  setList: (list) => set({ list }),
}));

/** Şimdiki zaman çizelgesinden öneri girdisi. */
function suggestInput(): SuggestInput {
  const { clips, sources, texts } = useEditorStore.getState();
  const byPath = useMarkersStore.getState().byPath;
  const waves = useWaveStore.getState().byToken;
  const first = sources[0]?.id;
  const markers = sources.flatMap((s) =>
    byPath[s.source.path]?.length ? markerTimes(clips, s.id, first, byPath[s.source.path]) : [],
  );
  const highlights = sources.flatMap((s) => {
    const peaks = s.stream ? waves[s.stream.token] : undefined;
    return peaks ? markerTimes(clips, s.id, first, findHighlights(peaks, s.duration, 20, 8)) : [];
  });
  const chapters = sources.flatMap((s) =>
    s.source.info.chapters.flatMap((ch) => {
      const t = timelineTimeOfSource(clips, ch.start, s.id);
      return t === null ? [] : [{ start: t, title: ch.title }];
    }),
  );
  const { length, count } = useSuggestStore.getState();
  return {
    duration: sequenceEnd(clips),
    length,
    count,
    markers,
    highlights,
    chapters,
    lines: texts.filter((t) => t.auto && t.text.trim()),
  };
}

export function makeSuggestions(): ClipSuggestion[] {
  const list = suggestClips(suggestInput());
  useSuggestStore.getState().setList(list);
  return list;
}

/** Öneri dışındaki her şeyi keser (yalnız o klip kalır; geri alınabilir). */
export function keepOnly(range: TimeRange) {
  const editor = useEditorStore.getState();
  const end = sequenceEnd(editor.clips);
  const result = cutTimeline(
    editor,
    [
      { start: 0, end: range.start },
      { start: range.end, end: Math.max(end, range.end) + 1 },
    ],
    newClipId,
  );
  editor.applyEdit({
    clips: result.clips,
    texts: result.texts,
    images: result.images,
    blurs: result.blurs,
    effects: result.effects,
    music: result.music,
  });
  useSuggestStore.getState().setList(null);
}

/** Her öneriyi ayrı dikey (9:16) taslak proje olarak seçilen klasöre kaydeder. */
export async function saveDrafts(list: readonly ClipSuggestion[]): Promise<number> {
  if (list.length === 0) return 0;
  const dir = await chooseDownloadDir();
  if (!dir) return 0;
  const base = currentProjectData();
  const end = sequenceEnd(base.clips);
  const sep = /[\\/]$/.test(dir) ? "" : "\\";
  let saved = 0;
  for (const [i, s] of list.entries()) {
    const cut = cutTimeline(
      base,
      [
        { start: 0, end: s.start },
        { start: s.end, end: Math.max(end, s.end) + 1 },
      ],
      newClipId,
    );
    const name = `${base.name} - ${i + 1}`.replace(/[<>:"/\\|?*]/g, "");
    const data = {
      ...base,
      name,
      clips: cut.clips,
      texts: cut.texts,
      images: cut.images,
      blurs: cut.blurs,
      effects: cut.effects,
      music: cut.music,
      exportOptions: { ...base.exportOptions, frame: "9:16" },
      projectPath: null,
      dirty: false,
    };
    await projectSave(`${dir}${sep}${name}.downkit`, serializeProject(data));
    saved += 1;
  }
  return saved;
}
