import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, FolderOpen, Video } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import { changeDestination } from "../lib/destination";
import { useRecorderSettings } from "../lib/recorderSettings";
import { resolveOutputDir } from "../lib/recorder";
import { useRecorderStore } from "../store/recorderStore";
import { chooseDownloadDir, openFolder } from "../lib/tauri-api";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";

function FolderRow({
  icon,
  title,
  path,
  placeholder,
  onChange,
  onReset,
  children,
}: {
  icon: ReactNode;
  title: string;
  path: string | null;
  placeholder: string;
  onChange: () => void;
  onReset?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className="text-[var(--dk-accent-hover)]">{icon}</span>
        {title}
      </p>
      <p
        className="truncate rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)] px-3 py-2 font-mono text-xs"
        title={path ?? ""}
      >
        {path ?? <span className="text-[var(--dk-text-muted)]">{placeholder}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={onChange}>
          {t("settings.chooseFolder")}
        </Button>
        {path ? (
          <Button variant="ghost" size="sm" onClick={() => void openFolder(path)}>
            {t("settings.openFolder")}
          </Button>
        ) : null}
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="px-1 text-xs text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("recorder.defaultFolder")}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--dk-border)] pt-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Ayarlar → Klasörler: indirme ve kayıt klasörleri tek yerde, bir kez seçilir. */
export function FolderSettings() {
  const { t } = useTranslation();
  const downloadDir = useSettingsStore((s) => s.defaultDownloadDir);
  const groupByPlatform = useSettingsStore((s) => s.groupByPlatform);
  const updateSettings = useSettingsStore((s) => s.update);
  const recordDir = useRecorderStore((s) => s.outputDir);
  const customRecordDir = useRecorderSettings((s) => s.outputDir);
  const byApp = useRecorderSettings((s) => s.byApp);
  const updateRecorder = useRecorderSettings((s) => s.update);

  // Kayıt klasörü varsayılan (Videolar\DownKit\Kayıtlar) ise yolu çözülüp gösterilir.
  useEffect(() => {
    void resolveOutputDir().catch(() => {});
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FolderRow
        icon={<Download size={16} />}
        title={t("settings.downloadsFolderTitle")}
        path={downloadDir}
        placeholder={t("settings.notSet")}
        onChange={() => void changeDestination()}
      >
        <Toggle
          label={t("settings.groupByPlatform")}
          hint={t("settings.groupByPlatformHint")}
          checked={groupByPlatform}
          onChange={(value) => updateSettings({ groupByPlatform: value })}
        />
      </FolderRow>
      <FolderRow
        icon={<Video size={16} />}
        title={t("settings.recordingsFolder")}
        path={recordDir}
        placeholder="…"
        onChange={async () => {
          const dir = await chooseDownloadDir();
          if (dir) {
            updateRecorder({ outputDir: dir });
            await resolveOutputDir();
          }
        }}
        onReset={
          customRecordDir
            ? async () => {
                updateRecorder({ outputDir: null });
                await resolveOutputDir();
              }
            : undefined
        }
      >
        <Toggle
          label={t("recorder.byApp")}
          hint={t("recorder.byAppHint")}
          checked={byApp}
          onChange={(value) => updateRecorder({ byApp: value })}
        />
      </FolderRow>
    </div>
  );
}
