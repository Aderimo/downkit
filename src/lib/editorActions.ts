import { cutTimeline, mainTrackGaps, mapTime, mergeRanges, type TimeRange } from "./rangeCut";
import { applySpeedCurve, type SpeedPoint } from "./speedCurve";
import { clampStrength, type MotionId, type TransitionStyle } from "./clipFx";
import {
  groupWords,
  placeChunks,
  usedRanges,
  type CaptionMode,
  type CaptionWord,
} from "./autoCaptions";
import { captionsTranscribe } from "./tauri-api";
import type { TextItem } from "./textItems";
import { clampXfadeSeconds, XFADE_DEFAULT_SECONDS, type XfadeKind } from "./xfade";
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
  clipFades,
  clipEnd,
  deleteClips,
  duplicateClip,
  keepOnly,
  moveClip,
  sequenceEnd,
  setFade,
  setSpeed,
  setVolume,
  setLook,
  clipVolume,
  flatten,
  splitAt,
  splitAtChapters,
  speedRamp,
  type SpeedRamp,
  timelineTimeOfSource,
  trimEnd,
  trimStart,
  type SeqClip,
  type TransitionEdge,
  type TransitionKind,
  FREEZE_SECONDS,
  insertFreeze,
  MAX_REVERSE_SECONDS,
  setReverse,
} from "./sequence";
import { normalizeLook, type ClipLook } from "./clipLook";
import { zoomView } from "./timeline";
import { deleteTexts, newText } from "./textItems";
import type { TextStyle } from "./editorPresets";
import type { SubtitleCue } from "./subtitles";
import i18n from "../i18n";
import { openProject, saveProject } from "./project";
import { currentCaptionLook, useCaptionStudio } from "./captionActions";
import { applyAutoEmoji } from "./captionEmoji";
import { applyLook as applyTextLook } from "./captionPresets";
import { usePalette } from "./editorPanel";
import { detachAudio, isDetached, reattachAudio } from "./audioDetach";
import { copyClips, groupClips, pasteClips, ungroupClips } from "./clipGroups";
import {
  removeBlur,
  removeImage,
  removeMusic,
  useBlockSelection,
  useBlurSelection,
  useLayerSelection,
  type BlockRef,
} from "./layerActions";
import { nextId } from "./layerActions";
import { playTimelineRange, refreshPlayback, seekTimeline, togglePlayback } from "./sequencePlayer";
import type { ShortcutAction } from "./shortcuts";
import { removeEffect, useEffectSelection } from "./effectActions";

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

/** Sesteki fan/uğultu gürültüsünü azaltma (dışa aktarımda uygulanır). */
export function setClipDenoise(id: string, denoise: boolean) {
  change((clips) =>
    clips.map((c) => (c.id === id ? { ...c, denoise: denoise ? true : undefined } : c)),
  );
}

export function setClipMotionBlur(id: string, motionBlur: boolean) {
  change((clips) =>
    clips.map((c) => (c.id === id ? { ...c, motionBlur: motionBlur ? true : undefined } : c)),
  );
}

/** İmleçteki (seçiliyse seçili) klipte o kareyi 2 sn dondurur. */
export function insertFreezeFrame(seconds = FREEZE_SECONDS): boolean {
  const t = playhead();
  const clip = targets().find((c) => t >= c.start - 1e-6 && t <= clipEnd(c) + 1e-6);
  if (!clip || clip.freezeAt !== undefined) return false;
  change((clips) => insertFreeze(clips, clip.id, t, seconds, newClipId));
  return true;
}

/** Ters oynatma; klip çok uzunsa açılmaz (false). */
export function setClipReverse(id: string, on: boolean): boolean {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip) return false;
  if (on && clip.srcEnd - clip.srcStart > MAX_REVERSE_SECONDS) return false;
  change((clips) => setReverse(clips, id, on));
  return true;
}

