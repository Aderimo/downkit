import { useEditorStore } from "../store/editorStore";
import type { FilterId } from "./clipLook";
import type { MotionId, TransitionStyle } from "./clipFx";
import { DEFAULT_FX_AMOUNT, type LookFxId } from "./lookFx";
import { normalizeLook } from "./clipLook";
import { lookTarget } from "./editorActions";
import type { TextStyle } from "./editorPresets";
import { applyLook, applyMotion, applyTransitionStyle, addStyledText } from "./editorActions";
import { pointerDrag } from "./pointerDrag";
import { seekTimeline } from "./sequencePlayer";
import { addEffectAt, effectPatch } from "./effectActions";

// Panellerdeki her şey (filtre, hareket efekti, giriş/çıkış stili, yazı şablonu)
// zaman çizelgesine sürüklenebilir: klibe bırakılınca o klibe uygulanır, yazı
// bırakılan ana eklenir. Geçişler kendi MIME'leriyle (XFADE_MIME) ayrı çalışır.

export const FX_MIME = "application/x-downkit-fx";

export type FxPayload =
  | { kind: "filter"; id: FilterId }
  | { kind: "motion"; id: MotionId }
  | { kind: "style"; id: TransitionStyle }
  | { kind: "lookFx"; id: LookFxId }
  | { kind: "text"; text: string; style: TextStyle; seconds?: number };

/** Panel öğesine verilir: `{...fxDrag({ kind: "filter", id }, ad)}`. */
export function fxDrag(payload: FxPayload, label: string) {
  return pointerDrag(FX_MIME, JSON.stringify(payload), label);
}

export function readFx(data: string): FxPayload | null {
  try {
    const value = JSON.parse(data) as FxPayload;
    return value && typeof value === "object" && "kind" in value ? value : null;
  } catch {
    return null;
  }
}

/** Klibe bırakılan efekt: klip seçilir, uygulama seçime yapılır (tek geri alma adımı). */
export function dropFxOnClip(clipId: string, fx: FxPayload) {
  const store = useEditorStore.getState();
  if (fx.kind === "text") {
    const clip = store.clips.find((c) => c.id === clipId);
    dropFxAtTime(clip ? clip.start : 0, fx);
    return;
  }
  store.select([clipId]);
  if (fx.kind === "filter") {
    applyLook({ filter: fx.id });
  } else if (fx.kind === "lookFx") {
    // Klibin tamamına: var olan efektlerine eklenir.
    const current = normalizeLook(lookTarget()?.look).fx;
    applyLook({ fx: { ...current, [fx.id]: current?.[fx.id] || DEFAULT_FX_AMOUNT } });
  } else if (fx.kind === "motion") {
    applyMotion(fx.id);
  } else {
    applyTransitionStyle(fx.id);
  }
}

/** Zaman çizelgesinin boş yerine (ya da efekt şeridine) bırakılan: yazı şablonu o anda
 * başlar; filtre / hareket o anda efekt şeridine düşer. */
export function dropFxAtTime(time: number, fx: FxPayload) {
  if (fx.kind === "text") {
    seekTimeline(Math.max(0, time));
    addStyledText(fx.text, fx.style, fx.seconds);
    return;
  }
  const patch = effectPatch(fx);
  if (patch) addEffectAt(time, patch);
}
