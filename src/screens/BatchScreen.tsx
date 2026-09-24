import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Layers, ListPlus } from "lucide-react";
import { checkSupportedUrl } from "../lib/validation";
import { enqueueMany } from "../lib/jobEngine";
import { defaultDownloadOptions } from "../lib/jobPlanning";
import { getSettings, useSettingsStore } from "../lib/appSettings";
import { changeDestination, ensureDestination } from "../lib/destination";
import { AUDIO_FORMATS, VIDEO_FORMATS, isAudioFormat, type OutputFormat } from "../types/media";
import { JobQueue } from "../components/JobQueue";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";

const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "360"];

export function BatchScreen() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  // Başlangıç değerleri Ayarlar'daki varsayılan format ve kaliteden gelir.
  const [format, setFormat] = useState<OutputFormat>(() => getSettings().defaultOutputFormat);
  const [quality, setQuality] = useState(() => String(getSettings().defaultMaxHeight ?? "best"));
  const [feedback, setFeedback] = useState<string | null>(null);
  const destinationDir = useSettingsStore((s) => s.defaultDownloadDir);

  const lines = draft
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const valid = Array.from(new Set(lines.filter((l) => checkSupportedUrl(l).status === "ok")));

  async function addAll() {
    const dir = await ensureDestination();
    if (!dir) return;
    const options = {
      ...defaultDownloadOptions(),
      outputFormat: format,
      maxHeight: quality === "best" ? null : Number(quality),
    };
    const { added, skipped } = enqueueMany(valid, dir, options);
    setFeedback(
      skipped > 0
        ? t("batch.addedWithSkipped", { count: added, skipped })
        : t("batch.added", { count: added }),
    );
    setDraft("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <Layers size={24} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{t("nav.batch")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("batch.subtitle")}</p>
        </div>
      </header>

      <section className="dk-card space-y-4 p-5">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setFeedback(null);
          }}
          placeholder={t("batch.placeholder")}
          rows={7}
          className="dk-scroll w-full resize-none rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3 text-sm outline-none placeholder:text-[var(--dk-text-muted)] focus:border-[var(--dk-accent)]"
        />
        <div className="grid gap-4 sm:grid-cols-[180px_220px_1fr]">
          <div>
            <p className="mb-1.5 text-sm text-[var(--dk-text-muted)]">{t("options.format")}</p>
            <Select
              value={format}
              onChange={setFormat}
              ariaLabel={t("options.format")}
              options={[...VIDEO_FORMATS, ...AUDIO_FORMATS].map((f) => ({
                value: f,
                label: f.toUpperCase(),
                hint: isAudioFormat(f) ? t("options.audio") : t("options.video"),
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm text-[var(--dk-text-muted)]">{t("options.quality")}</p>
            <Select
              value={quality}
              onChange={setQuality}
              disabled={isAudioFormat(format)}
              ariaLabel={t("options.quality")}
              options={QUALITIES.map((q) => ({
                value: q,
                label: q === "best" ? t("options.qualityBest") : t("batch.upTo", { height: q }),
              }))}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void changeDestination()}
              className="flex h-10 max-w-full items-center gap-2 text-sm text-[var(--dk-text-muted)] hover:text-white"
            >
              <FolderOpen size={16} className="shrink-0" />
              <span className="truncate">{destinationDir ?? t("options.chooseDestination")}</span>
              <span className="shrink-0 text-[var(--dk-accent-hover)]">{t("options.change")}</span>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dk-border)] pt-4 text-sm">
          <span className="text-[var(--dk-text-muted)]">
            {feedback ??
              t("batch.detected", { valid: valid.length, skipped: lines.length - valid.length })}
          </span>
          <Button
            icon={<ListPlus size={18} />}
            disabled={valid.length === 0}
            onClick={() => void addAll()}
          >
            {t("batch.addToQueue", { count: valid.length })}
          </Button>
        </div>
      </section>

      <JobQueue filter={(job) => job.kind === "download"} />
    </div>
  );
}
