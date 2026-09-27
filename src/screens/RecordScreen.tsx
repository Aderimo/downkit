import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, Info, Video, X } from "lucide-react";
import { RecordCard, ReplayCard } from "../components/recorder/RecordControls";
import { RecorderSettingsCard } from "../components/recorder/RecorderSettingsCard";
import { RecordingsLibrary } from "../components/recorder/RecordingsLibrary";
import { ErrorBanner } from "../components/ErrorBanner";
import { useRecorderStore } from "../store/recorderStore";
import { refreshSources, resolveOutputDir } from "../lib/recorder";
import { formatBytes, formatDuration } from "../lib/format";
import { revealInFolder } from "../lib/tauri-api";

/** Ekran kaydı: kayıt, geriye dönük kayıt (anlık tekrar), ayarlar ve kayıtlar. */
export function RecordScreen({ onOpenInEditor }: { onOpenInEditor: (path: string) => void }) {
  const { t } = useTranslation();
  const error = useRecorderStore((s) => s.error);
  const lastSaved = useRecorderStore((s) => s.lastSaved);
  const notice = useRecorderStore((s) => s.notice);
  const patch = useRecorderStore((s) => s.patch);

  useEffect(() => {
    void refreshSources();
    resolveOutputDir().catch(() => {
      // Tarayıcı önizlemesinde klasör yok.
    });
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f87171] to-[#be123c] text-white shadow-lg">
          <Video size={24} />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{t("recorder.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("recorder.subtitle")}</p>
        </div>
      </header>

      {error ? (
        <ErrorBanner
          message={error.message}
          detail={error.detail}
          onDismiss={() => patch({ error: null })}
        />
      ) : null}

      {notice ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--dk-accent)]/30 bg-[var(--dk-accent)]/10 px-4 py-3 text-sm">
          <Info size={18} className="shrink-0 text-[var(--dk-accent-hover)]" />
          <p className="min-w-0 flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => patch({ notice: null })}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {lastSaved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#4ADE80]/30 bg-[#4ADE80]/10 px-4 py-3 text-sm">
          <CircleCheck size={18} className="shrink-0 text-[var(--dk-success)]" />
          <p className="min-w-0 flex-1 truncate">
            {lastSaved.kind === "replay"
              ? t("recorder.savedReplayTitle")
              : t("recorder.savedTitle")}
            <span className="text-[var(--dk-text-muted)]">
              {" "}
              · {formatDuration(lastSaved.seconds)} · {formatBytes(lastSaved.bytes)}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onOpenInEditor(lastSaved.path)}
            className="text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("recorder.openInEditor")}
          </button>
          <button
            type="button"
            onClick={() => void revealInFolder(lastSaved.path)}
            className="text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("recorder.showInFolder")}
          </button>
          <button
            type="button"
            aria-label={t("tutorial.close")}
            onClick={() => patch({ lastSaved: null })}
            className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <RecordCard />
        <ReplayCard />
      </div>
      <RecorderSettingsCard />
      <RecordingsLibrary onOpenInEditor={onOpenInEditor} />
    </div>
  );
}
