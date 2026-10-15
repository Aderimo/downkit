import { useTranslation } from "react-i18next";
import { MoveHorizontal, Trash2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { clipEnd, layersAt, sequenceEnd } from "../../lib/sequence";
import { removeEffect, updateEffect } from "../../lib/effectActions";
import type { EffectItem } from "../../lib/effectLane";

/** Seçili efekt bloğunun zamanı: başlangıç / bitiş, klibe ya da bütün videoya yay, sil. */
export function EffectBlockControls({ effect }: { effect: EffectItem }) {
  const { t } = useTranslation();
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const field =
    "h-6 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1 text-right font-mono text-[11px] outline-none focus:border-[var(--dk-accent)]";
  const under = layersAt(
    clips.filter((c) => !tracks[c.track]?.hidden),
    (effect.start + effect.end) / 2,
  ).base;
  const set = (start: number, end: number) =>
    updateEffect(effect.id, { start: Math.max(0, start), end: Math.max(start + 0.2, end) });
  return (
    <div className="space-y-1.5 rounded-lg border border-[#ec4899]/50 p-2" data-effect-block>
      <div className="grid grid-cols-2 gap-1.5">
        {(["start", "end"] as const).map((edge) => (
          <label key={edge} className="space-y-0.5 text-[11px]">
            <span className="text-[var(--dk-text-muted)]">{t(`effectLane.${edge}`)}</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={Number(effect[edge].toFixed(2))}
              aria-label={t(`effectLane.${edge}`)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                if (edge === "start") set(v, Math.max(effect.end, v + 0.2));
                else set(effect.start, v);
              }}
              className={field}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={!under}
          onClick={() => under && set(under.start, clipEnd(under))}
          className="flex items-center gap-1.5 rounded-md bg-[var(--dk-bg)] px-2 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40"
        >
          <MoveHorizontal size={12} className="shrink-0" />
          <span className="truncate">{t("effectLane.toClip")}</span>
        </button>
        <button
          type="button"
          onClick={() => set(0, sequenceEnd(clips))}
          className="flex items-center gap-1.5 rounded-md bg-[var(--dk-bg)] px-2 py-1 text-[11px] hover:bg-white/10"
        >
          <MoveHorizontal size={12} className="shrink-0" />
          <span className="truncate">{t("effectLane.toVideo")}</span>
        </button>
        <button
          type="button"
          onClick={() => removeEffect(effect.id)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-error)]"
        >
          <Trash2 size={12} className="shrink-0" />
          <span className="truncate">{t("effectLane.delete")}</span>
        </button>
      </div>
    </div>
  );
}
