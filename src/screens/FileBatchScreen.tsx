import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Layers, Plus, Trash2, X } from "lucide-react";
import { enqueueLocal } from "../lib/jobEngine";
import { changeDestination, ensureDestination } from "../lib/destination";
import { useSettingsStore } from "../lib/appSettings";
import { chooseLocalMediaFiles, probeLocalFile } from "../lib/tauri-api";
import { useFileDrop } from "../lib/useFileDrop";
import { localizeError } from "../lib/errors";
import { AUDIO_FORMATS, VIDEO_FORMATS, type OutputFormat } from "../types/media";
import { PLATFORM_PRESETS, findPlatformPreset, resolveTargetSize } from "../types/resize";
import type { CompressPreset } from "../types/compress";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Tabs } from "../components/ui/Tabs";
import { JobQueue } from "../components/JobQueue";
import { ErrorBanner } from "../components/ErrorBanner";

type Operation = "convert" | "compress" | "resize";
const PRESETS: CompressPreset[] = ["high", "balanced", "small", "tiny"];
const TARGETS = [8, 10, 16, 25, 50];
const PRESET_LABEL: Record<CompressPreset, string> = {
  high: "compress.presetHigh",
  balanced: "compress.presetBalanced",
  small: "compress.presetSmall",
  tiny: "compress.presetTiny",
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Toplu: birçok dosyaya aynı işi uygular (biçim değiştir, küçült ya da
 * boyutlandır). Her dosya kuyrukta ayrı iş olur, sırayla işlenir. */
export function FileBatchScreen() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [operation, setOperation] = useState<Operation>("convert");
  const [format, setFormat] = useState<OutputFormat>("mp4");
  const [compress, setCompress] = useState<string>("preset:balanced");
  const [presetId, setPresetId] = useState(PLATFORM_PRESETS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const [startedIds, setStartedIds] = useState<string[]>([]);
  const destination = useSettingsStore((s) => s.defaultDownloadDir);

  const add = (paths: string[]) =>
    setFiles((current) => [...current, ...paths.filter((p) => !current.includes(p))]);
  useFileDrop((path) => add([path]));

  async function start() {
    const dir = await ensureDestination();
    if (!dir || files.length === 0) return;
    setBusy(true);
    setError(null);
    const ids: string[] = [];
    for (const path of files) {
      try {
        const info = await probeLocalFile(path);
        if (operation === "convert") {
          ids.push(
            enqueueLocal(
              { kind: "convert", inputPath: path, destinationDir: dir, targetContainer: format },
              info,
            ),
          );
        } else if (operation === "compress") {
          const [mode, value] = compress.split(":");
          ids.push(
            enqueueLocal(
              mode === "target"
                ? {
                    kind: "compress",
                    inputPath: path,
                    destinationDir: dir,
                    mode: "targetSize",
                    targetSizeMb: Number(value),
                    preset: null,
                  }
                : {
                    kind: "compress",
                    inputPath: path,
                    destinationDir: dir,
                    mode: "preset",
                    targetSizeMb: null,
                    preset: value as CompressPreset,
                  },
              info,
            ),
          );
        } else {
          const preset = findPlatformPreset(presetId) ?? PLATFORM_PRESETS[0];
          const size = resolveTargetSize(preset.ratio, preset.longEdge);
          ids.push(
            enqueueLocal(
              {
                kind: "resize",
                inputPath: path,
                destinationDir: dir,
                targetWidth: size.width,
                targetHeight: size.height,
                fitMode: "crop",
              },
              info,
            ),
          );
        }
      } catch (err) {
        // Okunamayan dosya atlanır; ötekiler yine kuyruğa girer.
        setError(localizeError(err, "batchFiles.unreadable"));
      }
    }
    setStartedIds((current) => [...ids, ...current]);
    setFiles([]);
    setBusy(false);
  }

  const formats = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <Layers size={24} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{t("batchFiles.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("batchFiles.subtitle")}</p>
        </div>
      </header>

      {error ? (
        <ErrorBanner
          message={error.message}
          detail={error.detail}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <section className="dk-card space-y-4 p-5" data-tour="batch-files">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {files.length > 0
              ? t("batchFiles.count", { count: files.length })
              : t("batchFiles.empty")}
          </p>
          <div className="flex gap-2">
            {files.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setFiles([])}
              >
                {t("batchFiles.clear")}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={async () => add(await chooseLocalMediaFiles())}
            >
              {t("batchFiles.add")}
            </Button>
          </div>
        </div>
        {files.length > 0 ? (
          <ul className="dk-scroll max-h-60 space-y-1 overflow-y-auto">
            {files.map((path) => (
              <li
                key={path}
                className="flex items-center gap-2 rounded-lg bg-[var(--dk-surface-2)] px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate" title={path}>
                  {fileName(path)}
                </span>
                <button
                  type="button"
                  aria-label={t("batchFiles.remove")}
                  onClick={() => setFiles((current) => current.filter((p) => p !== path))}
                  className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--dk-border-strong)] px-4 py-8 text-center text-sm text-[var(--dk-text-muted)]">
            {t("batchFiles.dropHint")}
          </p>
        )}
      </section>

      <section className="dk-card space-y-4 p-5">
        <Tabs
          value={operation}
          onChange={setOperation}
          items={[
            { value: "convert", label: t("convertPage.convert") },
            { value: "compress", label: t("convertPage.compress") },
            { value: "resize", label: t("convertPage.resize") },
          ]}
        />
        {operation === "convert" ? (
          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--dk-text-muted)]">{t("batchFiles.format")}</span>
            <Select
              value={format}
              onChange={setFormat}
              ariaLabel={t("batchFiles.format")}
              options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </label>
        ) : operation === "compress" ? (
          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--dk-text-muted)]">{t("batchFiles.compressTo")}</span>
            <Select
              value={compress}
              onChange={setCompress}
              ariaLabel={t("batchFiles.compressTo")}
              options={[
                ...PRESETS.map((p) => ({ value: `preset:${p}`, label: t(PRESET_LABEL[p]) })),
                ...TARGETS.map((mb) => ({
                  value: `target:${mb}`,
                  label: t("batchFiles.targetMb", { mb }),
                })),
              ]}
            />
          </label>
        ) : (
          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--dk-text-muted)]">{t("batchFiles.size")}</span>
            <Select
              value={presetId}
              onChange={setPresetId}
              ariaLabel={t("batchFiles.size")}
              options={PLATFORM_PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) }))}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void changeDestination()}
            className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
            title={destination ?? ""}
          >
            <FolderOpen size={14} />
            <span className="truncate">{destination ?? t("batchFiles.chooseFolder")}</span>
          </button>
          <Button
            className="ml-auto"
            icon={<Layers size={16} />}
            disabled={files.length === 0 || busy}
            onClick={() => void start()}
          >
            {t("batchFiles.start", { count: files.length })}
          </Button>
        </div>
      </section>

      {startedIds.length > 0 ? <JobQueue filter={(job) => startedIds.includes(job.id)} /> : null}
    </div>
  );
}
