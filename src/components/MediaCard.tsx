import { useTranslation } from "react-i18next";
import { Clapperboard, ExternalLink, Play, X } from "lucide-react";
import type { MediaMetadata } from "../types/media";
import { formatDuration } from "../lib/format";
import { PlatformIcon } from "./PlatformIcon";
import { PLATFORM_LABEL } from "../lib/platforms";

interface MediaCardProps {
  metadata: MediaMetadata;
  /** Klip Düzenleyici'de aç: indirmeden izle, sahneleri seç, yalnızca onları indir. */
  onOpenEditor: () => void;
  onOpenOriginal: () => void;
  onClear: () => void;
}

function formatUploadDate(raw: string | null, locale: string): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const date = new Date(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8)),
  );
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function MediaCard({ metadata, onOpenEditor, onOpenOriginal, onClear }: MediaCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const views =
    metadata.viewCount !== null
      ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
          metadata.viewCount,
        )
      : null;
  const uploaded = formatUploadDate(metadata.uploadDate, locale);

  const meta = [
    metadata.sourceWidth && metadata.sourceHeight
      ? `${metadata.sourceWidth} × ${metadata.sourceHeight}`
      : null,
    metadata.durationSeconds ? formatDuration(metadata.durationSeconds) : null,
    views ? t("media.views", { views }) : null,
    uploaded,
  ].filter(Boolean);

  return (
    <section className="dk-card relative flex gap-5 p-4" data-tour="home-media">
      <button
        type="button"
        onClick={onOpenEditor}
        title={t("media.openInEditor")}
        className="group relative h-36 w-64 shrink-0 overflow-hidden rounded-xl bg-black/40"
      >
        {metadata.thumbnailUrl ? (
          <img src={metadata.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45">
          <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/95 text-black opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play size={20} fill="currentColor" />
          </span>
        </span>
        {metadata.durationSeconds ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs text-white">
            {formatDuration(metadata.durationSeconds)}
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1 py-1 pr-10">
        <div className="mb-1.5 flex items-center gap-2 text-sm text-[var(--dk-text-muted)]">
          <PlatformIcon platform={metadata.platform} size={20} />
          {PLATFORM_LABEL[metadata.platform]}
        </div>
        <button
          type="button"
          onClick={onOpenOriginal}
          title={t("media.openSource")}
          className="group flex max-w-full items-center gap-2 text-left text-lg font-semibold text-white"
        >
          <span className="truncate group-hover:underline">{metadata.title}</span>
          <ExternalLink size={16} className="shrink-0 text-[var(--dk-text-muted)]" />
        </button>
        {metadata.uploader ? (
          <p className="mt-0.5 text-sm text-[var(--dk-text-muted)]">{metadata.uploader}</p>
        ) : null}
        {meta.length > 0 ? (
          <p className="mt-2 text-sm text-[var(--dk-text)]/80">{meta.join("  ·  ")}</p>
        ) : null}
        {metadata.description ? (
          <p className="mt-2 line-clamp-2 text-sm text-[var(--dk-text-muted)]">
            {metadata.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenEditor}
            className="dk-gradient flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-white shadow hover:brightness-110"
          >
            <Clapperboard size={15} />
            {t("media.openInEditor")}
          </button>
          <span className="text-xs text-[var(--dk-text-muted)]">{t("media.editorHint")}</span>
        </div>
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          title={t("media.clear")}
          aria-label={t("media.clear")}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <X size={17} />
        </button>
      </div>
    </section>
  );
}
