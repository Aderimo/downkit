import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  FolderOpen,
  History,
  Maximize2,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Shrink,
  Trash2,
} from "lucide-react";
import { useHistoryStore, type HistoryEntry, type HistoryOperation } from "../lib/downloadHistory";
import { useSearchStore } from "../lib/recentSearches";
import { formatBytes } from "../lib/format";
import { openMediaFile, revealInFolder } from "../lib/tauri-api";
import { Tabs } from "../components/ui/Tabs";
import { Button, IconButton } from "../components/ui/Button";
import { PlatformIcon } from "../components/PlatformIcon";
import { isSupportedPlatform } from "../lib/platforms";

type Tab = "files" | "searches";

const OPERATION_ICON: Record<HistoryOperation, typeof ArrowDownToLine> = {
  download: ArrowDownToLine,
  convert: RefreshCw,
  compress: Shrink,
  resize: Maximize2,
  trim: Scissors,
};

interface HistoryScreenProps {
  /** Aramayı ana sayfada yeniden analiz eder. */
  onAnalyze: (url: string) => void;
}

export function HistoryScreen({ onAnalyze }: HistoryScreenProps) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("files");
  const [query, setQuery] = useState("");
  // Tümünü silmek geri alınamaz; ikinci bir tıklamayla onaylatılır.
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useHistoryStore();
  const searches = useSearchStore();

  const q = query.trim().toLocaleLowerCase(i18n.language);
  const files = history.entries.filter(
    (e) =>
      !q ||
      e.title.toLocaleLowerCase(i18n.language).includes(q) ||
      e.fileName.toLowerCase().includes(q),
  );
  const searchEntries = searches.entries.filter(
    (e) => !q || (e.title ?? e.url).toLocaleLowerCase(i18n.language).includes(q),
  );

  const dateFormat = (iso: string | null) =>
    iso && !iso.startsWith("1970")
      ? new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })
      : "";

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <History size={24} />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{t("history.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("history.subtitle")}</p>
        </div>
        <Tabs
          value={tab}
          onChange={(next) => {
            setTab(next);
            setConfirmClear(false);
          }}
          items={[
            { value: "files", label: `${t("history.tabFiles")} (${history.entries.length})` },
            {
              value: "searches",
              label: `${t("history.tabSearches")} (${searches.entries.length})`,
            },
          ]}
        />
      </header>

      <div className="flex items-center gap-3">
        <label className="dk-card flex h-11 flex-1 items-center gap-2 px-3">
          <Search size={17} className="text-[var(--dk-text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("history.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--dk-text-muted)]"
          />
        </label>
        {(tab === "files" ? history.entries.length : searches.entries.length) > 0 ? (
          confirmClear ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                {t("history.cancelClear")}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                onClick={() => {
                  if (tab === "files") history.clear();
                  else searches.clear();
                  setConfirmClear(false);
                }}
              >
                {t("history.confirmClear")}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              icon={<Trash2 size={15} />}
              onClick={() => setConfirmClear(true)}
            >
              {t("history.clear")}
            </Button>
          )
        ) : null}
      </div>

      {tab === "files" ? (
        <List empty={t("history.empty")}>
          {files.map((entry) => {
            const sourceUrl = entry.sourceUrl;
            return (
              <FileRow
                key={entry.id}
                entry={entry}
                date={dateFormat(entry.completedAt)}
                onRemove={() => history.remove(entry.id)}
                onRedownload={sourceUrl ? () => onAnalyze(sourceUrl) : undefined}
              />
            );
          })}
        </List>
      ) : (
        <List empty={t("history.emptySearches")}>
          {searchEntries.map((entry) => (
            <div key={entry.url} className="flex items-center gap-4 px-4 py-3">
              <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--dk-surface-2)]">
                {entry.thumbnailUrl ? (
                  <img src={entry.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[var(--dk-text-muted)]">
                    {isSupportedPlatform(entry.platform) ? (
                      <PlatformIcon platform={entry.platform} size={22} />
                    ) : (
                      <Search size={20} />
                    )}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {entry.title ?? entry.url}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--dk-text-muted)]">
                  {isSupportedPlatform(entry.platform) ? (
                    <PlatformIcon platform={entry.platform} size={14} />
                  ) : null}
                  <span className="truncate">{entry.url}</span>
                  {dateFormat(entry.searchedAt) ? ` · ${dateFormat(entry.searchedAt)}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<RotateCcw size={14} />}
                onClick={() => onAnalyze(entry.url)}
              >
                {t("history.analyzeAgain")}
              </Button>
              <IconButton
                label={t("history.remove")}
                tone="danger"
                onClick={() => searches.remove(entry.url)}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </List>
      )}
    </div>
  );
}

function List({ empty, children }: { empty: string; children: ReactNode[] }) {
  return (
    <section className="dk-card overflow-hidden">
      {children.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--dk-text-muted)]">{empty}</p>
      ) : (
        <div className="divide-y divide-[var(--dk-border)]">{children}</div>
      )}
    </section>
  );
}

function FileRow({
  entry,
  date,
  onRemove,
  onRedownload,
}: {
  entry: HistoryEntry;
  date: string;
  onRemove: () => void;
  onRedownload?: () => void;
}) {
  const { t } = useTranslation();
  const OpIcon = OPERATION_ICON[entry.operation];

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--dk-surface-2)]">
        {entry.thumbnailUrl ? (
          <img src={entry.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--dk-text-muted)]">
            <OpIcon size={20} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white" title={entry.filePath}>
          {entry.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--dk-text-muted)]">
          {isSupportedPlatform(entry.platform) ? (
            <PlatformIcon platform={entry.platform} size={14} />
          ) : null}
          <OpIcon size={13} />
          {[
            t(`history.op.${entry.operation}`),
            entry.formatLabel,
            formatBytes(entry.fileSizeBytes),
            date,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton label={t("jobs.openFile")} onClick={() => void openMediaFile(entry.filePath)}>
          <Play size={16} />
        </IconButton>
        <IconButton
          label={t("jobs.showInFolder")}
          onClick={() => void revealInFolder(entry.filePath)}
        >
          <FolderOpen size={16} />
        </IconButton>
        {onRedownload ? (
          <IconButton label={t("history.redownload")} tone="accent" onClick={onRedownload}>
            <RotateCcw size={16} />
          </IconButton>
        ) : null}
        <IconButton label={t("history.remove")} tone="danger" onClick={onRemove}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </div>
  );
}
