import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  FileVideo,
  FolderOpen,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Shrink,
  Trash2,
  X,
} from "lucide-react";
import type { Job } from "../types/jobs";
import { formatBytes, formatDuration, formatEta, formatSpeed } from "../lib/format";
import { cancelJob, pauseJob, resumeJob, retryJob } from "../lib/jobEngine";
import { openMediaFile, revealInFolder } from "../lib/tauri-api";
import { useJobsStore } from "../store/jobsStore";
import { IconButton } from "./ui/Button";
import { PlatformIcon } from "./PlatformIcon";
import { isSupportedPlatform } from "../lib/platforms";

const KIND_ICON = {
  download: FileVideo,
  convert: RefreshCw,
  compress: Shrink,
  resize: Maximize2,
  trim: Scissors,
};

export function JobRow({ job }: { job: Job }) {
  const { t } = useTranslation();
  const [showDetail, setShowDetail] = useState(false);
  const remove = useJobsStore((s) => s.remove);

  const lastOutput = job.outputs.at(-1) ?? null;
  const KindIcon = KIND_ICON[job.kind];
  const isActive = ["preparing", "running", "postprocessing"].includes(job.status);
  const canPause = job.kind === "download" && (job.status === "running" || job.status === "queued");
  const quality =
    job.qualityLabel === "best"
      ? t("jobs.qualityBest")
      : job.qualityLabel === "lossless"
        ? t("options.lossless")
        : job.qualityLabel;

  const meta = [
    job.durationSeconds ? formatDuration(job.durationSeconds) : null,
    quality,
    job.formatLabel,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--dk-surface-2)]">
        {job.thumbnailUrl ? (
          <img src={job.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--dk-text-muted)]">
            <KindIcon size={22} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white" title={job.title}>
          {job.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--dk-text-muted)]">
          {isSupportedPlatform(job.platform) ? (
            <PlatformIcon platform={job.platform} size={14} />
          ) : null}
          {meta.join("  ·  ")}
        </p>
        {isActive || job.status === "paused" ? (
          <ProgressBar
            percent={job.status === "preparing" ? null : job.percent}
            paused={job.status === "paused"}
          />
        ) : null}
        {job.status === "error" && showDetail && job.errorDetail ? (
          <pre className="dk-scroll mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[11px] text-[var(--dk-text-muted)]">
            {job.errorDetail}
          </pre>
        ) : null}
      </div>

      <div className="w-56 shrink-0 text-right text-xs">
        <StatusLine
          job={job}
          onToggleDetail={() => setShowDetail((v) => !v)}
          showDetail={showDetail}
        />
        {isActive && job.speedBps ? (
          <p className="mt-0.5 text-[var(--dk-text)]">{formatSpeed(job.speedBps)}</p>
        ) : null}
        {job.downloadedBytes && (isActive || job.status === "paused") ? (
          <p className="mt-0.5 text-[var(--dk-text-muted)]">
            {formatBytes(job.downloadedBytes)}
            {job.totalBytesEstimate ? ` / ~${formatBytes(job.totalBytesEstimate)}` : ""}
            {isActive && job.etaSeconds
              ? ` · ${t("jobs.eta", { eta: formatEta(job.etaSeconds) })}`
              : ""}
          </p>
        ) : null}
        {job.status === "done" && job.fileSizeBytes ? (
          <p className="mt-0.5 text-[var(--dk-text-muted)]">
            {formatBytes(job.fileSizeBytes)}
            {job.outputs.length > 1 ? ` · ${t("jobs.outputs", { count: job.outputs.length })}` : ""}
          </p>
        ) : null}
        {job.status === "done" && job.notice ? (
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[var(--dk-warning)]">
            <AlertTriangle size={13} className="shrink-0" />
            {t(`jobs.notice.${job.notice}`, { defaultValue: job.notice })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {canPause ? (
          <IconButton label={t("jobs.pause")} onClick={() => pauseJob(job.id)}>
            <Pause size={16} />
          </IconButton>
        ) : null}
        {job.status === "paused" ? (
          <IconButton label={t("jobs.resume")} tone="accent" onClick={() => resumeJob(job.id)}>
            <Play size={16} />
          </IconButton>
        ) : null}
        {job.status === "done" && lastOutput ? (
          <>
            <IconButton label={t("jobs.openFile")} onClick={() => void openMediaFile(lastOutput)}>
              <Play size={16} />
            </IconButton>
            <IconButton
              label={t("jobs.showInFolder")}
              onClick={() => void revealInFolder(lastOutput)}
            >
              <FolderOpen size={16} />
            </IconButton>
          </>
        ) : null}
        {job.status === "error" || job.status === "canceled" ? (
          <IconButton label={t("jobs.retry")} tone="accent" onClick={() => retryJob(job.id)}>
            <RotateCcw size={16} />
          </IconButton>
        ) : null}
        {isActive || job.status === "queued" || job.status === "paused" ? (
          <IconButton label={t("jobs.cancel")} tone="danger" onClick={() => cancelJob(job.id)}>
            <X size={16} />
          </IconButton>
        ) : (
          <IconButton label={t("jobs.remove")} tone="danger" onClick={() => remove(job.id)}>
            <Trash2 size={15} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function StatusLine({
  job,
  showDetail,
  onToggleDetail,
}: {
  job: Job;
  showDetail: boolean;
  onToggleDetail: () => void;
}) {
  const { t } = useTranslation();

  switch (job.status) {
    case "queued":
      return <p className="text-[var(--dk-text-muted)]">{t("jobs.statusQueued")}</p>;
    case "paused":
      return (
        <p className="text-[var(--dk-warning)]">
          {t("jobs.statusPaused")}
          {job.percent !== null
            ? ` · ${t("common.percent", { value: Math.round(job.percent) })}`
            : ""}
        </p>
      );
    case "done":
      return (
        <p className="flex items-center justify-end gap-1 font-medium text-[var(--dk-success)]">
          <CircleCheck size={14} />
          {t("jobs.statusDone")}
        </p>
      );
    case "canceled":
      return <p className="text-[var(--dk-text-muted)]">{t("jobs.statusCanceled")}</p>;
    case "error":
      return (
        <div>
          <p className="flex items-center justify-end gap-1 font-medium text-[var(--dk-error)]">
            <AlertCircle size={14} />
            {t("jobs.statusError")}
          </p>
          <p
            className="mt-0.5 line-clamp-2 text-[var(--dk-text-muted)]"
            title={job.errorMessage ?? ""}
          >
            {job.errorMessage}
          </p>
          {job.errorDetail ? (
            <button
              type="button"
              onClick={onToggleDetail}
              className="mt-0.5 text-[var(--dk-accent-hover)] underline"
            >
              {showDetail ? t("error.hideDetails") : t("error.showDetails")}
            </button>
          ) : null}
        </div>
      );
    default: {
      const stage = job.stageKey
        ? t(job.stageKey, {
            target:
              job.stageKey === "jobs.stageResizingFor" && job.stageParam ? t(job.stageParam) : "",
          })
        : t("jobs.statusRunning");
      return (
        <p className="font-medium text-[var(--dk-accent-hover)]">
          {stage}
          {stagePercent(job) !== null
            ? ` · ${t("common.percent", { value: stagePercent(job) })}`
            : ""}
        </p>
      );
    }
  }
}

const STREAM_STAGES = ["jobs.stageVideo", "jobs.stageAudio"];
const INDETERMINATE_STAGES = [
  "jobs.stagePreparing",
  "jobs.stageStarting",
  "jobs.stageMerging",
  "jobs.stageConvertingAudio",
];

/** Durum yazısındaki yüzde: indirmede o anki akışın (video/ses) yüzdesi,
 * FFmpeg işlerinde işin kendi yüzdesi; birleştirme gibi aşamalarda yok. */
function stagePercent(job: Job): number | null {
  if (job.stageKey && STREAM_STAGES.includes(job.stageKey)) {
    return job.stageParam === null ? null : Number(job.stageParam);
  }
  if (job.stageKey && INDETERMINATE_STAGES.includes(job.stageKey)) return null;
  return job.percent === null ? null : Math.round(job.percent);
}

function ProgressBar({ percent, paused }: { percent: number | null; paused: boolean }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dk-surface-2)]">
      {percent === null ? (
        <div className="dk-gradient dk-indeterminate h-full w-2/5 rounded-full" />
      ) : (
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${paused ? "bg-[var(--dk-warning)]" : "dk-gradient"}`}
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      )}
    </div>
  );
}
