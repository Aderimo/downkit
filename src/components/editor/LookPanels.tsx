import { sliderKeys } from "../../lib/sliderKeys";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Ban,
  Check,
  Film,
  FlipHorizontal2,
  HeartPulse,
  RotateCcw,
  Vibrate,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
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
import { applyLook, applyLookToAll, slideMotionStrength, slideLook } from "../../lib/editorActions";
import { clampStrength, MOTIONS, STRENGTH_RANGE, type MotionId } from "../../lib/clipFx";
import { fxDrag } from "../../lib/fxDrag";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { Switch } from "../ui/Switch";
import { HelpTip } from "../ui/HelpTip";
import { EffectBlockControls } from "./EffectBlockControls";
import { FxAmounts } from "./FxAmounts";
import { FxBrowser } from "./FxBrowser";
import { GradePanel } from "./GradePanel";
import { effectKey, type EffectItem } from "../../lib/effectLane";
import { applyEffectCard, updateEffect, useEffectSelection } from "../../lib/effectActions";

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

/** Filtre kartlarındaki örnek görüntü: imleçteki klibin KENDİ kaynağından kare
 * (zaman çizelgesi önbelleğinden), uzak kaynaklarda o kaynağın kapak resmi. */
function useSampleImage(): string | null {
  const clips = useEditorStore((s) => s.clips);
  const sources = useEditorStore((s) => s.sources);
  const currentTime = usePlayerStore((s) => s.currentTime);

  // İmleçteki klip ve onun kaynağı (kaynaklar her zaman clip.sourceId'den gelir).
  const { clip, entry } = useMemo(() => {
    const found = clipAt(clips, currentTime);
    const owner = found ? (sources.find((s) => s.id === found.sourceId) ?? sources[0]) : sources[0];
    return { clip: found, entry: owner };
  }, [clips, currentTime, sources]);

  const remote: string | null = null;
  const token = entry?.stream?.token ?? null;
  const entries = useThumbStore((s) => (token ? s.byToken[token] : undefined));

  // İmlecin karşılık geldiği kaynak anı
  const sourceTime = useMemo(() => {
    return clip ? clip.srcStart + (currentTime - clip.start) * clip.speed : currentTime;
  }, [clip, currentTime]);

  useEffect(() => {
    if (!remote && token) requestThumbs(token, [sourceTime]);
  }, [remote, token, sourceTime]);

  if (remote) return remote;
  if (!entries) return null;
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
  children: string;
  hint?: string;
  target?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-white">{children}</p>
        {hint ? <HelpTip title={children} text={hint} /> : null}
      </div>
      {target ? (
        <p className="truncate text-[11px] font-medium text-[var(--dk-accent-hover)]">{target}</p>
      ) : null}
    </div>
  );
}

/** Şeritte seçili efekt bloğu (kartlar ona yazar), yoksa null. */
function useSelectedEffect(): EffectItem | null {
  const id = useEffectSelection((s) => s.id);
  return useEditorStore((s) => s.effects.find((e) => e.id === id) ?? null);
}

