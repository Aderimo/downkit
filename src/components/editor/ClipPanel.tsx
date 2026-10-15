import { useState, type ReactNode } from "react";
import { HelpTip } from "../ui/HelpTip";
import { formatPercent } from "../../lib/format";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Copy,
  Crop,
  Film,
  Gauge,
  Magnet,
  Play,
  Plus,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  Blend,
  AudioLines,
  Link2,
  Unlink,
  Info,
  Move,
  ZoomIn,
} from "lucide-react";
import { sourceChapters, useEditorStore } from "../../store/editorStore";
import { TextPanel } from "./TextPanel";
import { usePlayerStore } from "../../store/playerStore";
import type { Chapter } from "../../types/media";
import {
  clipEnd,
  clipFades,
  clipLabel,
  clipLength,
  clipVolume,
  FADE_PRESETS,
  setVolume,
  exportPieces,
  flatten,
  piecesDuration,
  timelineTimeOfSource,
  setSpeed,
  type SeqClip,
} from "../../lib/sequence";
import { formatTimecode } from "../../lib/timeline";
import {
  appendWholeSource,
  closeAllGaps,
  deleteSelected,
  duplicateSelected,
  jumpToSource,
  keepOnlySelected,
  playClip,
  setClipDenoise,
  setClipFade,
  setClipSpeed,
  splitAtPlayhead,
  toggleMuteSelected,
  toggleAudioLink,
  audioLinkMessage,
  splitByChapters,
  nextAdjacent,
  previewXfade,
  removeXfade,
  setXfadeOn as applyXfadeTo,
  setXfadeSeconds,
  applySpeedRamp,
} from "../../lib/editorActions";
import { isXfadeKind, XFADE_KINDS, XFADE_PRESETS } from "../../lib/xfade";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { formatCombo, useShortcutStore, type ShortcutAction } from "../../lib/shortcuts";
import { AppliedEffects } from "./AppliedEffects";
import { PanelSection } from "./PanelSection";
import { TransformSection } from "./TransformSection";
import { ZoomSection } from "./ZoomSection";
import { SpeedCurveEditor } from "./SpeedCurveEditor";
import { AudioRepair } from "./AudioRepair";
import { Rewind, Snowflake } from "lucide-react";
import { MAX_REVERSE_SECONDS } from "../../lib/sequence";
import { insertFreezeFrame, setClipReverse } from "../../lib/editorActions";
import { isDefaultTransform, keyTimes } from "../../lib/clipTransform";

const QUICK_SPEEDS = [0.5, 1, 1.5, 2, 4];

/** Sağ paneldeki "Klip" sekmesi: seçili klibin ayarları ya da zaman çizelgesi özeti. */
export function ClipPanel() {
  const clips = useEditorStore((s) => s.clips);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selected = clips.filter((c) => selectedIds.includes(c.id));
  const selectedText = useEditorStore((s) => s.texts.find((t) => t.id === s.selectedTextId));

  if (selectedText) return <TextPanel item={selectedText} />;

  if (selected.length === 1) return <ClipDetails clip={selected[0]} />;
  if (selected.length > 1) return <MultiDetails count={selected.length} />;
  return <TimelineSummary clips={clips} />;
}

function useKey() {
  const map = useShortcutStore((s) => s.map);
  return (action: ShortcutAction) => (map[action][0] ? formatCombo(map[action][0]) : "");
}

