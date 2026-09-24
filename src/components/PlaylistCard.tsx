import { useTranslation } from "react-i18next";
import { ListVideo, X } from "lucide-react";
import type { PlaylistInfo } from "../types/media";
import { formatDuration } from "../lib/format";
import { Checkbox } from "./ui/Checkbox";
import { IconButton } from "./ui/Button";
import { PlatformIcon } from "./PlatformIcon";

interface PlaylistCardProps {
  playlist: PlaylistInfo;
  selection: string[];
  onToggle: (url: string) => void;
  onSelectAll: (urls: string[]) => void;
  onClear: () => void;
}

/** Oynatma listesi: videolar tek tek işaretlenip seçilenler kuyruğa eklenir. */
export function PlaylistCard({
  playlist,
  selection,
  onToggle,
  onSelectAll,
  onClear,
}: PlaylistCardProps) {
  const { t } = useTranslation();
  const selected = new Set(selection);
  const allSelected = selection.length === playlist.entries.length;
  const totalSeconds = playlist.entries
    .filter((e) => selected.has(e.url))
    .reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
  const truncated = playlist.totalCount !== null && playlist.totalCount > playlist.entries.length;

  return (
    <section className="dk-card overflow-hidden">
      <header className="flex items-start gap-4 p-5">
        <span className="dk-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg">
          <ListVideo size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--dk-accent-hover)]">
            {t("playlist.badge")}
          </p>
          <h2 className="truncate text-lg font-semibold text-white" title={playlist.title}>
            {playlist.title}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--dk-text-muted)]">
            <PlatformIcon platform={playlist.platform} size={16} />
            {[playlist.uploader, t("playlist.videoCount", { count: playlist.entries.length })]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
          {truncated ? (
            <p className="mt-1 text-xs text-[var(--dk-warning)]">
              {t("playlist.truncated", {
                shown: playlist.entries.length,
                total: playlist.totalCount,
              })}
            </p>
          ) : null}
        </div>
        <IconButton label={t("media.clear")} onClick={onClear}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--dk-border)] bg-[var(--dk-surface-2)]/60 px-5 py-2.5 text-sm">
        <Checkbox
          checked={allSelected}
          onChange={(checked) => onSelectAll(checked ? playlist.entries.map((e) => e.url) : [])}
          label={t("playlist.selectAll")}
        />
        <span className="text-[var(--dk-text-muted)]">
          {t("playlist.selected", { count: selection.length, total: playlist.entries.length })}
          {totalSeconds > 0 ? `  ·  ${formatDuration(totalSeconds)}` : ""}
        </span>
      </div>

      <ul className="dk-scroll max-h-80 divide-y divide-[var(--dk-border)] overflow-y-auto">
        {playlist.entries.map((entry, index) => {
          const isSelected = selected.has(entry.url);
          return (
            <li key={entry.url}>
              <label
                className={`flex cursor-pointer items-center gap-3 px-5 py-2 transition-colors hover:bg-white/5 ${
                  isSelected ? "" : "opacity-55"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(entry.url)}
                  className="h-4 w-4 shrink-0 accent-[var(--dk-accent)]"
                />
                <span className="w-7 shrink-0 text-right text-xs tabular-nums text-[var(--dk-text-muted)]">
                  {index + 1}
                </span>
                <span className="h-10 w-[72px] shrink-0 overflow-hidden rounded-md bg-[var(--dk-surface-2)]">
                  {entry.thumbnailUrl ? (
                    <img
                      src={entry.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-white" title={entry.title}>
                  {entry.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--dk-text-muted)]">
                  {entry.durationSeconds ? formatDuration(entry.durationSeconds) : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
