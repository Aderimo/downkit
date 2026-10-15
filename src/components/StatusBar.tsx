import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobsStore } from "../store/jobsStore";
import { JobRow } from "./JobRow";
import { ACTIVE_STATUSES } from "../types/jobs";
import { CircleHelp, Rewind, Sparkles } from "lucide-react";
import { useRecorderStore } from "../store/recorderStore";
import { formatDuration } from "../lib/format";
import { getAppVersion } from "../lib/tauri-api";
import { useUpdateStore } from "../lib/updateCheck";
import { formatBytes, formatSpeed } from "../lib/format";
import { useToolDownloads } from "../lib/toolDownloads";
import type { TourId } from "../lib/tutorial";
import { useTutorialStore } from "../lib/tutorial";

/** `pageTour`: açık sayfanın turu; "?" düğmesi onu başlatır. */
export function StatusBar({
  pageTour,
  onOpenRecorder,
}: {
  pageTour: TourId | null;
  onOpenRecorder: () => void;
}) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const jobs = useJobsStore((s) => s.jobs);
  const update = useUpdateStore((s) => s.latest);
  const tools = Object.values(useToolDownloads((s) => s.active));
  const recording = useRecorderStore((s) => s.status.recording);
  const replay = useRecorderStore((s) => s.status.replay);

  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const running = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));
  const queued = jobs.filter((j) => j.status === "queued").length;
  const totalSpeed = running.reduce((sum, j) => sum + (j.speedBps ?? 0), 0);

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[var(--dk-border)] bg-[var(--dk-sidebar)] px-5 text-xs text-[var(--dk-text-muted)]">
      <span className="relative flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded px-1 hover:text-[var(--dk-text)] disabled:hover:text-inherit"
          disabled={jobs.length === 0}
          aria-expanded={jobsOpen}
          title={jobs.length > 0 ? t("status.showJobs") : undefined}
          onClick={() => setJobsOpen((v) => !v)}
        >
          <span
            className={`h-2 w-2 rounded-full ${running.length > 0 ? "animate-pulse bg-[var(--dk-accent)]" : "bg-[var(--dk-success)]"}`}
          />
          {running.length > 0 ? t("status.running", { count: running.length }) : t("status.ready")}
        </button>
        {jobsOpen && jobs.length > 0 ? (
          <div
            className="dk-card absolute bottom-full left-0 z-50 mb-2 max-h-[60vh] w-[420px] space-y-2 overflow-y-auto p-3 shadow-2xl shadow-black/50"
            data-jobs-popover
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--dk-text)]">{t("status.jobsTitle")}</p>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs hover:bg-white/5"
                onClick={() => setJobsOpen(false)}
              >
                {t("media.close")}
              </button>
            </div>
            {[...jobs]
              .reverse()
              .slice(0, 8)
              .map((job) => (
                <JobRow key={job.id} job={job} compact />
              ))}
          </div>
        ) : null}
        {queued > 0 ? ` · ${t("status.queued", { count: queued })}` : ""}
        {totalSpeed > 0 ? ` · ${formatSpeed(totalSpeed)}` : ""}
        {tools.map((tool) => {
          const percent = tool.total ? Math.round((tool.downloaded / tool.total) * 100) : null;
          return (
            <span key={tool.tool} className="ml-3 flex items-center gap-2">
              {tool.state === "failed" ? (
                <span className="text-[var(--dk-warning)]">
                  {t("tools.failed", { tool: t(`tools.name.${tool.tool}`) })}
                </span>
              ) : (
                <>
                  <span className="text-[var(--dk-text)]">
                    {tool.state === "done"
                      ? t("tools.ready", { tool: t(`tools.name.${tool.tool}`) })
                      : t("tools.downloading", {
                          tool: t(`tools.name.${tool.tool}`),
                          percent: percent ?? "…",
                        })}
                  </span>
                  {tool.state === "downloading" ? (
                    <>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--dk-border)]">
                        <span
                          className="block h-full rounded-full bg-[var(--dk-accent)] transition-[width]"
                          style={{ width: `${percent ?? 0}%` }}
                        />
                      </span>
                      <span>
                        {formatBytes(tool.downloaded)}
                        {tool.total ? ` / ${formatBytes(tool.total)}` : ""}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </span>
          );
        })}
      </span>
      <span className="flex items-center gap-3">
        {recording ? (
          <button
            type="button"
            onClick={onOpenRecorder}
            className="flex items-center gap-1.5 font-semibold text-[var(--dk-error)] hover:underline"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--dk-error)]" />
            {t("recorder.statusRecording", { time: formatDuration(recording.seconds) })}
          </button>
        ) : null}
        {replay ? (
          <button
            type="button"
            onClick={onOpenRecorder}
            title={t("recorder.replayTitle")}
            className="flex items-center gap-1.5 text-[var(--dk-brand)] hover:underline"
          >
            <Rewind size={13} />
            {t("recorder.statusReplay", { time: formatDuration(replay.seconds) })}
          </button>
        ) : null}
        {pageTour ? (
          <button
            type="button"
            data-tour="status-help"
            onClick={() => useTutorialStore.getState().start(pageTour)}
            className="flex items-center gap-1.5 rounded-full border border-[var(--dk-border-strong)] px-2.5 py-0.5 text-[var(--dk-text)] hover:border-[var(--dk-accent)] hover:text-white"
          >
            <CircleHelp size={13} />
            {t("tutorial.pageHelp")}
          </button>
        ) : null}
        {update ? (
          <button
            type="button"
            title={t("update.clickHint")}
            onClick={() => useUpdateStore.getState().openDialog()}
            className="dk-gradient flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-white hover:brightness-110"
          >
            <Sparkles size={12} />
            {t("update.available", { version: update.version })}
          </button>
        ) : null}
        <span>
          {t("app.name")}
          {version ? ` v${version}` : ""}
        </span>
      </span>
    </footer>
  );
}
