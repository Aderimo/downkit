import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Rocket } from "lucide-react";
import {
  isAudioFormat,
  type AudioFormat,
  type OutputFormat,
  type VideoFormat,
} from "../types/media";
import type { DownloadOptions } from "../types/jobs";
import { PLATFORM_PRESETS } from "../types/resize";
import type { PresetsTab } from "../store/workspaceStore";
import { QUICK_PRESETS } from "../lib/jobPlanning";
import { Tabs } from "./ui/Tabs";
import { PlatformIcon } from "./PlatformIcon";

const VIDEO_CARDS: { format: VideoFormat; descKey: string }[] = [
  { format: "mp4", descKey: "presets.mp4Desc" },
  { format: "webm", descKey: "presets.webmDesc" },
  { format: "mov", descKey: "presets.movDesc" },
  { format: "avi", descKey: "presets.aviDesc" },
];

const AUDIO_CARDS: { format: AudioFormat; descKey: string }[] = [
  { format: "mp3", descKey: "presets.mp3Desc" },
  { format: "m4a", descKey: "presets.m4aDesc" },
  { format: "wav", descKey: "presets.wavDesc" },
  { format: "aac", descKey: "presets.aacDesc" },
];

interface PresetsPanelProps {
  tab: PresetsTab;
  onTabChange: (tab: PresetsTab) => void;
  options: DownloadOptions;
  onChange: (patch: Partial<DownloadOptions>) => void;
  onReplace: (options: DownloadOptions) => void;
}

export function PresetsPanel({
  tab,
  onTabChange,
  options,
  onChange,
  onReplace,
}: PresetsPanelProps) {
  const { t } = useTranslation();

  function toggleTarget(id: string) {
    const active = options.platformTargets.includes(id);
    onChange({
      platformTargets: active
        ? options.platformTargets.filter((p) => p !== id)
        : [...options.platformTargets, id],
      outputFormat: active ? options.outputFormat : pickVideo(options.outputFormat),
    });
  }

  return (
    <aside className="dk-card flex flex-col gap-5 p-5">
      <h2 className="text-lg font-semibold">{t("presets.title")}</h2>
      <Tabs
        stretch
        value={tab}
        onChange={onTabChange}
        items={[
          { value: "video", label: t("presets.tabVideo") },
          { value: "audio", label: t("presets.tabAudio") },
          { value: "quick", label: t("presets.tabQuick") },
        ]}
      />

      {tab === "video" ? (
        <>
          <Group title={t("presets.popularFormats")}>
            {VIDEO_CARDS.map((card) => (
              <PresetCard
                key={card.format}
                title={card.format.toUpperCase()}
                desc={t(card.descKey)}
                active={options.outputFormat === card.format}
                onClick={() => onChange({ outputFormat: card.format })}
              />
            ))}
          </Group>
          <Group title={t("presets.social")}>
            {PLATFORM_PRESETS.filter((p) => p.id !== "youtube").map((preset) => (
              <PresetCard
                key={preset.id}
                icon={<PlatformIcon platform={preset.brand} size={22} />}
                title={t(preset.labelKey)}
                desc={preset.ratio.id}
                active={options.platformTargets.includes(preset.id)}
                onClick={() => toggleTarget(preset.id)}
              />
            ))}
          </Group>
        </>
      ) : null}

      {tab === "audio" ? (
        <Group title={t("presets.audioFormats")}>
          {AUDIO_CARDS.map((card) => (
            <PresetCard
              key={card.format}
              title={card.format.toUpperCase()}
              desc={t(card.descKey)}
              active={options.outputFormat === card.format}
              onClick={() => onChange({ outputFormat: card.format, formatId: null })}
            />
          ))}
        </Group>
      ) : null}

      {tab === "quick" ? (
        <div className="flex flex-col gap-2">
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onReplace(preset.apply(options))}
              className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3 text-left transition hover:border-[var(--dk-accent)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">{t(preset.labelKey)}</span>
                <span className="block text-xs text-[var(--dk-text-muted)]">
                  {t(preset.descKey)}
                </span>
              </span>
              <ChevronRight size={16} className="text-[var(--dk-text-muted)]" />
            </button>
          ))}
        </div>
      ) : null}

      {tab !== "quick" ? (
        <button
          type="button"
          onClick={() => onTabChange("quick")}
          className="mt-auto flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[linear-gradient(135deg,rgb(79_123_255/18%),rgb(124_92_255/12%))] p-3.5 text-left transition hover:border-[var(--dk-accent)]"
        >
          <Rocket size={22} className="text-[var(--dk-accent-hover)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">{t("presets.quickTitle")}</span>
            <span className="block text-xs text-[var(--dk-text-muted)]">
              {t("presets.quickSubtitle")}
            </span>
          </span>
          <ChevronRight size={16} className="text-[var(--dk-text-muted)]" />
        </button>
      ) : null}
    </aside>
  );
}

function pickVideo(format: OutputFormat): OutputFormat {
  return isAudioFormat(format) ? "mp4" : format;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2.5 text-sm text-[var(--dk-text-muted)]">{title}</p>
      <div className="grid grid-cols-2 gap-2.5">{children}</div>
    </div>
  );
}

function PresetCard({
  title,
  desc,
  icon,
  active,
  onClick,
}: {
  title: string;
  desc: string;
  icon?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex min-h-16 items-center gap-2.5 rounded-xl border bg-[var(--dk-surface-2)] p-3 text-left transition ${
        active ? "dk-selected" : "border-[var(--dk-border)] hover:border-[var(--dk-border-strong)]"
      }`}
    >
      {icon}
      <span className="min-w-0 pr-3">
        <span className="line-clamp-2 text-sm font-semibold leading-tight text-white">{title}</span>
        <span className="block truncate text-xs text-[var(--dk-text-muted)]">{desc}</span>
      </span>
      {active ? (
        <span className="dk-gradient absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full">
          <Check size={11} strokeWidth={3} color="white" />
        </span>
      ) : null}
    </button>
  );
}
