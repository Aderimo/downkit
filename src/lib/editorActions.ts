import {
  fitView,
  newClipId,
  sourceChapters,
  sourceDurationOf,
  timelineExtent,
  useEditorStore,
} from "../store/editorStore";
import { player, usePlayerStore } from "../store/playerStore";
import {
  applyTransitionAt,
  clipAt,
  clipEnd,
  closeGaps,
  deleteClips,
  duplicateClip,
  keepOnly,
  sequenceEnd,
  setFade,
  setSpeed,
  setVolume,
  setLook,
  setFadeWhite,
  clipVolume,
  splitAt,
  splitAtChapters,
  timelineTimeOfSource,
  trimEnd,
  trimStart,
  type SeqClip,
  type TransitionEdge,
  type TransitionKind,
} from "./sequence";
import { normalizeLook, type ClipLook } from "./clipLook";
import { zoomView } from "./timeline";
import { deleteTexts, newText } from "./textItems";
import type { TextStyle } from "./editorPresets";
import type { SubtitleCue } from "./subtitles";
import i18n from "../i18n";
import { playTimelineRange, refreshPlayback, seekTimeline, togglePlayback } from "./sequencePlayer";
import type { ShortcutAction } from "./shortcuts";

// Klip Düzenleyici komutları: araç çubuğu, sağ tık menüsü ve klavye kısayolları
// aynı işlevleri çağırır.

const editor = () => useEditorStore.getState();
const playhead = () => usePlayerStore.getState().currentTime;

function change(fn: (clips: SeqClip[]) => SeqClip[]) {
  editor().apply(fn);
  refreshPlayback();
}

/** Seçili (yoksa imleçteki) klipleri sessize alır; hepsi sessizse sesi açar. */
export function toggleMuteSelected() {
  const list = targets();
  if (list.length === 0) return;
  const allMuted = list.every((c) => clipVolume(c) === 0);
  change((clips) =>
    setVolume(
      clips,
      list.map((c) => c.id),
      allMuted ? 1 : 0,
    ),
  );
}

export function setClipVolume(id: string, volume: number) {
  change((clips) => setVolume(clips, [id], volume));
}

export function setClipFade(id: string, edge: "in" | "out", seconds: number) {
  change((clips) => setFade(clips, id, edge, seconds));
}

/** Tüm klipleri videonun bölümlerinden böler (parçalar bölüm adını alır).
 * Çoklu kaynakta yalnızca önizlenen kaynağın klipleri bölünür. */
export function splitByChapters() {
  const chapters = sourceChapters(editor().source);
  if (chapters.length === 0) return;
  const sourceId = editor().activeSourceId ?? undefined;
  change((clips) => splitAtChapters(clips, chapters, newClipId, sourceId));
}

/** İmleci, kaynaktaki bu anın zaman çizelgesindeki yerine götürür. */
export function jumpToSource(sourceTime: number): boolean {
  const t = timelineTimeOfSource(
    editor().clips,
    sourceTime,
    editor().activeSourceId ?? undefined,
  );
  if (t === null) return false;
  seekTimeline(t);
  return true;
}

/** İşlem yapılacak klipler: seçim varsa seçili olanlar, yoksa imleçteki klip. */
function targets(): SeqClip[] {
  const { clips, selectedIds } = editor();
  const selected = clips.filter((c) => selectedIds.includes(c.id));
  if (selected.length > 0) return selected;
  const here = clipAt(clips, playhead());
  return here ? [here] : [];
}

/** Değişen klip imlecin altında değilse imleç onun başına gider: filtre, renk,
 * efekt, hız ya da geçiş önizlemede hemen görünsün. (İmleç başka bir klipteyken
 * ayar "çalışmıyor" gibi görünüyordu.) Oynatma sürerken dokunulmaz. */
function showInPreview(ids: readonly string[]) {
  if (usePlayerStore.getState().playing) return;
  const { clips } = editor();
  const t = playhead();
  const list = clips.filter((c) => ids.includes(c.id));
  if (list.length === 0 || list.some((c) => t >= c.start && t < clipEnd(c))) return;
  const first = list.reduce((a, b) => (b.start < a.start ? b : a));
  seekTimeline(first.start);
}

export const togglePlay = togglePlayback;

export function stepSeconds(delta: number) {
  seekTimeline(playhead() + delta);
}

/** Bir kare ileri/geri; kare hızı bilinmiyorsa 30 fps varsayılır. Oynatma durur. */
export function stepFrame(direction: -1 | 1, fps: number | null) {
  player()?.pause();
  stepSeconds(direction / (fps && fps > 0 ? fps : 30));
}

