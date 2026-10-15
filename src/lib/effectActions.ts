import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { clipEnd, layersAt, sequenceEnd } from "./sequence";
import { DEFAULT_EFFECT_SECONDS, newEffect, type EffectItem } from "./effectLane";
import { DEFAULT_FX_AMOUNT } from "./lookFx";
import { refreshPlayback } from "./sequencePlayer";
import type { FxPayload } from "./fxDrag";

// Efekt şeridi komutları. Paneldeki efekt kartına tıklayınca efekt klibe değil,
// imleçte şeride (yazı gibi) düşer; şeritte taşınır, uzatılır. Şeritte bir blok
// seçiliyken karta tıklamak o bloğun efektini değiştirir.

export const useEffectSelection = create<{
  id: string | null;
  select: (id: string | null) => void;
}>((set) => ({ id: null, select: (id) => set({ id }) }));

/** Şeritteki bloğu seçer (klip ve yazı seçimi kalkar: sağ panel bloğu gösterir). */
export function selectEffectItem(id: string) {
  useEditorStore.getState().select([]);
  useEditorStore.getState().selectText(null);
  useEffectSelection.getState().select(id);
}

// Klip ya da yazı seçilince blok seçimi kalkar (sağ panel o seçimi göstersin).
useEditorStore.subscribe((state, prev) => {
  if (
    (state.selectedIds !== prev.selectedIds && state.selectedIds.length > 0) ||
    (state.selectedTextId !== prev.selectedTextId && state.selectedTextId !== null)
  ) {
    if (useEffectSelection.getState().id) useEffectSelection.getState().select(null);
  }
});

const editor = () => useEditorStore.getState();
const playhead = () => usePlayerStore.getState().currentTime;

type Patch = Pick<EffectItem, "look" | "motion" | "motionStrength">;

/** Kartın şeritteki karşılığı (yazı şablonu ve giriş/çıkış stili şeride düşmez). */
export function effectPatch(fx: FxPayload): Patch | null {
  if (fx.kind === "filter") return { look: { filter: fx.id } };
  if (fx.kind === "motion") return fx.id === "none" ? null : { motion: fx.id };
  if (fx.kind === "lookFx") return { look: { fx: { [fx.id]: DEFAULT_FX_AMOUNT } } };
  return null;
}

/** `time` anına yeni blok: altındaki klibin sonuna kadar (en çok 3 sn). */
export function addEffectAt(time: number, patch: Patch): string | null {
  const s = editor();
  const start = Math.max(0, time);
  const under = layersAt(
    s.clips.filter((c) => !s.tracks[c.track]?.hidden),
    start,
  ).base;
  const limit = under
    ? clipEnd(under)
    : Math.max(sequenceEnd(s.clips), start + DEFAULT_EFFECT_SECONDS);
  const end = Math.min(limit, start + DEFAULT_EFFECT_SECONDS);
  const item = newEffect(newClipId(), start, Math.max(start + 0.5, end), patch);
  s.applyLayers({ effects: [...s.effects, item] });
  selectEffectItem(item.id);
  refreshPlayback();
  return item.id;
}

/** Panel kartı tıklandı: seçili blok varsa onun efekti değişir, yoksa imleçte yeni blok. */
export function applyEffectCard(fx: FxPayload): string | null {
  const patch = effectPatch(fx);
  if (!patch) return null;
  const selected = useEffectSelection.getState().id;
  const block = selected ? editor().effects.find((e) => e.id === selected) : undefined;
  if (block) {
    // Görünüm efekti bloğun öbür efektlerine eklenir (filtre ve hareket değiştirir).
    if (fx.kind === "lookFx") {
      const amount = block.look?.fx?.[fx.id] || DEFAULT_FX_AMOUNT;
      updateEffect(block.id, {
        look: { ...block.look, fx: { ...block.look?.fx, [fx.id]: amount } },
      });
    } else updateEffect(block.id, patch);
    return block.id;
  }
  return addEffectAt(playhead(), patch);
}

export function updateEffect(id: string, patch: Partial<Omit<EffectItem, "id">>, live = false) {
  const s = editor();
  const effects = s.effects.map((e) => (e.id === id ? { ...e, ...patch } : e));
  if (live) s.dragLayers({ effects });
  else {
    s.applyLayers({ effects });
    refreshPlayback();
  }
}

export function removeEffect(id: string) {
  editor().applyLayers({ effects: editor().effects.filter((e) => e.id !== id) });
  if (useEffectSelection.getState().id === id) useEffectSelection.getState().select(null);
  refreshPlayback();
}
