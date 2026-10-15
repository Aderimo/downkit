import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Diamond, RotateCcw, Trash2 } from "lucide-react";
import { usePlayerStore } from "../../store/playerStore";
import type { SeqClip } from "../../lib/sequence";
import {
  EASES,
  TRANSFORM_LIMITS,
  TRANSFORM_PROPS,
  adjacentKey,
  hasKeys,
  isDefaultTransform,
  keyIndexAt,
  keysOf,
  propAt,
  type Ease,
  type TransformProp,
} from "../../lib/clipTransform";
import {
  beginTransformEdit,
  clipSourceTime,
  deleteTransformKeysHere,
  endTransformEdit,
  jumpToKey,
  playheadInClip,
  resetTransform,
  setTransformEase,
  setTransformValue,
  toggleTransformKey,
  useTransformUi,
} from "../../lib/transformActions";
import { Select } from "../ui/Select";

/** Arayüzde gösterilen birim: konum ve ölçek yüzde, döndürme derece. */
const UNIT: Record<TransformProp, { factor: number; suffix: string }> = {
  x: { factor: 100, suffix: "%" },
  y: { factor: 100, suffix: "%" },
  scale: { factor: 100, suffix: "%" },
  rotation: { factor: 1, suffix: "°" },
  opacity: { factor: 100, suffix: "%" },
};

/** Klibin konumu, ölçeği, dönüşü ve saydamlığı; her biri anahtar karelerle zamana bağlanabilir. */
export function TransformSection({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const time = usePlayerStore((s) => s.currentTime);
  const setEditing = useTransformUi((s) => s.set);
  // Bölüm açıkken önizlemede tutamaçlı kutu görünür.
  useEffect(() => {
    setEditing(true);
    return () => setEditing(false);
  }, [setEditing]);

  const tr = clip.transform;
  const inside = playheadInClip(clip, time);
  const src = clipSourceTime(clip, time);
  const keyedHere = TRANSFORM_PROPS.filter((p) => keyIndexAt(tr, p, src) >= 0);
  const hereEase: Ease | undefined = keyedHere.length
    ? (keysOf(tr, keyedHere[0])[keyIndexAt(tr, keyedHere[0], src)].ease ?? "linear")
    : undefined;
  const prevKey = tr && adjacentKey(tr, src, -1);
  const nextKey = tr && adjacentKey(tr, src, 1);

  return (
    <div className="space-y-2" data-transform>
      {TRANSFORM_PROPS.map((prop) => {
        const { min, max, step } = TRANSFORM_LIMITS[prop];
        const unit = UNIT[prop];
        const value = propAt(tr, prop, src);
        const keyed = keyIndexAt(tr, prop, src) >= 0;
        const animated = hasKeys(tr, prop);
        const label = t(`transform.${prop}`);
        return (
          <div key={prop} className="grid grid-cols-[4.5rem_1fr_3.5rem_auto] items-center gap-1.5">
            <span className="truncate text-xs text-[var(--dk-text-muted)]">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              aria-label={label}
              onPointerDown={beginTransformEdit}
              onPointerUp={endTransformEdit}
              onKeyUp={endTransformEdit}
              onKeyDown={(e) => {
                if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")
                  beginTransformEdit();
              }}
              onChange={(e) => setTransformValue(clip.id, prop, Number(e.target.value), true)}
              className="dk-volume w-full"
            />
            <input
              type="number"
              value={Math.round(value * unit.factor * 10) / 10}
              step={step * unit.factor}
              aria-label={t("transform.valueOf", { name: label })}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setTransformValue(clip.id, prop, n / unit.factor);
              }}
              className="h-6 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1 text-right font-mono text-[11px] outline-none focus:border-[var(--dk-accent)]"
            />
            <button
              type="button"
              disabled={!inside}
              aria-pressed={keyed}
              aria-label={
                keyed
                  ? t("transform.removeKey", { name: label })
                  : t("transform.addKey", { name: label })
              }
              title={
                inside
                  ? keyed
                    ? t("transform.removeKey", { name: label })
                    : t("transform.addKey", { name: label })
                  : t("transform.outside")
              }
              onClick={() => toggleTransformKey(clip.id, prop)}
              className={`rounded p-0.5 disabled:opacity-30 ${
                keyed
                  ? "text-[#ffd43b]"
                  : animated
                    ? "text-[#ffd43b]/60 hover:text-[#ffd43b]"
                    : "text-[var(--dk-text-muted)] hover:text-white"
              }`}
            >
              <Diamond size={13} fill={keyed ? "currentColor" : "none"} />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={prevKey === null || prevKey === undefined}
          aria-label={t("transform.prevKey")}
          title={t("transform.prevKey")}
          onClick={() => jumpToKey(clip.id, -1)}
          className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          disabled={nextKey === null || nextKey === undefined}
          aria-label={t("transform.nextKey")}
          title={t("transform.nextKey")}
          onClick={() => jumpToKey(clip.id, 1)}
          className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </button>
        {hereEase ? (
          <>
            <Select
              value={hereEase}
              ariaLabel={t("transform.ease")}
              className="min-w-0 flex-1 [&>button]:h-7"
              onChange={(ease) => setTransformEase(clip.id, ease)}
              options={EASES.map((e) => ({ value: e, label: t(`transform.eases.${e}`) }))}
            />
            <button
              type="button"
              aria-label={t("transform.deleteKeys")}
              title={t("transform.deleteKeys")}
              onClick={() => deleteTransformKeysHere(clip.id)}
              className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-error)]"
            >
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--dk-text-muted)]">
            {hasKeys(tr) ? t("transform.keysHint") : t("transform.hint")}
          </span>
        )}
        <button
          type="button"
          disabled={isDefaultTransform(tr) && !hasKeys(tr)}
          aria-label={t("transform.reset")}
          title={t("transform.reset")}
          onClick={() => resetTransform(clip.id)}
          className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white disabled:opacity-30"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}
