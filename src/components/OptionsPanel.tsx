import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Info } from "lucide-react";
import {
  AUDIO_FORMATS,
  VIDEO_FORMATS,
  isAudioFormat,
  type MediaMetadata,
  type OutputFormat,
} from "../types/media";
import type { DownloadOptions } from "../types/jobs";
import { PLATFORM_PRESETS } from "../types/resize";
import type { CompressPreset } from "../types/compress";
import type { OptionsTab } from "../store/workspaceStore";
import { buildChainSteps, estimateDownloadSize } from "../lib/jobPlanning";
import { checkSupportedUrl } from "../lib/validation";
import { formatBytes } from "../lib/format";
import { SUBTITLE_LANGUAGES, useSettingsStore } from "../lib/appSettings";
import { Select, type SelectOption } from "./ui/Select";
import { Tabs } from "./ui/Tabs";
import { Checkbox } from "./ui/Checkbox";
import { Button } from "./ui/Button";
import { PlatformIcon } from "./PlatformIcon";

const HEIGHT_NAMES: Record<number, string> = {
  2160: "4K",
  1440: "2K",
  1080: "Full HD",
  720: "HD",
};
const GENERIC_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const BITRATES = [128, 192, 256, 320];

interface OptionsPanelProps {
  metadata: MediaMetadata | null;
  /** Oynatma listesi açıksa seçili video sayısı; tek videoda null. */
  playlistCount?: number | null;
  options: DownloadOptions;
  onChange: (patch: Partial<DownloadOptions>) => void;
  tab: OptionsTab;
  onTabChange: (tab: OptionsTab) => void;
  destinationDir: string | null;
  onChangeDestination: () => void;
  startLabel: string;
  startIcon: ReactNode;
  canStart: boolean;
  onStart: () => void;
  /** Eklenen/atlanan sayısı; klasör seçimi iptal edildiyse null. */
  onEnqueueBatch: (urls: string[]) => Promise<{ added: number; skipped: number } | null>;
}

export function OptionsPanel(props: OptionsPanelProps) {
  const { t } = useTranslation();
  const { tab, onTabChange } = props;

  return (
    <section className="dk-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("options.title")}</h2>
        <Tabs
          value={tab}
          onChange={onTabChange}
          items={[
            { value: "basic", label: t("options.tabBasic") },
            { value: "advanced", label: t("options.tabAdvanced") },
            { value: "batch", label: t("options.tabBatch") },
          ]}
        />
      </div>

      {tab === "basic" ? <BasicTab {...props} /> : null}
      {tab === "advanced" ? <AdvancedTab {...props} /> : null}
      {tab === "batch" ? <BatchTab onEnqueue={props.onEnqueueBatch} /> : null}

      {tab !== "batch" ? <StartRow {...props} /> : null}
    </section>
  );
}

