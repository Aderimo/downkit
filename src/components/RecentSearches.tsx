import { useTranslation } from "react-i18next";
import { History, X } from "lucide-react";
import { useSearchStore } from "../lib/recentSearches";
import { PlatformIcon } from "./PlatformIcon";
import { isSupportedPlatform } from "../lib/platforms";

interface RecentSearchesProps {
  onSelect: (url: string) => void;
  onViewAll: () => void;
  limit?: number;
}

/** Başlığı bilinmeyen kayıt için kısa link. Sorgu da korunur: YouTube'da video
 * kimliği `?v=` içinde olduğu için onsuz tüm kayıtlar "youtube.com/watch" olurdu. */
function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}${parsed.search}`.slice(
      0,
      40,
    );
  } catch {
    return url.slice(0, 40);
  }
}

export function RecentSearches({ onSelect, onViewAll, limit = 5 }: RecentSearchesProps) {
  const { t } = useTranslation();
  const entries = useSearchStore((s) => s.entries);
  const remove = useSearchStore((s) => s.remove);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-[var(--dk-text-muted)]">
        <History size={15} />
        {t("analyze.recentSearches")}
      </span>
      {entries.slice(0, limit).map((entry) => (
        <span
          key={entry.url}
          className="group flex max-w-72 items-center gap-1.5 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface)] py-1 pl-2 pr-1 text-[var(--dk-text)]/85 hover:border-[var(--dk-border-strong)]"
        >
          {isSupportedPlatform(entry.platform) ? (
            <PlatformIcon platform={entry.platform} size={16} />
          ) : null}
          <button
            type="button"
            onClick={() => onSelect(entry.url)}
            title={entry.url}
            className="truncate hover:text-white"
          >
            {entry.title ?? shorten(entry.url)}
          </button>
          <button
            type="button"
            onClick={() => remove(entry.url)}
            aria-label={t("analyze.removeRecentSearch")}
            className="rounded p-0.5 text-[var(--dk-text-muted)] opacity-0 hover:text-[var(--dk-error)] group-hover:opacity-100"
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onViewAll}
        className="text-[var(--dk-accent-hover)] hover:underline"
      >
        {t("analyze.searchHistory")}
      </button>
    </div>
  );
}
