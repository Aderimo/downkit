import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CalendarDays,
  Clapperboard,
  Film,
  FolderOpen,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useRecorderStore } from "../../store/recorderStore";
import { loadThumb, refreshRecordings } from "../../lib/recorder";
import { formatBytes, formatDuration } from "../../lib/format";
import { useRecorderSettings } from "../../lib/recorderSettings";
import { dayLabelKind, folderCounts, groupRecordings } from "../../lib/recordingsView";
import type { TimeRange } from "../../lib/timeRange";
import { TimeRangeEditor } from "../TimeRangeEditor";
import { localizeError } from "../../lib/errors";
import {
  openFolder,
  openLocalPreview,
  recordingDelete,
  recordingRename,
  recordingRepair,
  recordingTrim,
  revealInFolder,
} from "../../lib/tauri-api";
import type { RecordingFile } from "../../types/recorder";
import { Button } from "../ui/Button";

function formatDate(ms: number, lang: string): string {
  return new Date(ms).toLocaleString(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(ms: number, lang: string): string {
  return new Date(ms).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

function useDayLabel() {
  const { t, i18n } = useTranslation();
  return (dayStart: number) => {
    const kind = dayLabelKind(dayStart, Date.now());
    if (kind === "today") return t("recorder.today");
    if (kind === "yesterday") return t("recorder.yesterday");
    return new Date(dayStart).toLocaleDateString(i18n.language, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "dk-gradient border-transparent font-semibold text-white"
          : "border-[var(--dk-border-strong)] text-[var(--dk-text-muted)] hover:border-[var(--dk-accent)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Thumb({ file }: { file: RecordingFile }) {
  const thumb = useRecorderStore((s) => s.thumbs[file.path]);
  const ref = useRef<HTMLDivElement>(null);
  // Küçük resim yalnızca kart görününce üretilir (yüzlerce kayıt olabilir).
  useEffect(() => {
    const el = ref.current;
    if (!el || thumb !== undefined) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadThumb(file.path);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [file.path, thumb]);

  return (
    <div ref={ref} className="relative aspect-video overflow-hidden rounded-xl bg-[var(--dk-bg)]">
      {thumb ? (
        <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full items-center justify-center text-[var(--dk-text-muted)]">
          <Film size={28} className={thumb === undefined ? "animate-pulse" : ""} />
        </div>
      )}
      {file.durationSeconds ? (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
          {formatDuration(file.durationSeconds)}
        </span>
      ) : null}
      {file.needsRepair ? (
        <span className="absolute top-1.5 left-1.5 rounded bg-[#FFD43B] px-1.5 py-0.5 text-[10px] font-bold text-black">
          MKV
        </span>
      ) : null}
    </div>
  );
}

/** Kayıt klasöründeki videolar; tıklayınca uygulama içinde oynatılır. */
export function RecordingsLibrary({ onOpenInEditor }: { onOpenInEditor: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const recordings = useRecorderStore((s) => s.recordings);
  const loaded = useRecorderStore((s) => s.recordingsLoaded);
  const outputDir = useRecorderStore((s) => s.outputDir);
  const lastSaved = useRecorderStore((s) => s.lastSaved);
  const newestLast = useRecorderSettings((s) => s.libraryNewestLast);
  const update = useRecorderSettings((s) => s.update);
  const [open, setOpen] = useState<RecordingFile | null>(null);
  // undefined: tümü, null: uygulamaya ayrılmamışlar, ad: o klasör.
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  const dayLabel = useDayLabel();
  const folders = useMemo(() => folderCounts(recordings), [recordings]);
  const shownFolder =
    folder !== undefined && folders.some((f) => f.name === folder) ? folder : undefined;
  const groups = useMemo(
    () => groupRecordings(recordings, shownFolder, newestLast),
    [recordings, shownFolder, newestLast],
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshRecordings();
  }, [outputDir]);

  // Yeni kayıt gelince (liste yenilenince) o kart görünür yere kaydırılır:
  // eskiden yeniye sırada en altta durur.
  const savedPath = lastSaved?.path ?? null;
  useEffect(() => {
    if (!savedPath) return;
    const card = listRef.current?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(savedPath)}"]`,
    );
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [savedPath, recordings]);

  return (
    <section className="dk-card space-y-4 p-5" data-tour="record-library">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex flex-1 items-center gap-2.5 text-base font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Film size={17} />
          </span>
          {t("recorder.library")}
          {recordings.length > 0 ? (
            <span className="text-sm font-normal text-[var(--dk-text-muted)]">
              ({recordings.length})
            </span>
          ) : null}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={newestLast ? <ArrowDownWideNarrow size={14} /> : <ArrowUpWideNarrow size={14} />}
          onClick={() => update({ libraryNewestLast: !newestLast })}
          title={t("recorder.sortToggle")}
        >
          {newestLast ? t("recorder.sortOldestFirst") : t("recorder.sortNewestFirst")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={() => void refreshRecordings()}
        >
          {t("recorder.refresh")}
        </Button>
        {outputDir ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={14} />}
            onClick={() => void openFolder(outputDir)}
          >
            {t("recorder.openFolder")}
          </Button>
        ) : null}
      </div>

      {folders.length > 1 || folders[0]?.name ? (
        <div className="flex flex-wrap gap-2">
          <Chip active={shownFolder === undefined} onClick={() => setFolder(undefined)}>
            {t("recorder.allFolders")} <span className="opacity-70">{recordings.length}</span>
          </Chip>
          {folders.map((f) => (
            <Chip
              key={f.name ?? ""}
              active={shownFolder === f.name}
              onClick={() => setFolder(f.name)}
            >
              <FolderOpen size={12} />
              {f.name ?? t("recorder.otherFolder")} <span className="opacity-70">{f.count}</span>
            </Chip>
          ))}
        </div>
      ) : null}

      {loaded && recordings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--dk-border-strong)] py-10 text-center text-sm text-[var(--dk-text-muted)]">
          <Film size={28} />
          <p>{t("recorder.libraryEmpty")}</p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-5">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
                <CalendarDays size={13} />
                {dayLabel(group.dayStart)}
                <span className="font-normal normal-case">
                  · {t("recorder.recordingsCount", { count: group.files.length })}
                </span>
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                {group.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    data-path={file.path}
                    onClick={() => setOpen(file)}
                    className={`group space-y-2 rounded-2xl p-1.5 text-left transition hover:bg-white/5 ${
                      file.path === savedPath ? "ring-2 ring-[var(--dk-accent)]" : ""
                    }`}
                  >
                    <div className="relative">
                      <Thumb file={file} />
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
                          {file.needsRepair ? (
                            <Wrench size={18} />
                          ) : (
                            <Play size={18} className="ml-0.5" />
                          )}
                        </span>
                      </span>
                    </div>
                    <div className="px-1">
                      <p className="truncate text-sm font-medium text-white" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-xs text-[var(--dk-text-muted)]">
                        {formatTime(file.createdMs, i18n.language)} · {formatBytes(file.sizeBytes)}
                        {file.height ? ` · ${file.height}p` : ""}
                      </p>
                      {file.folder ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[var(--dk-accent-hover)]">
                          <FolderOpen size={11} className="shrink-0" />
                          {file.folder}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <RecordingPlayer
          file={open}
          dir={outputDir ?? ""}
          onClose={() => setOpen(null)}
          onOpenInEditor={(path) => {
            setOpen(null);
            onOpenInEditor(path);
          }}
        />
      ) : null}
    </section>
  );
}

function RecordingPlayer({
  file,
  dir,
  onClose,
  onOpenInEditor,
}: {
  file: RecordingFile;
  dir: string;
  onClose: () => void;
  onOpenInEditor: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [path, setPath] = useState(file.path);
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState(file.name);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [duration, setDuration] = useState(file.durationSeconds ?? 0);
  const [range, setRange] = useState<TimeRange>({ start: 0, end: file.durationSeconds ?? 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const needsRepair = path.toLowerCase().endsWith(".mkv");

  // Kırparken video seçili aralıkta döner: seçilen bölüm tekrar tekrar izlenebilir.
  function onTimeUpdate() {
    const video = videoRef.current;
    if (!trimming || !video) return;
    if (video.currentTime >= range.end || video.currentTime < range.start - 0.25) {
      video.currentTime = range.start;
    }
  }

  function changeRange(next: TimeRange) {
    const video = videoRef.current;
    // Hangi uç oynadıysa oraya gidilir: kesim yeri görülsün.
    if (video)
      video.currentTime = next.start !== range.start ? next.start : Math.max(0, next.end - 1);
    setRange(next);
  }

  function saveTrim(overwrite: boolean) {
    void act(async () => {
      const next = await recordingTrim(path, dir, range.start, range.end, overwrite);
      setTrimming(false);
      setUrl(null);
      setPath(next);
      setName(
        next
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? name,
      );
      setNotice(overwrite ? t("recorder.trimOverwritten") : t("recorder.trimSaved"));
      await refreshRecordings();
    });
  }

  useEffect(() => {
    if (needsRepair) return;
    let alive = true;
    openLocalPreview(path)
      .then((preview) => alive && setUrl(preview.url))
      .catch((err) => alive && setError(localizeError(err, "recorder.playFailed").message));
    return () => {
      alive = false;
    };
  }, [path, needsRepair]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !renaming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, renaming]);

  async function act(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(localizeError(err, "recorder.actionFailed").message);
    } finally {
      setWorking(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dk-card flex max-h-full w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--dk-border)] px-4 py-3">
          {renaming ? (
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const next = await recordingRename(path, dir, name);
                  setPath(next);
                  setRenaming(false);
                  await refreshRecordings();
                });
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setName(file.name);
                    setRenaming(false);
                  }
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--dk-accent)] bg-[var(--dk-surface-2)] px-3 text-sm outline-none"
              />
              <Button size="sm" type="submit" disabled={working || !name.trim()}>
                {t("recorder.save")}
              </Button>
            </form>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{name}</p>
              <p className="text-xs text-[var(--dk-text-muted)]">
                {formatDate(file.createdMs, i18n.language)}
                {file.folder ? ` · ${file.folder}` : ""} · {formatBytes(file.sizeBytes)}
                {file.durationSeconds ? ` · ${formatDuration(file.durationSeconds)}` : ""}
                {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("tutorial.close")}
            className="rounded-lg p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {needsRepair ? (
            <div className="space-y-3 p-10 text-center">
              <Wrench size={32} className="mx-auto text-[var(--dk-brand)]" />
              <p className="text-sm text-white">{t("recorder.repairHint")}</p>
              <Button
                icon={<Wrench size={16} />}
                disabled={working}
                onClick={() =>
                  void act(async () => {
                    const next = await recordingRepair(path, dir);
                    setPath(next);
                    await refreshRecordings();
                  })
                }
              >
                {working ? t("recorder.repairing") : t("recorder.repair")}
              </Button>
            </div>
          ) : url ? (
            <video
              ref={videoRef}
              key={url}
              src={url}
              controls
              autoPlay
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) {
                  setDuration(d);
                  setRange((r) => (r.end > 0 ? r : { start: 0, end: d }));
                }
              }}
              onTimeUpdate={onTimeUpdate}
              className="max-h-[62vh] w-full bg-black"
            />
          ) : (
            <p className="p-10 text-sm text-[var(--dk-text-muted)]">{error ?? "…"}</p>
          )}
        </div>

        {trimming && duration > 0 ? (
          <div className="space-y-3 border-t border-[var(--dk-border)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Scissors size={15} className="text-[var(--dk-accent-hover)]" />
              {t("recorder.trimTitle")}
              <span className="font-normal text-[var(--dk-text-muted)]">
                · {t("recorder.trimLength", { length: formatDuration(range.end - range.start) })}
              </span>
            </div>
            <TimeRangeEditor
              duration={duration}
              value={range}
              onChange={changeRange}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      videoRef.current &&
                      changeRange({
                        ...range,
                        start: Math.min(videoRef.current.currentTime, range.end - 0.5),
                      })
                    }
                  >
                    {t("recorder.trimStartHere")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      videoRef.current &&
                      changeRange({
                        ...range,
                        end: Math.max(videoRef.current.currentTime, range.start + 0.5),
                      })
                    }
                  >
                    {t("recorder.trimEndHere")}
                  </Button>
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="success"
                size="sm"
                icon={<Save size={14} />}
                disabled={working || range.end - range.start < 0.5}
                onClick={() => saveTrim(false)}
              >
                {working ? t("recorder.trimming") : t("recorder.trimSaveCopy")}
              </Button>
              <Button
                variant="successLight"
                size="sm"
                disabled={working || range.end - range.start < 0.5}
                onClick={() => saveTrim(true)}
                title={t("recorder.trimOverwriteHint")}
              >
                {t("recorder.trimOverwrite")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => setTrimming(false)}
              >
                {t("recorder.cancel")}
              </Button>
              {error ? <p className="text-xs text-[var(--dk-error)]">{error}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--dk-border)] px-4 py-3">
          {confirmDelete ? (
            <>
              <p className="flex-1 text-sm">{t("recorder.deleteConfirm")}</p>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                disabled={working}
                onClick={() =>
                  void act(async () => {
                    await recordingDelete(path, dir);
                    await refreshRecordings();
                    onClose();
                  })
                }
              >
                {t("recorder.delete")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                {t("recorder.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="edit"
                size="sm"
                icon={<Clapperboard size={14} />}
                disabled={needsRepair}
                onClick={() => onOpenInEditor(path)}
              >
                {t("recorder.openInEditor")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Scissors size={14} />}
                disabled={needsRepair || trimming || !url}
                onClick={() => {
                  setNotice(null);
                  setRange({ start: 0, end: duration });
                  setTrimming(true);
                }}
              >
                {t("recorder.trim")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<FolderOpen size={14} />}
                onClick={() => void revealInFolder(path)}
              >
                {t("recorder.showInFolder")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Pencil size={14} />}
                onClick={() => setRenaming(true)}
              >
                {t("recorder.rename")}
              </Button>
              <span className="flex-1" />
              {notice ? <p className="text-xs text-[var(--dk-success)]">{notice}</p> : null}
              {error && !trimming ? (
                <p className="text-xs text-[var(--dk-error)]">{error}</p>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setConfirmDelete(true)}
              >
                {t("recorder.delete")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
