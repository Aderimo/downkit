import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import type { LocalMediaInfo } from "../types/convert";
import type { LocalFileStore } from "../store/localFileStore";
import { useJobsStore } from "../store/jobsStore";
import { useSettingsStore } from "../lib/appSettings";
import { changeDestination, ensureDestination } from "../lib/destination";
import { chooseLocalMediaFile } from "../lib/tauri-api";
import { useFileDrop } from "../lib/useFileDrop";
import { DropZone } from "./DropZone";
import { LocalFileCard } from "./LocalFileCard";
import { ErrorBanner } from "./ErrorBanner";
import { JobRow } from "./JobRow";
import { Button } from "./ui/Button";

interface LocalToolShellProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  useFile: LocalFileStore;
  renderOptions: (info: LocalMediaInfo) => ReactNode;
  summary?: (info: LocalMediaInfo) => string | null;
  startLabel: string;
  startIcon: ReactNode;
  canStart?: boolean;
  /** İşi kuyruğa ekler ve kuyruk kimliğini döner. */
  onStart: (info: LocalMediaInfo, destinationDir: string) => string;
}

export function LocalToolShell({
  title,
  subtitle,
  icon,
  useFile,
  renderOptions,
  summary,
  startLabel,
  startIcon,
  canStart = true,
  onStart,
}: LocalToolShellProps) {
  const { t } = useTranslation();
  const file = useFile();
  const destinationDir = useSettingsStore((s) => s.defaultDownloadDir);
  const lastJob = useJobsStore((s) => s.jobs.find((j) => j.id === file.lastJobId));

  // Dosya kartı gösterilirken de yeni bir dosya bırakılabilsin.
  useFileDrop(file.load, { enabled: file.phase === "ready" });

  async function start(info: LocalMediaInfo) {
    const dir = await ensureDestination();
    if (!dir) return;
    file.setLastJobId(onStart(info, dir));
  }

  async function changeFile() {
    const path = await chooseLocalMediaFile();
    if (path) void file.load(path);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          {icon}
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{subtitle}</p>
        </div>
      </header>

      {file.phase === "error" ? (
        <ErrorBanner
          message={file.errorMessage ?? t("error.probeFailed")}
          detail={file.errorDetail}
          onDismiss={file.reset}
        />
      ) : null}

      {file.phase === "ready" && file.info ? (
        <>
          <LocalFileCard info={file.info} onChange={() => void changeFile()} />
          <section className="dk-card space-y-5 p-5">
            {renderOptions(file.info)}
            <div className="flex flex-wrap items-center gap-4 border-t border-[var(--dk-border)] pt-4">
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                {summary?.(file.info) ? (
                  <p className="text-[var(--dk-text)]">{summary(file.info)}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void changeDestination()}
                  className="flex max-w-full items-center gap-1.5 text-xs text-[var(--dk-text-muted)] hover:text-white"
                >
                  <FolderOpen size={14} className="shrink-0" />
                  <span className="truncate">
                    {destinationDir ?? t("options.chooseDestination")}
                  </span>
                  <span className="shrink-0 text-[var(--dk-accent-hover)]">
                    {t("options.change")}
                  </span>
                </button>
              </div>
              <Button
                size="lg"
                icon={startIcon}
                disabled={!canStart}
                onClick={() => file.info && void start(file.info)}
                className="min-w-44"
              >
                {startLabel}
              </Button>
            </div>
          </section>
        </>
      ) : (
        <DropZone onFile={file.load} busy={file.phase === "probing"} />
      )}

      {lastJob ? (
        <section className="dk-card overflow-hidden">
          <p className="border-b border-[var(--dk-border)] px-5 py-3 text-sm font-medium">
            {t("local.lastJob")}
          </p>
          <JobRow job={lastJob} />
        </section>
      ) : null}
    </div>
  );
}
