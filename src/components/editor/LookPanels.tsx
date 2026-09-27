import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, FlipHorizontal2, RotateCcw } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import {
  FILTERS,
  filterCss,
  isDefaultLook,
  normalizeLook,
  DEFAULT_LOOK,
  type ClipLook,
} from "../../lib/clipLook";
import { clipAt, clipLabel } from "../../lib/sequence";
import { nearestFromEntries, requestThumbs, useThumbStore } from "../../lib/thumbCache";
import { applyLook, applyLookToAll, slideLook } from "../../lib/editorActions";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { Switch } from "../ui/Switch";

/** Görünümü değişecek klip: seçili olan, yoksa imlecin üstündeki klip.
 * İmleç oynatılırken de güncel kalır (currentTime'a abone). */
function useTargetLook(): { look: ClipLook; hasTarget: boolean; targetName: string | null } {
  const clips = useEditorStore((s) => s.clips);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const clip = clips.find((c) => selectedIds.includes(c.id)) ?? clipAt(clips, currentTime);
  return {
    look: normalizeLook(clip?.look),
    hasTarget: clip !== null && clip !== undefined,
    targetName: clip ? clipLabel(clip) : null,
  };
}

/** Filtre kartlarındaki örnek görüntü: imleçteki video karesi (yerel dosyalarda
 * zaman çizelgesi önbelleğinden), uzak kaynaklarda kapak resmi. */
function useSampleImage(): string | null {
  const remote = useEditorStore((s) =>
    s.source?.kind === "remote" ? (s.source.metadata.thumbnailUrl ?? null) : null,
  );
  const token = useEditorStore((s) => s.stream?.token ?? null);
  const clips = useEditorStore((s) => s.clips);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const entries = useThumbStore((s) => s.entries);
  const cacheToken = useThumbStore((s) => s.token);

  // İmlecin karşılık geldiği kaynak anı
  const sourceTime = useMemo(() => {
    const clip = clipAt(clips, currentTime);
    return clip ? clip.srcStart + (currentTime - clip.start) * clip.speed : currentTime;
  }, [clips, currentTime]);

  useEffect(() => {
    if (!remote && token) requestThumbs(token, [sourceTime]);
  }, [remote, token, sourceTime]);

  if (remote) return remote;
  if (!token || cacheToken !== token) return null;
  const keys = Object.keys(entries)
    .map(Number)
    .sort((a, b) => a - b);
  return nearestFromEntries(entries, keys, sourceTime);
}

function PanelTitle({
  children,
  hint,
  target,
}: {
  children: ReactNode;
  hint?: string;
  target?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-semibold text-white">{children}</p>
      {hint ? <p className="text-xs text-[var(--dk-text-muted)]">{hint}</p> : null}
      {target ? (
        <p className="text-[11px] font-medium text-[var(--dk-accent-hover)]">{target}</p>
      ) : null}
    </div>
  );
}

function NoTarget() {
  const { t } = useTranslation();
  return (
    <p className="rounded-xl border border-dashed border-[var(--dk-border-strong)] p-3 text-xs text-[var(--dk-text-muted)]">
      {t("editor.lookPickClip")}
    </p>
  );
}

