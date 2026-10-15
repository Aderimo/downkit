import { create } from "zustand";
import { useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { clipEnd, type SeqClip } from "./sequence";
import {
  DEFAULT_TRANSFORM,
  adjacentKey,
  deleteKeysAt,
  isDefaultTransform,
  setEaseAt,
  setProp,
  toggleKey,
  type ClipTransform,
  type Ease,
  type TransformProp,
} from "./clipTransform";
import { refreshPlayback, seekTimeline } from "./sequencePlayer";

// Dönüşüm paneli ve önizlemedeki tutamaçların ortak komutları. Değerler imlecin
// kaynak saniyesinde yazılır (özelliğin karesi varsa o anda kare olur).

/** Dönüşüm bölümü açık mı (önizlemede tutamaçlı kutu o zaman görünür). */
export const useTransformUi = create<{ editing: boolean; set: (editing: boolean) => void }>(
  (set) => ({ editing: false, set: (editing) => set({ editing }) }),
);

const editor = () => useEditorStore.getState();
const playhead = () => usePlayerStore.getState().currentTime;

/** İmleç klibin üstünde mi (kare işlemleri ancak o zaman yapılabilir). */
export function playheadInClip(clip: SeqClip, t = playhead()): boolean {
  return t >= clip.start - 1e-6 && t < clipEnd(clip) - 1e-6;
}

/** İmlecin klipteki kaynak saniyesi (dışındaysa en yakın uca kırpılır). */
export function clipSourceTime(clip: SeqClip, t = playhead()): number {
  const local = Math.min(Math.max(t, clip.start), clipEnd(clip));
  return Math.min(clip.srcEnd, clip.srcStart + (local - clip.start) * clip.speed);
}

function cleaned(tr: ClipTransform): ClipTransform | undefined {
  return isDefaultTransform(tr) && !tr.keys ? undefined : tr;
}

function withTransform(clips: SeqClip[], id: string, next: (tr: ClipTransform) => ClipTransform) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const tr = cleaned(next(c.transform ?? { ...DEFAULT_TRANSFORM }));
    const out = { ...c, transform: tr };
    if (!tr) delete out.transform;
    return out;
  });
}

/** Sürükleme ya da kaydırıcı başladı: bırakınca tek geri alma adımı olur. */
export function beginTransformEdit() {
  editor().beginDrag();
}

export function endTransformEdit() {
  editor().endDrag();
  refreshPlayback();
}

/** Özelliğe değer verir. `live`: sürükleme sürüyor (geri alma adımı bırakınca). */
export function setTransformValue(id: string, prop: TransformProp, value: number, live = false) {
  const s = editor();
  const clip = s.clips.find((c) => c.id === id);
  if (!clip) return;
  const src = clipSourceTime(clip);
  if (live) {
    s.dragTo(withTransform(s.clips, id, (tr) => setProp(tr, prop, value, src)));
  } else {
    s.apply((clips) => withTransform(clips, id, (tr) => setProp(tr, prop, value, src)));
    refreshPlayback();
  }
}

/** Birden çok özelliği birlikte (önizlemedeki kutu: konum ya da ölçek + döndürme). */
export function setTransformValues(
  id: string,
  values: Partial<Record<TransformProp, number>>,
  live = false,
) {
  const s = editor();
  const clip = s.clips.find((c) => c.id === id);
  if (!clip) return;
  const src = clipSourceTime(clip);
  const apply = (tr: ClipTransform) =>
    (Object.entries(values) as [TransformProp, number][]).reduce(
      (acc, [prop, v]) => setProp(acc, prop, v, src),
      tr,
    );
  if (live) s.dragTo(withTransform(s.clips, id, apply));
  else {
    s.apply((clips) => withTransform(clips, id, apply));
    refreshPlayback();
  }
}

/** ◆: imleçte o özelliğin karesini ekler ya da siler. */
export function toggleTransformKey(id: string, prop: TransformProp): boolean {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip || !playheadInClip(clip)) return false;
  const src = clipSourceTime(clip);
  editor().apply((clips) => withTransform(clips, id, (tr) => toggleKey(tr, prop, src)));
  refreshPlayback();
  return true;
}

/** İmleçteki karelerin eğrisi. */
export function setTransformEase(id: string, ease: Ease) {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip) return;
  const src = clipSourceTime(clip);
  editor().apply((clips) => withTransform(clips, id, (tr) => setEaseAt(tr, src, ease)));
  refreshPlayback();
}

/** İmleçteki bütün kareleri siler. */
export function deleteTransformKeysHere(id: string) {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip || !playheadInClip(clip)) return;
  const src = clipSourceTime(clip);
  editor().apply((clips) => withTransform(clips, id, (tr) => deleteKeysAt(tr, src)));
  refreshPlayback();
}

/** Dönüşümü (kareler dahil) kaldırır. */
export function resetTransform(id: string) {
  editor().apply((clips) =>
    clips.map((c) => {
      if (c.id !== id || !c.transform) return c;
      const out = { ...c };
      delete out.transform;
      return out;
    }),
  );
  refreshPlayback();
}

/** İmleç önceki / sonraki kareye gider (klibin içindeki karelere). */
export function jumpToKey(id: string, dir: -1 | 1, prop?: TransformProp): boolean {
  const clip = editor().clips.find((c) => c.id === id);
  if (!clip?.transform) return false;
  let src = clipSourceTime(clip);
  for (;;) {
    const next = adjacentKey(clip.transform, src, dir, prop);
    if (next === null) return false;
    if (next >= clip.srcStart - 1e-6 && next <= clip.srcEnd + 1e-6) {
      seekTimeline(clip.start + (next - clip.srcStart) / clip.speed);
      return true;
    }
    src = next;
  }
}
