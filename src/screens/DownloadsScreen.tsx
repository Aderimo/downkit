import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";
import { JobQueue } from "../components/JobQueue";
import { HistoryPanel } from "./HistoryScreen";
import { Tabs } from "../components/ui/Tabs";
import { useDownloadsView } from "../lib/downloadsView";
import { ACTIVE_STATUSES, FINISHED_STATUSES } from "../types/jobs";

type Filter = "all" | "active" | "finished";

/** İndirme ve Geçmiş: çalışan/bitmiş işler kuyrukta, tamamlanan dosyalar ve
 * aramalar ikinci sekmede. */
export function DownloadsScreen({ onAnalyze }: { onAnalyze: (url: string) => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const view = useDownloadsView((s) => s.view);
  const setView = useDownloadsView((s) => s.setView);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <ArrowDownToLine size={24} />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{t("downloads.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("downloads.subtitle")}</p>
        </div>
        <div data-tour="downloads-view">
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: "queue", label: t("downloads.tabQueue") },
              { value: "history", label: t("downloads.tabHistory") },
            ]}
          />
        </div>
      </header>

      {view === "queue" ? (
        <>
          <div className="flex justify-end" data-tour="downloads-filter">
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { value: "all", label: t("downloads.filterAll") },
                { value: "active", label: t("downloads.filterActive") },
                { value: "finished", label: t("downloads.filterFinished") },
              ]}
            />
          </div>
          <div data-tour="downloads-list">
            <JobQueue
              filter={(job) =>
                filter === "all"
                  ? true
                  : filter === "active"
                    ? ACTIVE_STATUSES.includes(job.status) ||
                      job.status === "queued" ||
                      job.status === "paused"
                    : FINISHED_STATUSES.includes(job.status)
              }
            />
          </div>
          <p className="text-center text-xs text-[var(--dk-text-muted)]">
            {t("downloads.sessionNote")}
          </p>
        </>
      ) : (
        <HistoryPanel onAnalyze={onAnalyze} />
      )}
    </div>
  );
}