export function toStart() {
  seekTimeline(0);
}

export function toEnd() {
  seekTimeline(sequenceEnd(editor().clips));
}

/** Oynatma imlecinden böler (S). */
export function splitAtPlayhead() {
  change((clips) => splitAt(clips, playhead(), editor().selectedIds, newClipId));
}

/** İmleçte 3 saniyelik bir yazı ekler ve düzenlemek için seçer. */
export function addText() {
  const id = newClipId();
  editor().applyTexts((texts) => [...texts, newText(id, playhead(), i18n.t("editor.textDefault"))]);
  editor().selectText(id);
  editor().setPanelTab("clip");
}

export function deleteSelected() {
  // Seçili bir yazı varsa önce o silinir.
  const textId = editor().selectedTextId;
  if (textId) {
    editor().applyTexts((texts) => deleteTexts(texts, [textId]));
    editor().selectText(null);
    return;
  }
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) => deleteClips(clips, ids));
  editor().select([]);
}

export function keepOnlySelected() {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) => keepOnly(clips, ids));
}

export function duplicateSelected() {
  const [first] = targets();
  if (!first) return;
  const id = newClipId();
  change((clips) => duplicateClip(clips, first.id, id));
  editor().select([id]);
}

/** Q: klibin imleçten önceki kısmını atar. */
export function trimStartToPlayhead() {
  const t = playhead();
  const [clip] = targets().filter((c) => t > c.start && t < clipEnd(c));
  if (clip) change((clips) => trimStart(clips, clip.id, t));
}

/** W: klibin imleçten sonraki kısmını atar. */
export function trimEndToPlayhead() {
  const t = playhead();
  const [clip] = targets().filter((c) => t > c.start && t < clipEnd(c));
  if (clip)
    change((clips) =>
      trimEnd(clips, clip.id, t, sourceDurationOf(editor().sources, clip.sourceId)),
    );
}

export function setClipSpeed(id: string, speed: number) {
  change((clips) => setSpeed(clips, id, speed));
  showInPreview([id]);
}

export function closeAllGaps() {
  change(closeGaps);
}

/** Kaynağın tamamını ana izin sonuna yeniden ekler (silinen kısımları geri almak için). */
export function appendWholeSource() {
  const st = editor();
  const sourceId = st.activeSourceId ?? st.sources[0]?.id;
  const duration = sourceDurationOf(st.sources, sourceId);
  change((clips) => {
    const end = clips.filter((c) => c.track === 0).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    return [
      ...clips,
      {
        id: newClipId(),
        sourceId,
        track: 0,
        start: end,
        srcStart: 0,
        srcEnd: duration,
        speed: 1,
        name: "",
      },
    ];
  });
}

export function playClip(id: string) {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip) return;
  editor().select([id]);
  playTimelineRange(clip.start, clipEnd(clip));
}

export function undo() {
  editor().undo();
  refreshPlayback();
}

export function redo() {
  editor().redo();
  refreshPlayback();
}

export function selectAll() {
  editor().select(editor().clips.map((c) => c.id));
}

export function deselect() {
  editor().select([]);
}

export function zoomTimeline(factor: number) {
  const { view, clips, duration, setView } = editor();
  const t = playhead();
  const anchor = t >= view.start && t <= view.end ? t : (view.start + view.end) / 2;
  setView(zoomView(view, factor, anchor, timelineExtent(clips, duration)));
}

export function zoomToFit() {
  const { clips, duration, setView } = editor();
  setView(fitView(clips, duration));
}

const ZOOM_STEP = 1.6;

/** Kısayol eylemini çalıştırır; tanınmayan eylemde false. */
export function runShortcut(action: ShortcutAction, fps: number | null): boolean {
  switch (action) {
    case "playPause":
      togglePlay();
      break;
    case "back1":
      stepSeconds(-1);
      break;
    case "forward1":
      stepSeconds(1);
      break;
    case "back5":
      stepSeconds(-5);
      break;
    case "forward5":
      stepSeconds(5);
      break;
    case "prevFrame":
      stepFrame(-1, fps);
      break;
    case "nextFrame":
      stepFrame(1, fps);
      break;
    case "toStart":
      toStart();
      break;
    case "toEnd":
      toEnd();
      break;
    case "split":
      splitAtPlayhead();
      break;
    case "deleteClip":
      deleteSelected();
      break;
    case "duplicate":
      duplicateSelected();
      break;
    case "toggleMute":
      toggleMuteSelected();
      break;
    case "trimStart":
      trimStartToPlayhead();
      break;
    case "trimEnd":
      trimEndToPlayhead();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "selectAll":
      selectAll();
      break;
    case "deselect":
      deselect();
      break;
    case "zoomIn":
      zoomTimeline(1 / ZOOM_STEP);
      break;
    case "zoomOut":
      zoomTimeline(ZOOM_STEP);
      break;
    case "zoomFit":
      zoomToFit();
      break;
    default:
      return false;
  }
  return true;
}

