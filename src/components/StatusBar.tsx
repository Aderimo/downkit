import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";
import { Sparkles } from "lucide-react";
import { getAppVersion, openExternalLink } from "../lib/tauri-api";
import { useUpdateStore } from "../lib/updateCheck";
import { formatSpeed } from "../lib/format";

export function StatusBar() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const jobs = useJobsStore((s) => s.jobs);
  const update = useUpdateStore((s) => s.latest);

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
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${running.length > 0 ? "animate-pulse bg-[var(--dk-accent)]" : "bg-[var(--dk-success)]"}`}
        />
        {running.length > 0 ? t("status.running", { count: running.length }) : t("status.ready")}
        {queued > 0 ? ` · ${t("status.queued", { count: queued })}` : ""}
        {totalSpeed > 0 ? ` · ${formatSpeed(totalSpeed)}` : ""}
      </span>
      <span className="flex items-center gap-3">
        {update ? (
          <button
            type="button"
            onClick={() => void openExternalLink(update.url)}
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