/** Klibe hız eğrisi uygular (klip sabit hızlı parçalara bölünür). */
export function applyClipSpeedCurve(id: string, points: readonly SpeedPoint[]): boolean {
  if (!editor().clips.some((c) => c.id === id)) return false;
  change((clips) => applySpeedCurve(clips, id, points, newClipId));
  return true;
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
  const t = timelineTimeOfSource(editor().clips, sourceTime, editor().activeSourceId ?? undefined);
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

/**
 * Delete: yalnızca gerçekten seçili olanı siler (seçili efekt / gizleme bloğu, yazı ya da
 * klipler; hiçbir şey seçili değilse hiçbir şey). Ana izde (`ripple`) sonraki klipler
 * boşluğu kapatır; silinen klibe bağlı ayrılmış ses de gider. Tek geri alma adımı.
 */
export function deleteSelected(ripple = true) {
  // Çoklu seçim (Ctrl+A / kutu): seçili klipler ve bloklar tek adımda silinir.
  const blocks = useBlockSelection.getState().blocks;
  if (blocks.length > 0) {
    editor().applyEdit(removeClipsAndRipple(editor().selectedIds, blocks, ripple));
    useBlockSelection.getState().set([]);
    editor().select([]);
    refreshPlayback();
    return;
  }
  // Efekt şeridinde seçili blok varsa o silinir (imleçteki klip değil).
  const effectId = useEffectSelection.getState().id;
  if (effectId && editor().effects.some((e) => e.id === effectId)) {
    removeEffect(effectId);
    return;
  }
  const blurId = useBlurSelection.getState().id;
  if (blurId && editor().blurs.some((b) => b.id === blurId)) {
    removeBlur(blurId);
    return;
  }
  const layer = useLayerSelection.getState();
  if (layer.id && layer.kind) {
    if (layer.kind === "music") removeMusic(layer.id);
    else removeImage(layer.id);
    layer.select(null, null);
    refreshPlayback();
    return;
  }
  // Seçili bir yazı varsa önce o silinir.
  const textId = editor().selectedTextId;
  if (textId) {
    editor().applyTexts((texts) => deleteTexts(texts, [textId]));
    editor().selectText(null);
    return;
  }
  const ids = editor().selectedIds;
  if (ids.length === 0) return;
  editor().applyEdit(removeClipsAndRipple(ids, [], ripple));
  refreshPlayback();
  editor().select([]);
}

/**
 * Klipleri (ve verilen blokları) siler; `ripple` ise ana izden silinen aralıklar bütün
 * katmanlardan kesilir — yazılar, müzik, efekt, gizleme ve üst iz klipleri de kayar,
 * boşluk kapanır. Silinen klibe bağlı ayrılmış ses de gider.
 */
function removeClipsAndRipple(
  ids: readonly string[],
  blocks: readonly BlockRef[],
  ripple: boolean,
) {
  const s = editor();
  const has = (kind: string, id: string) => blocks.some((b) => b.kind === kind && b.id === id);
  const removedMain = s.clips.filter((c) => ids.includes(c.id) && c.track === 0);
  const base = {
    clips: deleteClips(s.clips, ids),
    texts: s.texts.filter((x) => !has("text", x.id)),
    music: s.music.filter(
      (m) => !has("music", m.id) && !(m.linkedClipId && ids.includes(m.linkedClipId)),
    ),
    images: s.images.filter((x) => !has("image", x.id)),
    blurs: s.blurs.filter((x) => !has("blur", x.id)),
    effects: s.effects.filter((x) => !has("effect", x.id)),
  };
  if (!ripple || removedMain.length === 0) return base;
  // Kalan ana iz klipleriyle örtüşmeyen silinmiş aralıklar kesilir.
  return rippleCut(
    base,
    removedMain.map((c) => ({ start: c.start, end: clipEnd(c) })),
  );
}

/** Zaman aralıklarını ana izden ve katmanlardan keser (sonrası kayar); üst iz klipleri
 * kesilmez, yalnızca kayar (bindirme korunur). */
function rippleCut<T extends Parameters<typeof cutTimeline>[0]>(state: T, raw: TimeRange[]) {
  const ranges = mergeRanges(raw);
  const upper = state.clips.filter((c) => c.track > 0);
  const { removed: _removed, ...cut } = cutTimeline(
    { ...state, clips: state.clips.filter((c) => c.track === 0) },
    ranges,
    newClipId,
  );
  void _removed;
  return {
    ...cut,
    clips: [...cut.clips, ...upper.map((c) => ({ ...c, start: mapTime(ranges, c.start) }))],
  };
}

export function keepOnlySelected() {
  const ids = editor().selectedIds;
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
  const s = editor();
  const gaps = mainTrackGaps(s.clips);
  if (gaps.length === 0) return;
  s.applyEdit(rippleCut(s, gaps));
  refreshPlayback();
}

/** Kaynağın tamamını ana izin sonuna yeniden ekler (silinen kısımları geri almak için). */
export function appendWholeSource(sourceId?: string) {
  const st = editor();
  const targetId = sourceId ?? st.activeSourceId ?? st.sources[0]?.id;
  const duration = sourceDurationOf(st.sources, targetId);
  change((clips) => {
    const end = clips.filter((c) => c.track === 0).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    return [
      ...clips,
      {
        id: newClipId(),
        sourceId: targetId,
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

/** Medya paneli kartından zaman çizelgesine sürüklenen kaynağın MIME türü. */
export const SOURCE_DRAG_MIME = "application/x-downkit-source";

/** Panelden zaman çizelgesine bırakılan kaynağın tamamını bırakılan yere ekler;
 * doluysa en yakın boşluğa yerleşir (klip taşımayla aynı kurallar). */
export function dropSourceClip(sourceId: string, at: number, track: number) {
  const st = editor();
  const duration = sourceDurationOf(st.sources, sourceId);
  if (!(duration > 0)) return;
  change((clips) => {
    const id = newClipId();
    const clip: SeqClip = {
      id,
      sourceId,
      track,
      start: Math.max(0, at),
      srcStart: 0,
      srcEnd: duration,
      speed: 1,
      name: "",
    };
    return moveClip([...clips, clip], id, Math.max(0, at), track);
  });
  seekTimeline(Math.max(0, at));
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

/** Ctrl+A: zaman çizelgesindeki her şey (klipler, yazılar, müzik, resim, gizleme, efekt). */
export function selectAll() {
  const s = editor();
  s.select(s.clips.map((c) => c.id));
  useBlockSelection
    .getState()
    .set([
      ...s.texts.map((x) => ({ kind: "text" as const, id: x.id })),
      ...s.music.map((x) => ({ kind: "music" as const, id: x.id })),
      ...s.images.map((x) => ({ kind: "image" as const, id: x.id })),
      ...s.blurs.map((x) => ({ kind: "blur" as const, id: x.id })),
      ...s.effects.map((x) => ({ kind: "effect" as const, id: x.id })),
    ]);
}

export function deselect() {
  useBlockSelection.getState().set([]);
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
    case "rippleDelete":
      rippleDeleteSelected();
      break;
    case "copyClips":
      copySelected();
      break;
    case "cutClips":
      cutSelected();
      break;
    case "pasteClips":
      return pasteAtPlayhead();
    case "groupClips":
      groupSelected();
      break;
    case "ungroupClips":
      ungroupSelected();
      break;
    case "closeGaps":
      closeAllGaps();
      break;
    case "detachAudio":
      toggleAudioLink();
      break;
    case "commandPalette":
      usePalette.getState().setOpen(true);
      break;
    case "saveProject":
      void saveProject();
      break;
    case "saveProjectAs":
      void saveProject({ as: true });
      break;
    case "openProject":
      void openProject().then(() => refreshPlayback());
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

/** Her hedef klibin KENDİ görünümünden değişikliği hesaplar (çoklu seçimde bir
 * klibin renk düzeltmesi ya da efektleri öbürlerinin üzerine yazılmasın). */
export function applyLookWith(fn: (look: ClipLook) => Partial<ClipLook>, live = false) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  const store = editor();
  const update = (clips: SeqClip[]) =>
    clips.map((c) =>
      ids.includes(c.id)
        ? { ...c, look: normalizeLook({ ...normalizeLook(c.look), ...fn(normalizeLook(c.look)) }) }
        : c,
    );
  if (live) {
    store.dragTo(update(store.dragOrigin?.clips ?? store.clips));
    refreshPlayback();
  } else change(update);
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

/** Konuşmayı yazıya döküp zaman çizelgesine altyazı olarak ekler. Önceki otomatik
 * altyazılar yenileriyle değişir; elle yazılanlara dokunulmaz. Eklenen sayı döner. */
export async function generateCaptions(options: {
  language: string;
  model: "base" | "small";
  /** Verilmezse stüdyodaki kelime sayısı: 1 ise kelime kelime. */
  mode?: CaptionMode;
}): Promise<number> {
  const studio = useCaptionStudio.getState();
  const mode = options.mode ?? (studio.words <= 1 ? "word" : "line");
  const look = currentCaptionLook();
  // Görünen parçalar: üst katmanın örttüğü yerde alttaki klibin konuşması yazılmaz.
  const visibleNow = () => {
    const { clips, tracks } = editor();
    return flatten(clips, tracks).map((s) => ({
      sourceId: s.sourceId,
      start: s.tStart,
      srcStart: s.srcStart,
      srcEnd: s.srcEnd,
      speed: s.speed,
      still: s.freezeAt !== undefined || s.reverse === true,
    }));
  };
  const before = visibleNow();
  const { sources } = editor();
  const first = sources[0]?.id;
  // Önce bütün kaynaklar yazıya dökülür (kaynak saniyesiyle); yerleşim en sonda, o anki
  // kliplere göre yapılır: bu sırada yapılan kurgu altyazıları eski yere koymaz.
  const transcribed: { id: string; words: CaptionWord[] }[] = [];
  for (const entry of sources) {
    if (entry.source.info.audioCodec === null) continue;
    const ranges = usedRanges(before, entry.id, first);
    if (ranges.length === 0) continue;
    const words = await captionsTranscribe(
      entry.source.path,
      ranges,
      options.language,
      options.model,
    );
    transcribed.push({ id: entry.id, words });
  }
  const visible = visibleNow();
  const items: TextItem[] = [];
  for (const { id, words } of transcribed) {
    const chunks = placeChunks(groupWords(words, mode, studio.words), visible, id, first);
    for (const c of chunks) {
      items.push({
        ...applyTextLook(newText(newClipId(), c.start, c.text), look),
        end: c.end,
        words: c.words,
        auto: true,
        preset: studio.presetId,
      });
    }
  }
  // Emoji açıksa anahtar kelimelere göre (para 💰, ateş 🔥…).
  const placed = studio.emoji ? applyAutoEmoji(items) : items;
  editor().applyTexts((texts) => [...texts.filter((x) => !x.auto), ...placed]);
  return items.length;
}

/** Otomatik eklenen altyazıları siler. */
export function removeAutoCaptions() {
  editor().applyTexts((texts) => texts.filter((x) => !x.auto));
}

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

/** Seçili (yoksa imleçteki) kliplere hareket uygular: yakınlaştır, kaydır… */
export function applyMotion(motion: MotionId, strength?: number) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) =>
    clips.map((c) =>
      ids.includes(c.id)
        ? motion === "none"
          ? { ...c, motion: undefined, motionStrength: undefined }
          : { ...c, motion, motionStrength: clampStrength(strength ?? c.motionStrength) }
        : c,
    ),
  );
  showInPreview(ids);
}

/** Hareketin şiddeti (kaydırıcı): bırakınca tek geri alma adımı. */
export function slideMotionStrength(strength: number) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  const store = editor();
  const origin = store.dragOrigin?.clips ?? store.clips;
  store.dragTo(
    origin.map((c) =>
      ids.includes(c.id) && c.motion ? { ...c, motionStrength: clampStrength(strength) } : c,
    ),
  );
  refreshPlayback();
}

/** Geçiş stili: klibin başına ve sonuna uygulanır. Geçiş süresi yoksa 0,6 sn
 * eklenir ki stil hemen görünsün. */
export function applyTransitionStyle(style: TransitionStyle, seconds = 0.6) {
  const ids = targets().map((c) => c.id);
  if (ids.length === 0) return;
  change((clips) =>
    clips.map((c) => {
      if (!ids.includes(c.id)) return c;
      const [fadeIn, fadeOut] = clipFades(c);
      const timed = fadeIn > 0 || fadeOut > 0 ? {} : { fadeIn: seconds, fadeOut: seconds };
      return {
        ...c,
        ...timed,
        transition: style === "fade" ? undefined : style,
        ...(style === "fade" ? {} : { fadeWhite: false }),
      };
    }),
  );
  showInPreview(ids);
}

// ——— Klipler arası geçişler (xfade) ———

/** Bitişik sayılma payı (bölünmüş iki klibin arası tam sıfır olmayabilir). */
const CUT_TOUCH = 0.05;

/** Aynı izde `clip`ten hemen sonra başlayan klip. */
export function nextAdjacent(clips: readonly SeqClip[], clip: SeqClip): SeqClip | undefined {
  return clips.find(
    (c) =>
      c.id !== clip.id && c.track === clip.track && Math.abs(c.start - clipEnd(clip)) < CUT_TOUCH,
  );
}

function prevAdjacent(clips: readonly SeqClip[], clip: SeqClip): SeqClip | undefined {
  return clips.find(
    (c) =>
      c.id !== clip.id && c.track === clip.track && Math.abs(clipEnd(c) - clip.start) < CUT_TOUCH,
  );
}

/** Geçişin konacağı kesim (çıkan klip): imlece en yakın kesim. Seçili klip dikkate
 * alınmaz (karta tıklamak seçili klibe değil, imlecin yanındaki kesime koyar). */
export function xfadeTargetCut(): SeqClip | null {
  return cutNear(editor().clips, playhead());
}

/** `t` anına en yakın kesimin çıkan klibi (bitişik iki klip; yoksa null). */
export function cutNear(clips: readonly SeqClip[], t: number): SeqClip | null {
  let best: SeqClip | null = null;
  let distance = Infinity;
  for (const c of clips) {
    if (!nextAdjacent(clips, c)) continue;
    const d = Math.abs(clipEnd(c) - t);
    if (d < distance) {
      best = c;
      distance = d;
    }
  }
  return best;
}

/** Geçişi başka bir kesime taşır (süresi korunur; tek geri alma adımı). */
export function moveXfade(fromId: string, toId: string): boolean {
  if (fromId === toId) return false;
  const { clips } = editor();
  const from = clips.find((c) => c.id === fromId);
  const to = clips.find((c) => c.id === toId);
  if (!from?.xfade || !to || !nextAdjacent(clips, to)) return false;
  const xfade = from.xfade;
  change((list) =>
    list.map((c) => {
      if (c.id === toId) return { ...c, xfade };
      if (c.id === fromId) {
        const next = { ...c };
        delete next.xfade;
        return next;
      }
      return c;
    }),
  );
  editor().select([toId]);
  previewXfade(toId);
  return true;
}

/** Görünen kliplerin imlece en yakın ucu: hangi klibin başı ya da sonu. */
export function edgeNear(t: number): { clip: SeqClip; edge: "start" | "end" } | null {
  const { clips, tracks } = editor();
  let best: { clip: SeqClip; edge: "start" | "end" } | null = null;
  let distance = Infinity;
  for (const c of clips) {
    if (tracks[c.track]?.hidden) continue;
    for (const edge of ["start", "end"] as const) {
      const d = Math.abs((edge === "start" ? c.start : clipEnd(c)) - t);
      if (d < distance) {
        best = { clip: c, edge };
        distance = d;
      }
    }
  }
  return best;
}

/**
 * Giriş / çıkış geçişi: imlece en yakın klip ucuna konur (seçili klibe değil). Açılma
 * kartları başa, kararma sona; stiller (yakınlaşarak, dönerek…) en yakın uca süre verir.
 */
export function applyEdgeTransition(
  item: TransitionKind | TransitionStyle,
  seconds = 0.8,
): { clipId: string; edge: "start" | "end" } | null {
  const t = playhead();
  const near = edgeNear(t);
  if (!near) return null;
  const { clips } = editor();
  // Açılma her zaman bir başa, kararma bir sona konur.
  const pick = (edge: "start" | "end") => {
    let best: SeqClip | null = null;
    let d = Infinity;
    for (const c of clips) {
      const x = Math.abs((edge === "start" ? c.start : clipEnd(c)) - t);
      if (x < d) {
        best = c;
        d = x;
      }
    }
    return best;
  };
  const target =
    item === "fadeIn"
      ? { clip: pick("start"), edge: "start" as const }
      : item === "fadeOut"
        ? { clip: pick("end"), edge: "end" as const }
        : near;
  if (!target.clip) return null;
  const id = target.clip.id;
  const edge = target.edge;
  if (item === "fadeIn" || item === "fadeOut" || item === "fadeBlack" || item === "fadeWhite") {
    const white = item === "fadeWhite";
    change((list) =>
      list.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              ...(edge === "start" ? { fadeIn: seconds } : { fadeOut: seconds }),
              fadeWhite: white,
              transition: undefined,
            },
      ),
    );
  } else {
    change((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        const [fadeIn, fadeOut] = clipFades(c);
        return {
          ...c,
          ...(edge === "start" && fadeIn <= 0 ? { fadeIn: seconds } : {}),
          ...(edge === "end" && fadeOut <= 0 ? { fadeOut: seconds } : {}),
          transition: item === "fade" ? undefined : item,
          fadeWhite: false,
        };
      }),
    );
  }
  showInPreview([id]);
  return { clipId: id, edge };
}

/** Geçişi kesimden biraz önceden başlatıp oynatır: etkisi hemen görülsün. */
export function previewXfade(fromId: string) {
  const clip = editor().clips.find((c) => c.id === fromId);
  if (!clip?.xfade) return;
  const cut = clipEnd(clip);
  const half = clip.xfade.duration / 2;
  playTimelineRange(Math.max(0, cut - half - 0.8), cut + half + 0.8);
}

function setXfade(fromId: string, kind: XfadeKind, seconds?: number): boolean {
  const clip = editor().clips.find((c) => c.id === fromId);
  if (!clip) return false;
  const duration = clampXfadeSeconds(seconds ?? clip.xfade?.duration ?? XFADE_DEFAULT_SECONDS);
  change((clips) => clips.map((c) => (c.id === fromId ? { ...c, xfade: { kind, duration } } : c)));
  return true;
}

/** Paneldeki geçişe tıklama: seçili klibin (yoksa imlecin) kesimine uygular. */
export function applyXfade(kind: XfadeKind): boolean {
  const from = xfadeTargetCut();
  if (!from || !setXfade(from.id, kind)) return false;
  previewXfade(from.id);
  return true;
}

/** Sürükle-bırak: klibin başına bırakılırsa önceki kesime, sonuna/ortasına
 * bırakılırsa sonraki kesime (bitişik klip yoksa öbür uca) konur. */
export function dropXfade(clipId: string, kind: XfadeKind, edge: TransitionEdge): boolean {
  const { clips } = editor();
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return false;
  const prev = prevAdjacent(clips, clip);
  const next = nextAdjacent(clips, clip);
  const from = edge === "start" ? (prev ?? (next ? clip : null)) : next ? clip : (prev ?? null);
  if (!from || !setXfade(from.id, kind)) return false;
  editor().select([from.id]);
  previewXfade(from.id);
  return true;
}

/** Belirli bir kesime (çıkan klip) geçiş koyar; klip yoksa false. */
export function setXfadeOn(fromId: string, kind: XfadeKind): boolean {
  return setXfade(fromId, kind);
}

export function setXfadeSeconds(fromId: string, seconds: number) {
  const clip = editor().clips.find((c) => c.id === fromId);
  if (!clip?.xfade) return;
  setXfade(fromId, clip.xfade.kind, seconds);
}

export function removeXfade(fromId: string) {
  change((clips) => clips.map((c) => (c.id === fromId ? { ...c, xfade: undefined } : c)));
}

// ——— Montaj ———

/** Montajda klipler arasına konan geçiş. */
export const MONTAGE_XFADE = { kind: "fade" as const, duration: 0.6 };

/** Ana izde uç uca gelen her iki klibin arasına çapraz geçiş koyar (zaten olanlara dokunmaz). */
export function withMontageXfades(clips: readonly SeqClip[]): SeqClip[] {
  return clips.map((c) =>
    c.track === 0 && !c.xfade && nextAdjacent(clips, c) ? { ...c, xfade: { ...MONTAGE_XFADE } } : c,
  );
}

/** Seçilen kayıtları sırayla tek projede açar ve aralarına çapraz geçiş koyar. */
export async function openMontage(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await editor().openFile(paths[0]);
  if (editor().phase !== "ready") return;
  for (const path of paths.slice(1)) {
    await editor().addSourceFile(path, true);
    // Açılamayan dosya diğerlerini durdurmasın; hata Medya panelinde görünür.
  }
  if (editor().clips.length > 1) change((clips) => withMontageXfades(clips));
}

/** Seçili (yoksa imleçteki) klipte imlecin olduğu anı yavaşlatır. */
export function applySpeedRamp(kind: SpeedRamp): boolean {
  const clip = targets().find((c) => playhead() >= c.start && playhead() < clipEnd(c));
  if (!clip) return false;
  const t = playhead();
  change((clips) => speedRamp(clips, clip.id, t, kind, newClipId));
  return true;
}

// ——— Sesi ayır / bağla ———

export interface AudioLinkResult {
  detached: number;
  reattached: number;
  skippedSpeed: number;
  noAudio: number;
}

/** Seçili (yoksa imleçteki) kliplerin sesini A1'e ayırır; hepsi zaten ayrılmışsa geri bağlar. */
export function toggleAudioLink(): AudioLinkResult | null {
  const list = targets();
  if (list.length === 0) return null;
  const s = editor();
  const ids = list.map((c) => c.id);
  if (ids.every((id) => isDetached(s.music, id))) {
    const r = reattachAudio(s.clips, s.music, ids);
    s.applyEdit({ clips: r.clips, music: r.music });
    refreshPlayback();
    return { detached: 0, reattached: r.reattached, skippedSpeed: 0, noAudio: 0 };
  }
  const sources = s.sources.map((e) => ({
    id: e.id,
    path: e.source.path,
    title: e.title,
    duration: e.duration,
    hasAudio: e.source.info.audioCodec !== null,
  }));
  const r = detachAudio(s.clips, s.music, ids, sources, () => nextId("m"));
  if (r.detached > 0) {
    s.applyEdit({ clips: r.clips, music: r.music });
    refreshPlayback();
  }
  return { detached: r.detached, reattached: 0, skippedSpeed: r.skippedSpeed, noAudio: r.noAudio };
}

/** Sonucu kullanıcıya anlatan kısa metin (boşsa söylenecek bir şey yok). */
export function audioLinkMessage(r: AudioLinkResult | null): string {
  if (!r) return "";
  if (r.reattached > 0) return i18n.t("editor.audioReattached");
  if (r.detached > 0) return i18n.t("editor.audioDetached");
  if (r.skippedSpeed > 0) return i18n.t("editor.audioDetachSpeed");
  if (r.noAudio > 0) return i18n.t("editor.audioDetachNoAudio");
  return "";
}

// ——— Dalgalı silme, kopyala/yapıştır, gruplama ———

let clipboard: SeqClip[] = [];

/** Seçili klipleri siler, aynı izde arkadan gelenleri boşluğa kaydırır. */
/** Shift+Delete: siler ama boşluk kalır (sonraki klipler yerinde durur). */
export function rippleDeleteSelected() {
  deleteSelected(false);
}

export function copySelected(): number {
  const ids = targets().map((c) => c.id);
  clipboard = copyClips(editor().clips, ids);
  return clipboard.length;
}

export function cutSelected() {
  if (copySelected() > 0) deleteSelected(true);
}

/** Panodaki klipleri imlece (doluysa ileride ilk boş yere) yapıştırır ve seçer. */
export function pasteAtPlayhead(): boolean {
  if (clipboard.length === 0) return false;
  let ids: string[] = [];
  change((clips) => {
    const r = pasteClips(clips, clipboard, playhead(), newClipId);
    ids = r.ids;
    return r.clips;
  });
  editor().select(ids);
  return ids.length > 0;
}

export const hasClipboard = () => clipboard.length > 0;

export function groupSelected() {
  const ids = editor().selectedIds;
  if (ids.length < 2) return;
  change((clips) => groupClips(clips, ids, newClipId()));
}

export function ungroupSelected() {
  const ids = editor().selectedIds;
  if (ids.length === 0) return;
  change((clips) => ungroupClips(clips, ids));
}
