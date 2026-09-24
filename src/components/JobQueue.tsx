import { useTranslation } from "react-i18next";
import { ChevronRight, Inbox, Play, Trash2 } from "lucide-react";
import { resumeAll } from "../lib/jobEngine";
import { useJobsStore } from "../store/jobsStore";
import { FINISHED_STATUSES, type Job } from "../types/jobs";
import { JobRow } from "./JobRow";

interface JobQueueProps {
  /** Ana sayfada kısa liste; "Tümünü gör" İndirme sayfasına gider. */
  limit?: number;
  onViewAll?: () => void;
  filter?: (job: Job) => boolean;
  title?: string;
}

// Bitenler tek grupta en yeniden eskiye sıralanır: yeni biten bir iş, eski
// hataların altında kalıp kısa listeden düşmesin.
const ORDER: Record<Job["status"], number> = {
  running: 0,
  postprocessing: 0,
  preparing: 1,
  paused: 2,
  queued: 3,
  error: 4,
  done: 4,
  canceled: 4,
};

export function JobQueue({ limit, onViewAll, filter, title }: JobQueueProps) {
  const { t } = useTranslation();
  const allJobs = useJobsStore((s) => s.jobs);
  const clearFinished = useJobsStore((s) => s.clearFinished);

  const jobs = (filter ? allJobs.filter(filter) : allJobs)
    .slice()
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt - a.createdAt);
  const shown = limit ? jobs.slice(0, limit) : jobs;
  const hasFinished = jobs.some((j) => FINISHED_STATUSES.includes(j.status));
  const pausedCount = jobs.filter((j) => j.status === "paused").length;

  return (
    <section className="dk-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--dk-border)] px-5 py-3.5">
        <h2 className="text-lg font-semibold">
          {title ?? t("jobs.queueTitle")}{" "}
          <span className="text-[var(--dk-text-muted)]">({jobs.length})</span>
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {pausedCount > 0 ? (
            <button
              type="button"
              onClick={resumeAll}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[var(--dk-accent-hover)] hover:bg-white/5"
            >
              <Play size={14} />
              {t("jobs.resumeAll", { count: pausedCount })}
            </button>
          ) : null}
          {hasFinished ? (
            <button
              type="button"
              onClick={clearFinished}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
            >
              <Trash2 size={14} />
              {t("jobs.clearFinished")}
            </button>
          ) : null}
          {onViewAll && jobs.length > (limit ?? 0) ? (
            <button
              type="button"
              onClick={onViewAll}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[var(--dk-accent-hover)] hover:bg-white/5"
            >
              {t("jobs.viewAll")}
              <ChevronRight size={15} />
            </button>
          ) : null}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-[var(--dk-text-muted)]">
          <Inbox size={26} />
          {t("jobs.empty")}
        </div>
      ) : (
        <div className="divide-y divide-[var(--dk-border)]">
          {shown.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </section>
  );
}