// ——— Görünüm (filtre, renk, efekt) ———

/** Seçili (yoksa imleçteki) kliplere görünüm uygular; tek geri alma adımı. */
export function applyLook(patch: Partial<ClipLook>) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) => setLook(clips, ids, patch));
  showInPreview(ids);
}

/** Kaydırıcı sürüklenirken: bırakınca tek geri alma adımı olur (beginDrag/endDrag). */
export function slideLook(patch: Partial<ClipLook>) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  const store = editor();
  const origin = store.dragOrigin?.clips ?? store.clips;
  store.dragTo(setLook(origin, ids, patch));
  refreshPlayback();
  showInPreview(ids);
}

/** Aynı görünümü bütün kliplere uygular. */
export function applyLookToAll(look: ClipLook) {
  change((clips) => clips.map((c) => ({ ...c, look: normalizeLook(look) })));
}

/** Görünümün uygulanacağı klip: seçili olan, yoksa imleçteki. */
export function lookTarget(): SeqClip | null {
  return targets()[0] ?? null;
}

/** Açılma/kararma rengini seçili kliplerde değiştirir. */
export function setSelectedFadeWhite(white: boolean) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) => setFadeWhite(clips, ids, white));
}

// ——— Sol panel: metin şablonu, geçiş, altyazı ———

/** Şablon stiliyle imleçte yeni yazı ekler. */
export function addStyledText(text: string, style: TextStyle, seconds?: number) {
  const id = newClipId();
  const base = newText(id, playhead(), text);
  editor().applyTexts((texts) => [
    ...texts,
    { ...base, ...style, end: seconds ? base.start + seconds : base.end },
  ]);
  editor().selectText(id);
}

export type { TransitionEdge, TransitionKind };

/** Sürükle-bırak: geçiş bırakıldığı uca (ve oradaki bitişik klibe) uygulanır. */
export function dropTransition(
  id: string,
  kind: TransitionKind,
  edge: TransitionEdge,
  seconds = 0.8,
) {
  change((clips) => applyTransitionAt(clips, id, kind, edge, seconds));
  showInPreview([id]);
}

/** Seçili (yoksa imleçteki) kliplere geçiş uygular: baştan açılma, sonda kararma. */
export function applyTransition(kind: TransitionKind, seconds = 0.8) {
  const list = targets();
  if (list.length === 0) return;
  const ids = new Set(list.map((c) => c.id));
  // Seçimdeki her klibe tek tek uygulanır ama tek geri alma adımı olsun diye toplu:
  change((clips) =>
    clips.map((c) => {
      if (!ids.has(c.id)) return c;
      switch (kind) {
        case "fadeBlack":
          return { ...c, fadeIn: seconds, fadeOut: seconds, fadeWhite: false };
        case "fadeWhite":
          return { ...c, fadeIn: seconds, fadeOut: seconds, fadeWhite: true };
        case "fadeIn":
          return { ...c, fadeIn: seconds };
        case "fadeOut":
          return { ...c, fadeOut: seconds };
      }
    }),
  );
  showInPreview([...ids]);
}

/** Altyazı satırlarını yazı katmanı olarak ekler. Zamanlar kaynağa göredir;
 * klipler taşındıysa zaman çizelgesindeki yerine çevrilir. Eklenen sayı döner. */
export function importSubtitleCues(cues: SubtitleCue[], style: TextStyle): number {
  const { clips } = editor();
  const sourceId = editor().activeSourceId ?? undefined;
  const items = cues.flatMap((cue) => {
    const start = timelineTimeOfSource(clips, cue.start, sourceId) ?? cue.start;
    const length = Math.max(0.3, cue.end - cue.start);
    const base = newText(newClipId(), start, cue.text);
    return [{ ...base, ...style, end: start + length }];
  });
  if (items.length === 0) return 0;
  editor().applyTexts((texts) => [...texts, ...items]);
  return items.length;
}
