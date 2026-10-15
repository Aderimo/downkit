import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  FileWarning,
  FolderOpen,
  History,
  Loader2,
  Save,
  SaveAll,
  SkipForward,
  Search,
  X,
} from "lucide-react";
import {
  cancelMissing,
  continueMissing,
  discardRecovery,
  existingRecentProjects,
  forgetRecent,
  loadRecovery,
  openProject,
  relinkMissing,
  resumeRecovery,
  saveProject,
  skipMissing,
  useProjectStore,
  type RecentProject,
} from "../../lib/project";
import { fileName, type ProjectData } from "../../lib/projectFile";
import { chooseRelinkFile } from "../../lib/tauri-api";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { formatCombo, useShortcutStore } from "../../lib/shortcuts";
import { Button } from "../ui/Button";
import { ErrorBanner } from "../ErrorBanner";

/** Başlıktaki Kaydet düğmesi + Farklı kaydet / Proje aç menüsü. */
export function ProjectMenu() {
  const { t } = useTranslation();
  const saving = useProjectStore((s) => s.saving);
  const dirty = useProjectStore((s) => s.dirty);
  const path = useProjectStore((s) => s.path);
  const map = useShortcutStore((s) => s.map);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const key = (action: "saveProject" | "saveProjectAs" | "openProject") =>
    map[action][0] ? formatCombo(map[action][0]) : "";

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const item = (icon: ReactNode, label: string, shortcut: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <span className="text-[var(--dk-text-muted)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut ? (
        <kbd className="font-mono text-[10px] text-[var(--dk-text-muted)]">{shortcut}</kbd>
      ) : null}
    </button>
  );

  return (
    <div ref={ref} className="relative flex items-center" data-tour="editor-save">
      <Button
        variant="secondary"
        size="sm"
        className="rounded-r-none"
        disabled={saving}
        icon={saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        title={`${t("project.save")}${key("saveProject") ? ` (${key("saveProject")})` : ""}`}
        onClick={() => void saveProject()}
      >
        {path && !dirty ? t("project.saved") : t("project.save")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="-ml-px rounded-l-none px-2"
        aria-label={t("project.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={14} />
      </Button>
      {open ? (
        <div
          role="menu"
          className="dk-card absolute top-full right-0 z-40 mt-1 w-60 p-1 shadow-xl shadow-black/40"
        >
          {item(
            <Save size={15} />,
            t("project.save"),
            key("saveProject"),
            () => void saveProject(),
          )}
          {item(
            <SaveAll size={15} />,
            t("project.saveAs"),
            key("saveProjectAs"),
            () => void saveProject({ as: true }),
          )}
          {item(
            <FolderOpen size={15} />,
            t("project.open"),
            key("openProject"),
            () => void openProject(),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Proje adı ve kayıt durumu (başlık altı). */
export function ProjectStatus({ fallback }: { fallback: string }) {
  const { t } = useTranslation();
  const name = useProjectStore((s) => s.name);
  const path = useProjectStore((s) => s.path);
  const dirty = useProjectStore((s) => s.dirty);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name ?? fallback}</span>
      {path ? (
        dirty ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--dk-warning)]"
            title={t("project.unsaved")}
            aria-label={t("project.unsaved")}
          />
        ) : null
      ) : (
        <span className="shrink-0 text-xs font-normal text-[var(--dk-text-muted)]">
          · {t("project.notSaved")}
        </span>
      )}
    </span>
  );
}

/** Proje hataları (açılamadı, kaydedilemedi): hem başlangıçta hem düzenleyicide. */
export function ProjectErrorBanner() {
  const error = useProjectStore((s) => s.error);
  if (!error) return null;
  return (
    <ErrorBanner
      message={error}
      detail={null}
      onDismiss={() => useProjectStore.setState({ error: null })}
    />
  );
}

/** Başlangıç ekranı: kurtarma kaydı, son projeler, proje aç. */
export function ProjectStart({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const [recovery, setRecovery] = useState<ProjectData | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);

  useEffect(() => {
    let alive = true;
    void loadRecovery().then((r) => alive && setRecovery(r));
    void existingRecentProjects().then((r) => alive && setRecent(r));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-3">
      {recovery && !busy ? (
        <section className="dk-card flex items-center gap-4 p-4" data-tour="editor-resume">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <History size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--dk-text-muted)]">
              {recovery.dirty && recovery.projectPath
                ? t("project.recoveredUnsaved")
                : t("editor.resumeTitle")}
            </p>
            <p className="truncate font-medium">
              {recovery.projectPath
                ? recovery.name
                : recovery.sources.map((s) => s.title).join(" + ")}
            </p>
            <p className="text-xs text-[var(--dk-text-muted)]">
              {t("editor.resumeMeta", {
                count: recovery.clips.length,
                date: new Date(recovery.savedAt).toLocaleString(),
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void discardRecovery();
              setRecovery(null);
            }}
          >
            {t("editor.resumeForget")}
          </Button>
          <Button
            size="sm"
            onClick={() => void resumeRecovery(recovery).then(() => refreshPlayback())}
          >
            {t("editor.resumeContinue")}
          </Button>
        </section>
      ) : null}

      <section className="dk-card space-y-2 p-4">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm font-semibold">{t("project.recentTitle")}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={15} />}
            disabled={busy}
            onClick={() => void openProject().then(() => refreshPlayback())}
          >
            {t("project.open")}
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("project.recentEmpty")}</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2" data-recent-projects>
            {recent.map((r) => (
              <li
                key={r.path}
                className="group flex items-center gap-2 rounded-lg border border-[var(--dk-border)] px-3 py-2 hover:border-[var(--dk-accent)]"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={busy}
                  title={r.path}
                  onClick={() => void openProject(r.path).then(() => refreshPlayback())}
                >
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-[11px] text-[var(--dk-text-muted)]">
                    {new Date(r.savedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("project.recentRemove", { name: r.name })}
                  title={t("project.recentRemove", { name: r.name })}
                  className="hidden h-6 w-6 items-center justify-center rounded text-[var(--dk-text-muted)] group-hover:flex hover:bg-white/10"
                  onClick={() => {
                    forgetRecent(r.path);
                    setRecent((list) => list.filter((x) => x.path !== r.path));
                  }}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Eksik medya: yeniden bağla ya da atla. Aynı klasördeki diğer eksikler kendiliğinden bulunur. */
export function MissingMediaDialog() {
  const { t } = useTranslation();
  const missing = useProjectStore((s) => s.missing);
  const loading = useProjectStore((s) => s.loading);
  if (!missing) return null;
  const pending = missing.missing.filter(
    (s) => !missing.relinked[s.id] && !missing.skipped.includes(s.id),
  );
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("project.missingTitle")}
    >
      <div className="dk-card w-full max-w-xl space-y-4 p-5 shadow-2xl shadow-black/60">
        <header className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-warning)]/15 text-[var(--dk-warning)]">
            <FileWarning size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{t("project.missingTitle")}</h2>
            <p className="text-xs text-[var(--dk-text-muted)]">{t("project.missingHint")}</p>
          </div>
        </header>
        <ul className="space-y-2" data-missing-media>
          {missing.missing.map((s) => {
            const relinked = missing.relinked[s.id];
            const skipped = missing.skipped.includes(s.id);
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p
                    className="truncate text-[11px] text-[var(--dk-text-muted)]"
                    title={relinked ?? s.path}
                  >
                    {relinked
                      ? t("project.missingFound", { path: relinked })
                      : skipped
                        ? t("project.missingSkipped")
                        : s.path}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Search size={14} />}
                  onClick={async () => {
                    const path = await chooseRelinkFile();
                    if (path) await relinkMissing(s.id, path);
                  }}
                >
                  {relinked
                    ? t("project.missingChange")
                    : t("project.missingLocate", { name: fileName(s.path) })}
                </Button>
                {!skipped ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<SkipForward size={14} />}
                    onClick={() => skipMissing(s.id)}
                  >
                    {t("project.missingSkip")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <footer className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancelMissing}>
            {t("history.cancelClear")}
          </Button>
          <Button
            size="sm"
            disabled={pending.length > 0 || loading}
            icon={loading ? <Loader2 size={15} className="animate-spin" /> : undefined}
            onClick={() => void continueMissing().then(() => refreshPlayback())}
          >
            {t("project.missingContinue")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