function ClipDetails({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const key = useKey();
  const renameClip = useEditorStore((s) => s.renameClip);

  // Kaydırıcı logaritmik: 0,25× … 4× arası eşit aralıklı hissettirir.
  const sliderValue = Math.log2(clip.speed);

  function slide(value: number) {
    const store = useEditorStore.getState();
    const origin = store.dragOrigin?.clips ?? store.clips;
    store.dragTo(setSpeed(origin, clip.id, 2 ** value));
  }

  return (
    <div className="space-y-4">
      <AppliedEffects clip={clip} />
      <div className="space-y-1.5">
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.clipNameLabel")}</p>
        <input
          value={clip.name}
          placeholder={clipLabel({ ...clip, name: "" })}
          onChange={(e) => renameClip(clip.id, e.target.value)}
          className="h-10 w-full rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-3 text-sm outline-none focus:border-[var(--dk-accent)]"
        />
      </div>

      <PanelSection
        id="speed"
        title={t("editor.clipSpeed")}
        icon={<Gauge size={15} />}
        summary={`${clip.speed}×`}
        tour="editor-speed"
        help={t("editor.speedHint")}
      >
        <input
          type="range"
          min={-2}
          max={2}
          step={0.05}
          value={sliderValue}
          aria-label={t("editor.clipSpeed")}
          onPointerDown={() => useEditorStore.getState().beginDrag()}
          onPointerUp={() => {
            useEditorStore.getState().endDrag();
            refreshPlayback();
          }}
          onChange={(e) => slide(Number(e.target.value))}
          className="dk-volume w-full"
        />
        <div className="flex justify-between gap-1">
          {QUICK_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => setClipSpeed(clip.id, speed)}
              className={`flex-1 rounded-lg py-1 font-mono text-xs ${
                clip.speed === speed
                  ? "bg-[var(--dk-accent)] text-white"
                  : "bg-[var(--dk-bg)] text-[var(--dk-text)] hover:bg-white/10"
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5" data-tour="editor-ramp">
          <button
            type="button"
            title={t("editor.rampSlowmoHint")}
            onClick={() => applySpeedRamp("slowmo")}
            className="rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)]"
          >
            {t("editor.rampSlowmo")}
          </button>
          <button
            type="button"
            title={t("editor.rampVelocityHint")}
            onClick={() => applySpeedRamp("velocity")}
            className="relative rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)]"
          >
            {t("editor.rampVelocity")}
          </button>
        </div>
        <ReverseFreezeRow clip={clip} />
        {clip.freezeAt === undefined ? <SpeedCurveEditor clip={clip} /> : null}
      </PanelSection>

      <PanelSection
        id="zoom"
        title={t("zoom.title")}
        icon={<ZoomIn size={15} />}
        summary={clip.zooms?.length ? String(clip.zooms.length) : undefined}
      >
        <ZoomSection clip={clip} />
      </PanelSection>

      <PanelSection
        id="transform"
        title={t("transform.title")}
        icon={<Move size={15} />}
        summary={
          keyTimes(clip.transform).length > 0
            ? `◆ ${keyTimes(clip.transform).length}`
            : isDefaultTransform(clip.transform)
              ? undefined
              : t("transform.changed")
        }
        defaultOpen={false}
      >
        <TransformSection clip={clip} />
      </PanelSection>

      <PanelSection
        id="audio"
        title={t("editor.sectionAudio")}
        icon={<Volume2 size={15} />}
        summary={
          clipVolume(clip) === 0
            ? t("editor.sectionMuted")
            : t("editor.sectionVolume", { n: Math.round(clipVolume(clip) * 100) })
        }
      >
        <ClipAudio clip={clip} />
      </PanelSection>

      <PanelSection
        id="transition"
        title={t("editor.sectionTransition")}
        icon={<Blend size={15} />}
        help={`${t("editor.fadeHint")}\n\n${t("editor.xfadeDurationHint")}`}
      >
        <ClipXfade clip={clip} />
      </PanelSection>

      <PanelSection
        id="info"
        title={t("editor.sectionInfo")}
        icon={<Info size={15} />}
        defaultOpen={false}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-[var(--dk-bg)]/60 p-3 text-xs">
          <dt className="text-[var(--dk-text-muted)]">{t("editor.clipSource")}</dt>
          <dd className="text-right font-mono tabular-nums">
            {formatTimecode(clip.srcStart, 1)} → {formatTimecode(clip.srcEnd, 1)}
          </dd>
          <dt className="text-[var(--dk-text-muted)]">{t("editor.clipOnTimeline")}</dt>
          <dd className="text-right font-mono tabular-nums">
            {formatTimecode(clip.start, 1)} → {formatTimecode(clipEnd(clip), 1)}
          </dd>
          <dt className="text-[var(--dk-text-muted)]">{t("editor.clipLength")}</dt>
          <dd className="text-right font-mono tabular-nums">
            {formatTimecode(clipLength(clip), 1)}
          </dd>
          <dt className="text-[var(--dk-text-muted)]">{t("editor.clipLayer")}</dt>
          <dd className="text-right">{clip.track + 1}</dd>
        </dl>
      </PanelSection>

      <div className="grid grid-cols-2 gap-2">
        <PanelButton icon={<Play size={15} />} onClick={() => playClip(clip.id)}>
          {t("editor.playClip")}
        </PanelButton>
        <PanelButton icon={<Scissors size={15} />} onClick={splitAtPlayhead} hint={key("split")}>
          {t("editor.split")}
        </PanelButton>
        <PanelButton icon={<Copy size={15} />} onClick={duplicateSelected} hint={key("duplicate")}>
          {t("editor.duplicate")}
        </PanelButton>
        <PanelButton icon={<Crop size={15} />} onClick={keepOnlySelected}>
          {t("editor.keepOnly")}
        </PanelButton>
        <PanelButton
          icon={<Trash2 size={15} />}
          onClick={() => deleteSelected()}
          hint={key("deleteClip")}
          danger
          wide
        >
          {t("editor.deleteClip")}
        </PanelButton>
      </div>
    </div>
  );
}

/** Dondurulmuş kare ekleme ve ters oynatma. */
function ReverseFreezeRow({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const tooLong = clip.srcEnd - clip.srcStart > MAX_REVERSE_SECONDS;
  if (clip.freezeAt !== undefined) {
    return (
      <p className="rounded-lg bg-[var(--dk-bg)]/60 px-3 py-2 text-[11px] text-[var(--dk-text-muted)]">
        {t("freeze.isFrozen")}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        data-testid="freeze-frame"
        title={t("freeze.hint")}
        onClick={() => insertFreezeFrame()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)]"
      >
        <Snowflake size={13} />
        {t("freeze.add")}
      </button>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--dk-bg)]/60 px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Rewind size={13} className="shrink-0 text-[var(--dk-accent-hover)]" />
          <span className="truncate">{t("reverse.label")}</span>
          <HelpTip
            title={t("reverse.label")}
            text={t("reverse.hint", { seconds: MAX_REVERSE_SECONDS })}
          />
        </p>
        <Switch
          checked={clip.reverse === true}
          disabled={tooLong && clip.reverse !== true}
          label={t("reverse.label")}
          onChange={(on) => setClipReverse(clip.id, on)}
        />
      </div>
    </div>
  );
}

function MultiDetails({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-sm">{t("editor.multiSelected", { count })}</p>
      <div className="grid grid-cols-2 gap-2">
        <PanelButton icon={<Crop size={15} />} onClick={keepOnlySelected}>
          {t("editor.keepOnly")}
        </PanelButton>
        <PanelButton icon={<Trash2 size={15} />} onClick={() => deleteSelected()} danger>
          {t("editor.deleteClip")}
        </PanelButton>
      </div>
    </div>
  );
}

function TimelineSummary({ clips }: { clips: SeqClip[] }) {
  const { t } = useTranslation();
  // Kısayollar doğrudan eşlemeden (useKey işlevi ipucuna geçince derleyici döngüye giriyordu).
  const shortcutMap = useShortcutStore((s) => s.map);
  const label = (combo: string | undefined) => (combo ? formatCombo(combo) : "");
  // Nasıl kullanılır: başlıktaki "?" içinde (ekranda kalıcı yer kaplamasın).
  const howto = [
    t("editor.howtoSplit", { key: label(shortcutMap.split[0]) }),
    t("editor.howtoDelete", { key: label(shortcutMap.deleteClip[0]) }),
    t("editor.howtoTrim"),
    t("editor.howtoLayers"),
    t("editor.howtoMenu"),
  ]
    .map((x) => `• ${x}`)
    .join("\n");
  const tracks = useEditorStore((s) => s.tracks);
  const pieces = exportPieces(flatten(clips, tracks));
  const output = piecesDuration(pieces);
  const hasGaps = pieces.some((p) => p.kind === "gap");

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--dk-bg)]/60 p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Film size={15} className="text-[var(--dk-accent-hover)]" />
          {t("editor.summaryTitle")}
          <HelpTip title={t("editor.howtoTitle")} text={howto} />
        </p>
        <p className="mt-1 text-xs text-[var(--dk-text-muted)]">
          {t("editor.summaryText", {
            count: clips.length,
            output: formatTimecode(output, 1),
          })}
        </p>
        {hasGaps ? (
          <p className="mt-1 text-xs text-[var(--dk-warning)]">{t("editor.gapsSkipped")}</p>
        ) : null}
      </div>

      <PanelButton icon={<Magnet size={15} />} onClick={closeAllGaps} disabled={!hasGaps}>
        {t("editor.closeGaps")}
      </PanelButton>
      {/* Videonun tamamını yeniden koymak yalnızca zaman çizelgesi boşken anlamlı. */}
      {clips.length === 0 ? (
        <PanelButton icon={<Plus size={15} />} onClick={appendWholeSource}>
          {t("editor.addWholeSource")}
        </PanelButton>
      ) : null}

      <ChapterList clips={clips} />
    </div>
  );
}

/** Sesi ayır / bağla: ses A1'e ayrı blok olarak iner, ayrı taşınır ve kısaltılır. */
function DetachAudioRow({ clipId }: { clipId: string }) {
  const { t } = useTranslation();
  const key = useKey();
  const detached = useEditorStore((s) => s.music.some((m) => m.linkedClipId === clipId));
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-1">
      <button
        type="button"
        data-detach-audio
        title={`${t(detached ? "editor.reattachAudioHint" : "editor.detachAudioHint")}${key("detachAudio") ? ` (${key("detachAudio")})` : ""}`}
        onClick={() => setMessage(audioLinkMessage(toggleAudioLink()))}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--dk-bg)] px-2 py-1.5 text-xs hover:bg-white/10"
      >
        {detached ? <Link2 size={13} /> : <Unlink size={13} />}
        {detached ? t("editor.reattachAudio") : t("editor.detachAudio")}
      </button>
      {message ? <p className="text-[11px] text-[var(--dk-text-muted)]">{message}</p> : null}
    </div>
  );
}

/** Klibin ses düzeyi (sessize alma dahil) ve açılma/kararma geçişleri. */
function ClipAudio({ clip }: { clip: SeqClip }) {
  const { t, i18n } = useTranslation();
  const key = useKey();
  const volume = clipVolume(clip);
  const [fadeIn, fadeOut] = clipFades(clip);
  const muted = volume === 0;

  function slide(value: number) {
    const store = useEditorStore.getState();
    const origin = store.dragOrigin?.clips ?? store.clips;
    store.dragTo(setVolume(origin, [clip.id], value));
  }

  const fadeButtons = (edge: "in" | "out", current: number) => (
    <div className="flex gap-1">
      {FADE_PRESETS.map((seconds) => (
        <button
          key={seconds}
          type="button"
          onClick={() => setClipFade(clip.id, edge, seconds)}
          className={`flex-1 rounded-lg py-1 font-mono text-[11px] ${
            Math.abs(current - seconds) < 0.01
              ? "bg-[var(--dk-accent)] text-white"
              : "bg-[var(--dk-bg)] text-[var(--dk-text)] hover:bg-white/10"
          }`}
        >
          {seconds === 0 ? t("editor.fadeNone") : t("editor.fadeSeconds", { n: seconds })}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4" data-tour="editor-audio">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Volume2 size={15} className="text-[var(--dk-accent-hover)]" />
            {t("editor.clipVolume")}
          </p>
          <button
            type="button"
            onClick={() => toggleMuteSelected()}
            title={key("toggleMute")}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
              muted
                ? "bg-[var(--dk-error)]/15 text-[var(--dk-error)]"
                : "bg-[var(--dk-bg)] hover:bg-white/10"
            }`}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            {muted ? t("editor.unmuteClip") : t("editor.muteClip")}
          </button>
        </div>
        <DetachAudioRow clipId={clip.id} />
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={volume}
            aria-label={t("editor.clipVolume")}
            onPointerDown={() => useEditorStore.getState().beginDrag()}
            onPointerUp={() => {
              useEditorStore.getState().endDrag();
              refreshPlayback();
            }}
            onChange={(e) => slide(Number(e.target.value))}
            className="dk-volume flex-1"
          />
          <span className="w-11 text-right font-mono text-xs">
            {formatPercent(volume, i18n.language)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--dk-bg)]/60 px-3 py-2">
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
            <AudioLines size={13} className="shrink-0 text-[var(--dk-accent-hover)]" />
            <span className="truncate">{t("editor.denoise")}</span>
            <HelpTip title={t("editor.denoise")} text={t("editor.denoiseHint")} />
          </p>
          <Switch
            checked={clip.denoise === true}
            label={t("editor.denoise")}
            onChange={(on) => setClipDenoise(clip.id, on)}
          />
        </div>
        <AudioRepair clip={clip} />
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Blend size={15} className="text-[var(--dk-accent-hover)]" />
          {t("editor.fades")}
        </p>
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.fadeIn")}</p>
        {fadeButtons("in", fadeIn)}
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.fadeOut")}</p>
        {fadeButtons("out", fadeOut)}
      </div>
    </div>
  );
}