/** Seçili bloğun adı (panel başlığının altında). */
function useEffectTarget(effect: EffectItem | null): string | undefined {
  const { t } = useTranslation();
  if (!effect) return undefined;
  const key = effectKey(effect);
  return t("effectLane.target", { name: key.id ? t(`${key.key}.${key.id}`) : t(key.key) });
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
  const effect = useSelectedEffect();
  const target = useEffectTarget(effect);
  const sample = useSampleImage();
  const current = effect?.look?.filter ?? null;
  return (
    <div className="space-y-3">
      <PanelTitle hint={t("effectLane.cardsHint")} target={target}>
        {t("editor.toolFilters")}
      </PanelTitle>
      {effect ? <EffectBlockControls effect={effect} /> : null}
      <div className="grid grid-cols-2 gap-2">
        {FILTERS.filter((id) => id !== "none").map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={current === id}
            data-filter-card={id}
            {...fxDrag({ kind: "filter", id }, t(`editor.filter.${id}`, { defaultValue: id }))}
            onClick={() => applyEffectCard({ kind: "filter", id })}
            className={`group relative overflow-hidden rounded-xl border text-left transition ${
              current === id
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
            {current === id ? (
              <span className="dk-gradient absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
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
        {...sliderKeys()}
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
      <GradePanel grade={look.grade} disabled={!hasTarget} />
      <ApplyAllRow look={look} disabled={!hasTarget || isDefaultLook(look)} />
    </div>
  );
}

/** Bulanıklaştır, aynala, kenarları karart. */
export function EffectsPanel() {
  const { t } = useTranslation();
  const { look, hasTarget, targetName } = useTargetLook();
  const effect = useSelectedEffect();
  const target = useEffectTarget(effect);
  const sample = useSampleImage();
  // Seçili efekt bloğu varsa ayarlar ona, yoksa klibe yazılır.
  const blur = effect ? (effect.look?.blur ?? 0) : look.blur;
  const setEffectLook = (patch: NonNullable<EffectItem["look"]>, live = false) => {
    if (effect) updateEffect(effect.id, { look: { ...effect.look, ...patch } }, live);
  };
  return (
    <div className="space-y-4">
      <PanelTitle
        hint={t("effectLane.cardsHint")}
        target={target ?? (hasTarget ? t("editor.lookTarget", { name: targetName }) : undefined)}
      >
        {t("editor.toolEffects")}
      </PanelTitle>
      {effect ? <EffectBlockControls effect={effect} /> : null}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {t("lookFx.title")}
          <HelpTip title={t("lookFx.title")} text={t("lookFx.hint")} />
        </p>
        <FxAmounts
          fx={effect ? effect.look?.fx : look.fx}
          effect={effect}
          disabled={!effect && !hasTarget}
        />
        <FxBrowser sample={sample} />
      </div>
      <MotionSection />
      {effect ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>{t("editor.blur")}</span>
            <span className="font-mono text-[var(--dk-text-muted)]">{Math.round(blur * 100)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={blur}
            aria-label={t("editor.blur")}
            onPointerDown={() => useEditorStore.getState().beginDrag()}
            onPointerUp={() => {
              useEditorStore.getState().endDrag();
              refreshPlayback();
            }}
            onChange={(e) => setEffectLook({ blur: Number(e.target.value) }, true)}
            className="w-full accent-[var(--dk-accent)]"
          />
        </div>
      ) : (
        <LookSlider
          label={t("editor.blur")}
          value={look.blur}
          min={0}
          max={1}
          field="blur"
          disabled={!hasTarget}
        />
      )}
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <FlipHorizontal2 size={15} className="text-[var(--dk-text-muted)]" />
          {t("editor.mirror")}
        </span>
        <Switch
          checked={effect ? effect.look?.mirror === true : look.mirror}
          disabled={!effect && !hasTarget}
          onChange={(mirror) => (effect ? setEffectLook({ mirror }) : applyLook({ mirror }))}
          label={t("editor.mirror")}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t("editor.vignette")}</span>
        <Switch
          checked={effect ? effect.look?.vignette === true : look.vignette}
          disabled={!effect && !hasTarget}
          onChange={(vignette) => (effect ? setEffectLook({ vignette }) : applyLook({ vignette }))}
          label={t("editor.vignette")}
        />
      </label>
      {!effect ? <ApplyAllRow look={look} disabled={!hasTarget || isDefaultLook(look)} /> : null}
    </div>
  );
}

const MOTION_ICON: Record<MotionId, LucideIcon> = {
  none: Ban,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  panLeft: ArrowLeftToLine,
  panRight: ArrowRightToLine,
  kenBurns: Film,
  shake: Vibrate,
  pulse: HeartPulse,
};

/** Klip boyunca hareket: yakınlaştır, uzaklaştır (ücretsiz); kaydır, Ken Burns,
 * sarsıntı, nabız. Önizlemede ve dışa aktarımda aynı görünür. */
export function MotionSection() {
  const { t } = useTranslation();
  const effect = useSelectedEffect();
  const motion = effect?.motion ?? "none";
  // Blok seçili değilse: klibe sürüklenerek uygulanmış hareketin şiddeti ayarlanır.
  const clips = useEditorStore((s) => s.clips);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const clip = effect
    ? null
    : (clips.find((c) => selectedIds.includes(c.id)) ?? clipAt(clips, currentTime));
  const clipMotion = clip?.motion ?? "none";
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
        {t("editor.motion")}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {MOTIONS.filter((id) => id !== "none").map((id) => {
          return (
            <button
              key={id}
              type="button"
              aria-pressed={motion === id}
              data-motion-card={id}
              title={t(`editor.motionHint.${id}`)}
              {...fxDrag({ kind: "motion", id }, t(`editor.motionName.${id}`))}
              onClick={() => applyEffectCard({ kind: "motion", id })}
              className={`relative flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[10px] leading-tight transition ${
                motion === id
                  ? "dk-selected bg-[var(--dk-accent)]/15"
                  : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
              }`}
            >
              {(() => {
                const Icon = MOTION_ICON[id];
                return <Icon size={18} className="text-[var(--dk-accent-hover)]" aria-hidden />;
              })()}
              <span className="w-full truncate text-center">{t(`editor.motionName.${id}`)}</span>
            </button>
          );
        })}
      </div>
      {effect && motion !== "none" ? (
        <label className="block text-xs">
          <span className="flex justify-between">
            <span>{t("editor.motionStrength")}</span>
            <span className="font-mono text-[var(--dk-text-muted)]">
              {Math.round(clampStrength(effect.motionStrength) * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={STRENGTH_RANGE.min}
            max={STRENGTH_RANGE.max}
            step={0.01}
            value={clampStrength(effect.motionStrength)}
            onPointerDown={() => useEditorStore.getState().beginDrag()}
            onPointerUp={() => {
              useEditorStore.getState().endDrag();
              refreshPlayback();
            }}
            onChange={(e) =>
              updateEffect(effect.id, { motionStrength: Number(e.target.value) }, true)
            }
            className="w-full accent-[var(--dk-accent)]"
          />
        </label>
      ) : null}
      {clip && clipMotion !== "none" ? (
        <label className="block text-xs">
          <span className="flex justify-between">
            <span>
              {t("editor.motionStrength")} · {t(`editor.motionName.${clipMotion}`)}
            </span>
            <span className="font-mono text-[var(--dk-text-muted)]">
              {Math.round(clampStrength(clip.motionStrength) * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={STRENGTH_RANGE.min}
            max={STRENGTH_RANGE.max}
            step={0.01}
            value={clampStrength(clip.motionStrength)}
            onPointerDown={() => useEditorStore.getState().beginDrag()}
            onPointerUp={() => useEditorStore.getState().endDrag()}
            {...sliderKeys(() => {})}
            onChange={(e) => slideMotionStrength(Number(e.target.value))}
            className="w-full accent-[var(--dk-accent)]"
          />
        </label>
      ) : null}
    </div>
  );
}