function BasicTab({ metadata, options, onChange }: OptionsPanelProps) {
  const { t } = useTranslation();
  const subtitleLangs = useSettingsStore((s) => s.subtitleLangs);
  const subtitleLangNames = subtitleLangs
    .map((code) => SUBTITLE_LANGUAGES.find((l) => l.code === code)?.label ?? code)
    .join(", ");
  const audio = isAudioFormat(options.outputFormat);

  const formatOptions: SelectOption<OutputFormat>[] = [
    ...VIDEO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase(), hint: t("options.video") })),
    ...AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase(), hint: t("options.audio") })),
  ];

  const heights = metadata ? metadata.qualityOptions.map((q) => q.height) : GENERIC_HEIGHTS;
  const qualityOptions: SelectOption<string>[] = [
    {
      value: "best",
      label: t("options.qualityBest"),
      hint: metadata
        ? sizeHint(metadata, { ...options, maxHeight: null, formatId: null })
        : undefined,
    },
    ...heights.map((h) => ({
      value: String(h),
      label: HEIGHT_NAMES[h] ? `${h}p (${HEIGHT_NAMES[h]})` : `${h}p`,
      hint: metadata ? sizeHint(metadata, { ...options, maxHeight: h, formatId: null }) : undefined,
    })),
  ];
  if (options.formatId) {
    qualityOptions.unshift({
      value: "advanced",
      label: t("options.qualityAdvanced", { id: options.formatId }),
    });
  }
  const qualityValue = options.formatId
    ? "advanced"
    : options.maxHeight
      ? String(options.maxHeight)
      : "best";

  const lossless = options.outputFormat === "wav" || options.outputFormat === "flac";
  const audioOptions: SelectOption<number>[] = BITRATES.map((b) => ({
    value: b,
    label: `${b} kbps`,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr_1fr]">
      <div className="space-y-3">
        <Field label={t("options.format")}>
          <Select
            value={options.outputFormat}
            options={formatOptions}
            onChange={(outputFormat) => onChange({ outputFormat })}
            ariaLabel={t("options.format")}
          />
        </Field>
        <Field label={t("options.quality")}>
          <Select
            value={qualityValue}
            options={qualityOptions}
            disabled={audio}
            onChange={(v) =>
              v === "advanced"
                ? undefined
                : onChange({ maxHeight: v === "best" ? null : Number(v), formatId: null })
            }
            ariaLabel={t("options.quality")}
          />
        </Field>
        <Field label={t("options.audioQuality")}>
          {audio && !lossless ? (
            <Select
              value={options.audioBitrateKbps}
              options={audioOptions}
              onChange={(audioBitrateKbps) => onChange({ audioBitrateKbps })}
              ariaLabel={t("options.audioQuality")}
            />
          ) : (
            <p className="flex h-10 items-center rounded-xl border border-dashed border-[var(--dk-border)] px-3 text-sm text-[var(--dk-text-muted)]">
              {lossless ? t("options.lossless") : t("options.sourceAudio")}
            </p>
          )}
        </Field>
      </div>

      <div className="lg:border-l lg:border-[var(--dk-border)] lg:pl-5">
        <p className="mb-3 text-sm font-medium">{t("options.platformTitle")}</p>
        <div className="space-y-2.5">
          {PLATFORM_PRESETS.map((preset) => (
            <Checkbox
              key={preset.id}
              disabled={audio}
              checked={options.platformTargets.includes(preset.id)}
              onChange={(checked) =>
                onChange({
                  platformTargets: checked
                    ? [...options.platformTargets, preset.id]
                    : options.platformTargets.filter((id) => id !== preset.id),
                })
              }
              label={
                <span className="flex items-center gap-2">
                  <PlatformIcon platform={preset.brand} size={18} />
                  {t(preset.labelKey)}
                  <span className="text-[var(--dk-text-muted)]">{preset.ratio.id}</span>
                </span>
              }
            />
          ))}
        </div>
        {options.platformTargets.length > 0 ? (
          <div className="mt-3 flex gap-1.5 text-xs">
            {(["crop", "pad"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ fitMode: mode })}
                className={`rounded-lg border px-2.5 py-1.5 ${
                  options.fitMode === mode
                    ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-white"
                    : "border-[var(--dk-border)] text-[var(--dk-text-muted)] hover:text-white"
                }`}
              >
                {t(mode === "crop" ? "resize.fitCrop" : "resize.fitPad")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="lg:border-l lg:border-[var(--dk-border)] lg:pl-5">
        <p className="mb-3 text-sm font-medium">{t("options.extrasTitle")}</p>
        <div className="space-y-2.5">
          <Checkbox
            disabled={audio}
            checked={options.subtitles}
            onChange={(subtitles) => onChange({ subtitles })}
            label={t("options.subtitles")}
            hint={t("options.subtitlesHint", { langs: subtitleLangNames })}
          />
          <Checkbox
            disabled={audio}
            checked={options.shrink}
            onChange={(shrink) => onChange({ shrink })}
            label={t("options.shrink")}
            hint={t("options.shrinkHint")}
          />
        </div>
        {options.shrink && !audio ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-1.5 text-xs">
              {(["high", "balanced", "small", "tiny"] as CompressPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChange({ shrinkPreset: preset, shrinkTargetMb: null })}
                  className={`rounded-lg border px-2.5 py-1.5 ${
                    !options.shrinkTargetMb && options.shrinkPreset === preset
                      ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-white"
                      : "border-[var(--dk-border)] text-[var(--dk-text-muted)] hover:text-white"
                  }`}
                >
                  {t(`compress.preset${preset[0].toUpperCase()}${preset.slice(1)}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--dk-text-muted)]">
              {t("options.targetMb")}
              <input
                type="number"
                min={1}
                value={options.shrinkTargetMb ?? ""}
                onChange={(e) => {
                  const mb = Number(e.target.value);
                  onChange({ shrinkTargetMb: Number.isFinite(mb) && mb > 0 ? mb : null });
                }}
                className="h-8 w-20 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 text-sm text-white outline-none focus:border-[var(--dk-accent)]"
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function sizeHint(metadata: MediaMetadata, options: DownloadOptions): string | undefined {
  const size = estimateDownloadSize(metadata, options);
  return size ? `~${formatBytes(size)}` : undefined;
}

function AdvancedTab({ metadata, playlistCount, options, onChange }: OptionsPanelProps) {
  const { t } = useTranslation();
  if (playlistCount != null) {
    return (
      <p className="py-6 text-center text-sm text-[var(--dk-text-muted)]">
        {t("playlist.noAdvanced")}
      </p>
    );
  }
  if (!metadata) {
    return (
      <p className="py-6 text-center text-sm text-[var(--dk-text-muted)]">
        {t("options.analyzeFirst")}
      </p>
    );
  }
  const rows = metadata.formats.filter((f) => !f.isAudioOnly);

  return (
    <div className="dk-scroll max-h-72 overflow-y-auto rounded-xl border border-[var(--dk-border)]">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-[var(--dk-surface-2)] text-xs text-[var(--dk-text-muted)]">
          <tr>
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 font-medium">{t("options.colResolution")}</th>
            <th className="px-3 py-2 font-medium">{t("options.colCodec")}</th>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 text-right font-medium">{t("options.colSize")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const active = f.formatId === options.formatId;
            return (
              <tr
                key={f.formatId}
                onClick={() =>
                  onChange({
                    formatId: f.formatId,
                    maxHeight: f.height,
                    outputFormat: isAudioFormat(options.outputFormat)
                      ? "mp4"
                      : options.outputFormat,
                  })
                }
                className={`cursor-pointer border-t border-[var(--dk-border)] ${
                  active ? "bg-[var(--dk-accent)]/15" : "hover:bg-white/5"
                }`}
              >
                <td className="px-3 py-2">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      active ? "border-[var(--dk-accent)]" : "border-[var(--dk-border-strong)]"
                    }`}
                  >
                    {active ? (
                      <span className="h-2 w-2 rounded-full bg-[var(--dk-accent)]" />
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-white">
                  {f.height ? `${f.height}p` : "—"} · {f.container.toUpperCase()}
                </td>
                <td className="px-3 py-2 text-[var(--dk-text-muted)]">{f.codecLabel ?? "—"}</td>
                <td className="px-3 py-2 text-[var(--dk-text-muted)]">{f.formatId}</td>
                <td className="px-3 py-2 text-right text-[var(--dk-text-muted)]">
                  {formatBytes(f.estimatedSizeBytes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BatchTab({ onEnqueue }: { onEnqueue: OptionsPanelProps["onEnqueueBatch"] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const lines = draft
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const valid = lines.filter((l) => checkSupportedUrl(l).status === "ok");

  return (
    <div className="space-y-3">
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setFeedback(null);
        }}
        placeholder={t("batch.placeholder")}
        rows={5}
        className="dk-scroll w-full resize-none rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3 text-sm outline-none placeholder:text-[var(--dk-text-muted)] focus:border-[var(--dk-accent)]"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-[var(--dk-text-muted)]">
          {feedback ??
            t("batch.detected", { valid: valid.length, skipped: lines.length - valid.length })}
        </span>
        <Button
          disabled={valid.length === 0}
          onClick={() =>
            void onEnqueue(valid).then((result) => {
              if (!result) return;
              setDraft("");
              setFeedback(
                result.skipped > 0
                  ? t("batch.addedWithSkipped", { count: result.added, skipped: result.skipped })
                  : t("batch.added", { count: result.added }),
              );
            })
          }
        >
          {t("batch.addToQueue", { count: valid.length })}
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-[var(--dk-text-muted)]">
        <Info size={13} />
        {t("batch.usesOptions")}
      </p>
    </div>
  );
}

function StartRow({
  metadata,
  playlistCount,
  options,
  destinationDir,
  onChangeDestination,
  startLabel,
  startIcon,
  canStart,
  onStart,
}: OptionsPanelProps) {
  const { t } = useTranslation();
  const size = metadata ? estimateDownloadSize(metadata, options) : null;
  // Aynı boyutu üreten platformlar (TikTok, Reels, Shorts) tek dosyada birleşir.
  const extraOutputs = buildChainSteps(options).length;
  const audio = isAudioFormat(options.outputFormat);

  return (
    <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[var(--dk-border)] pt-4">
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="text-[var(--dk-text)]">
          {options.outputFormat.toUpperCase()}
          {!audio
            ? ` · ${options.maxHeight ? `${options.maxHeight}p` : t("options.qualityBest")}`
            : ""}
          {size ? ` · ${t("options.estimated", { size: formatBytes(size) })}` : ""}
          {playlistCount != null ? ` · ${t("playlist.videoCount", { count: playlistCount })}` : ""}
          {!audio && extraOutputs > 0
            ? ` · ${t("options.extraOutputs", { count: extraOutputs })}`
            : ""}
        </p>
        <button
          type="button"
          onClick={onChangeDestination}
          className="flex max-w-full items-center gap-1.5 text-xs text-[var(--dk-text-muted)] hover:text-white"
        >
          <FolderOpen size={14} className="shrink-0" />
          <span className="truncate">{destinationDir ?? t("options.chooseDestination")}</span>
          <span className="shrink-0 text-[var(--dk-accent-hover)]">{t("options.change")}</span>
        </button>
      </div>
      <Button
        size="lg"
        data-tour="home-start"
        icon={startIcon}
        disabled={!canStart}
        onClick={onStart}
        className="min-w-44"
      >
        {startLabel}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-[var(--dk-text-muted)]">{label}</span>
      {children}
    </label>
  );
}