/** Bu klipten sonraki (bitişik) klibe geçiş: tür, süre, önizleme. Bitişik klip
 * yoksa gösterilmez. */
function ClipXfade({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const clips = useEditorStore((s) => s.clips);
  const next = nextAdjacent(clips, clip);
  if (!next) return null;
  const x = clip.xfade;
  const options = [
    { value: "none", label: t("editor.xfadeNone") },
    ...XFADE_KINDS.map((kind) => ({
      value: kind,
      label: t(`editor.xfadeName.${kind}`),
    })),
  ];
  return (
    <div className="space-y-2" data-tour="editor-xfade">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Blend size={15} className="text-[var(--dk-accent-hover)]" />
        {t("editor.xfadeTitle")}
      </p>
      <p className="text-xs text-[var(--dk-text-muted)]">
        {t("editor.xfadeToNext", { name: clipLabel(next) })}
      </p>
      <Select
        value={x?.kind ?? "none"}
        ariaLabel={t("editor.xfadeTitle")}
        options={options}
        onChange={(value) => {
          if (value === "none") removeXfade(clip.id);
          else if (isXfadeKind(value) && applyXfadeTo(clip.id, value)) previewXfade(clip.id);
        }}
      />
      {x ? (
        <>
          <div className="flex gap-1">
            {XFADE_PRESETS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => setXfadeSeconds(clip.id, seconds)}
                className={`flex-1 rounded-lg py-1 font-mono text-[11px] ${
                  Math.abs(x.duration - seconds) < 0.01
                    ? "bg-[var(--dk-accent)] text-white"
                    : "bg-[var(--dk-bg)] text-[var(--dk-text)] hover:bg-white/10"
                }`}
              >
                {t("editor.fadeSeconds", { n: seconds })}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PanelButton icon={<Play size={15} />} onClick={() => previewXfade(clip.id)}>
              {t("editor.xfadePreview")}
            </PanelButton>
            <PanelButton icon={<Trash2 size={15} />} onClick={() => removeXfade(clip.id)} danger>
              {t("editor.xfadeRemove")}
            </PanelButton>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Videonun bölümleri: tıklayınca imleç oraya gider; "Bölümlerden böl" her
 * bölümü ayrı klip yapar (istemediğini seçip silersin). */
function ChapterList({ clips }: { clips: SeqClip[] }) {
  const { t } = useTranslation();
  const source = useEditorStore((s) => s.source);
  const activeSourceId = useEditorStore((s) => s.activeSourceId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const chapters = sourceChapters(source);
  if (chapters.length === 0) return null;

  // İmlecin altındaki kaynak anı: hangi bölümde olduğumuzu vurgulamak için.
  // (Bölümler önizlenen kaynağa ait; başka kaynağın klibi sayılmaz.)
  const here = clips
    .filter(
      (c) =>
        (c.sourceId ?? activeSourceId) === activeSourceId &&
        currentTime >= c.start &&
        currentTime < clipEnd(c),
    )
    .sort((a, b) => b.track - a.track)[0];
  const sourceNow = here ? here.srcStart + (currentTime - here.start) * here.speed : null;

  return (
    <div className="space-y-2" data-tour="editor-chapters">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Bookmark size={15} className="text-[var(--dk-brand)]" />
          {t("editor.chapters", { count: chapters.length })}
        </p>
        <button
          type="button"
          onClick={splitByChapters}
          title={t("editor.splitChaptersHint")}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 py-1 text-xs font-medium hover:border-[var(--dk-border-strong)]"
        >
          <SplitSquareHorizontal size={13} />
          {t("editor.splitChapters")}
        </button>
      </div>
      <ol className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
        {chapters.map((chapter: Chapter, index) => {
          const onTimeline =
            timelineTimeOfSource(clips, chapter.start, activeSourceId ?? undefined) !== null;
          const active =
            sourceNow !== null && sourceNow >= chapter.start && sourceNow < chapter.end;
          return (
            <li key={chapter.start}>
              <button
                type="button"
                disabled={!onTimeline}
                onClick={() => jumpToSource(chapter.start)}
                title={onTimeline ? undefined : t("editor.chapterRemoved")}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                  active ? "bg-[#FFD43B]/15 text-white" : "hover:bg-white/5"
                }`}
              >
                <span className="w-12 shrink-0 font-mono text-[11px] text-[var(--dk-text-muted)] tabular-nums">
                  {formatTimecode(chapter.start, 0)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {chapter.title || t("editor.chapterUntitled", { n: index + 1 })}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PanelButton({
  icon,
  onClick,
  hint,
  danger,
  wide,
  disabled,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
  wide?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 items-center gap-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-3 text-xs font-medium transition-colors hover:border-[var(--dk-border-strong)] disabled:opacity-40 ${
        danger ? "text-[var(--dk-error)] hover:bg-[var(--dk-error)]/10" : "text-[var(--dk-text)]"
      } ${wide ? "col-span-2" : ""}`}
    >
      {icon}
      <span className="flex-1 truncate text-left">{children}</span>
      {hint ? (
        <span className="font-mono text-[10px] text-[var(--dk-text-muted)]">{hint}</span>
      ) : null}
    </button>
  );
}
