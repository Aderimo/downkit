import { sliderKeys } from "../../lib/sliderKeys";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { LOOK_FX_IDS, normalizeFx, type LookFx, type LookFxId } from "../../lib/lookFx";
import type { EffectItem } from "../../lib/effectLane";
import { updateEffect } from "../../lib/effectActions";
import { applyLookWith } from "../../lib/editorActions";
import { useEditorStore } from "../../store/editorStore";
import { refreshPlayback } from "../../lib/sequencePlayer";

/** Seçili bloğun ya da klibin görünüm efektleri: şiddet kaydırıcısı ve kaldır. */
export function FxAmounts({
  fx,
  effect,
  disabled,
}: {
  fx: LookFx | undefined;
  /** Seçili efekt bloğu (yoksa klibe yazılır). */
  effect: EffectItem | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const active = LOOK_FX_IDS.filter((id) => (fx?.[id] ?? 0) > 0);
  if (active.length === 0) return null;
  const write = (next: LookFx, live: boolean) => {
    const clean = normalizeFx(next);
    if (effect) {
      updateEffect(effect.id, { look: { ...effect.look, fx: clean } }, live);
    }
  };
  // Klibe yazarken her klibin kendi efektleri korunur, yalnız bu efektin şiddeti değişir.
  const set = (id: LookFxId, value: number, live: boolean) =>
    effect
      ? write({ ...fx, [id]: value }, live)
      : applyLookWith((look) => ({ fx: normalizeFx({ ...look.fx, [id]: value }) }), live);
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--dk-border)] p-2" data-fx-amounts>
      {active.map((id) => (
        <div
          key={id}
          className="grid grid-cols-[5.5rem_1fr_1.75rem_1rem] items-center gap-1.5 text-[11px]"
        >
          <span className="truncate">{t(`lookFx.names.${id}`)}</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={fx?.[id] ?? 0}
            disabled={disabled}
            aria-label={t("lookFx.amount", { name: t(`lookFx.names.${id}`) })}
            onPointerDown={() => useEditorStore.getState().beginDrag()}
            onPointerUp={() => {
              useEditorStore.getState().endDrag();
              refreshPlayback();
            }}
            {...sliderKeys()}
            onChange={(e) => set(id, Number(e.target.value), true)}
            className="dk-volume w-full"
          />
          <span className="text-right font-mono text-[var(--dk-text-muted)]">
            {Math.round((fx?.[id] ?? 0) * 100)}
          </span>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("lookFx.remove", { name: t(`lookFx.names.${id}`) })}
            onClick={() => set(id, 0, false)}
            className="text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