/** Hazır renk filtreleri (Siyah-beyaz, Sepya, Canlı…). */
export function FiltersPanel() {
  const { t } = useTranslation();
  const { look, hasTarget, targetName } = useTargetLook();
  const sample = useSampleImage();
  return (
    <div className="space-y-3">
      <PanelTitle
        hint={t("editor.filtersHint")}
        target={hasTarget ? t("editor.lookTarget", { name: targetName }) : undefined}
      >
        {t("editor.toolFilters")}
      </PanelTitle>
      {!hasTarget ? <NoTarget /> : null}
      <div className="grid grid-cols-2 gap-2">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={!hasTarget}
            aria-pressed={look.filter === id}
            onClick={() => applyLook({ filter: id })}
            className={`group relative overflow-hidden rounded-xl border text-left transition disabled:opacity-40 ${
              look.filter === id && hasTarget
                ? "dk-selected"
                : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
            }`}
          >
            <div
              className="aspect-video bg-cover bg-center"
              style={{
                backgroundImage: sample
                  ? `url("${sample}")`
                  : "linear-gradient(135deg, #f97316 0%, #ec4899 45%, #6366f1 100%)",
                filter: filterCss(id) || undefined,
              }}
            />
            <span className="block truncate bg-[var(--dk-surface-2)] px-2 py-1 text-[11px]">
              {t(`editor.filter.${id}`)}
            </span>
            {look.filter === id && hasTarget ? (
              <span className="dk-gradient absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <ApplyAllRow look={look} disabled={!hasTarget || isDefaultLook(look)} />
    </div>
  );
}

function ApplyAllRow({ look, disabled }: { look: ClipLook; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => applyLookToAll(look)}
        className="flex-1 rounded-lg border border-[var(--dk-border-strong)] px-2 py-1.5 text-xs hover:border-[var(--dk-accent)] disabled:opacity-40"
      >
        {t("editor.lookApplyAll")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => applyLook(DEFAULT_LOOK)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white disabled:opacity-40"
      >
        <RotateCcw size={12} />
        {t("editor.lookReset")}
      </button>
    </div>
  );
}

function LookSlider({
  label,
  value,
  min,
  max,
  field,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  field: keyof ClipLook;
  disabled: boolean;
}) {
  const shown = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-[var(--dk-text-muted)]">
          {shown > 0 && min < 0 ? `+${shown}` : shown}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-label={label}
        onPointerDown={() => useEditorStore.getState().beginDrag()}
        onPointerUp={() => {
          useEditorStore.getState().endDrag();
          refreshPlayback();
        }}
        onChange={(e) => slideLook({ [field]: Number(e.target.value) })}
        onKeyUp={() => {
          useEditorStore.getState().endDrag();
          refreshPlayback();
        }}
        onKeyDown={() => useEditorStore.getState().beginDrag()}
        className="w-full accent-[var(--dk-accent)] disabled:opacity-40"
      />
    </div>
  );
}

/** Parlaklık, kontrast, doygunluk, sıcaklık. */
export function ColorPanel() {
  const { t } = useTranslation();
  const { look, hasTarget, targetName } = useTargetLook();
  return (
    <div className="space-y-4">
      <PanelTitle
        hint={t("editor.colorHint")}
        target={hasTarget ? t("editor.lookTarget", { name: targetName }) : undefined}
      >
        {t("editor.toolColor")}
      </PanelTitle>
      {!hasTarget ? <NoTarget /> : null}
      <LookSlider
        label={t("editor.brightness")}
        value={look.brightness}
        min={-1}
        max={1}
        field="brightness"
        disabled={!hasTarget}
      />
      <LookSlider
        label={t("editor.contrast")}
        value={look.contrast}
        min={-1}
        max={1}
        field="contrast"
        disabled={!hasTarget}
      />
      <LookSlider
        label={t("editor.saturation")}
        value={look.saturation}
        min={-1}
        max={1}
        field="saturation"
        disabled={!hasTarget}
      />
      <LookSlider
        label={t("editor.temperature")}
        value={look.temperature}
        min={-1}
        max={1}
        field="temperature"
        disabled={!hasTarget}
      />
      <ApplyAllRow look={look} disabled={!hasTarget || isDefaultLook(look)} />
    </div>
  );
}

/** Bulanıklaştır, aynala, kenarları karart. */
export function EffectsPanel() {
  const { t } = useTranslation();
  const { look, hasTarget, targetName } = useTargetLook();
  return (
    <div className="space-y-4">
      <PanelTitle
        hint={t("editor.effectsHint")}
        target={hasTarget ? t("editor.lookTarget", { name: targetName }) : undefined}
      >
        {t("editor.toolEffects")}
      </PanelTitle>
      {!hasTarget ? <NoTarget /> : null}
      <LookSlider
        label={t("editor.blur")}
        value={look.blur}
        min={0}
        max={1}
        field="blur"
        disabled={!hasTarget}
      />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <FlipHorizontal2 size={15} className="text-[var(--dk-text-muted)]" />
          {t("editor.mirror")}
        </span>
        <Switch
          checked={look.mirror}
          disabled={!hasTarget}
          onChange={(mirror) => applyLook({ mirror })}
          label={t("editor.mirror")}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t("editor.vignette")}</span>
        <Switch
          checked={look.vignette}
          disabled={!hasTarget}
          onChange={(vignette) => applyLook({ vignette })}
          label={t("editor.vignette")}
        />
      </label>
      <ApplyAllRow look={look} disabled={!hasTarget || isDefaultLook(look)} />
    </div>
  );
}
