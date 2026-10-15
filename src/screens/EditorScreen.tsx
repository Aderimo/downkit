import { isSliderKey } from "../lib/sliderKeys";
import { PixelFilters } from "../components/editor/XfadePreview";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clapperboard,
  FileOutput,
  FilePlus2,
  Keyboard,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEditorStore, type FrameAspect } from "../store/editorStore";
import { closeProject, useProjectStore } from "../lib/project";
import {
  MissingMediaDialog,
  ProjectErrorBanner,
  ProjectMenu,
  ProjectStart,
  ProjectStatus,
} from "../components/editor/ProjectControls";
import { runShortcut } from "../lib/editorActions";
import { comboFromEvent, findAction, useShortcutStore } from "../lib/shortcuts";
import { formatDuration } from "../lib/format";
import { ExportPanel } from "../components/editor/ExportPanel";
import { ShortcutsDialog } from "../components/editor/ShortcutsDialog";
import { DropZone } from "../components/DropZone";
import { useEditorDrop, useEditorFileDrop } from "../lib/editorDrop";
import {
  SIMPLE_ADD_TOOLS,
  SIMPLE_EDIT_TOOLS,
  useAddTool,
  useEditorMode,
  useEditTool,
  usePalette,
  useStartFormat,
  type AddTool,
} from "../lib/editorPanel";
import { CommandPalette } from "../components/editor/CommandPalette";
import { ErrorBanner } from "../components/ErrorBanner";
import { Button } from "../components/ui/Button";
import { Workspace } from "../components/workspace/Workspace";
import { WorkspaceMenu } from "../components/workspace/WorkspaceMenu";
import { Menu, MenuDivider, MenuItem } from "../components/ui/Menu";
import { useWorkspaceStore } from "../lib/workspaces";

/** Klip Düzenleyici: kayıtları ve bilgisayardaki videoları zaman çizelgesinde
 * kes, böl, taşı, hızlandır ve dışa aktar. */
export function EditorScreen() {
  const phase = useEditorStore((s) => s.phase);
  return (
    <>
      {phase === "ready" ? <EditorWorkspace /> : <EditorStart />}
      <MissingMediaDialog />
      <PixelFilters />
    </>
  );
}

const START_FORMATS: { frame: FrameAspect; key: string; w: number; h: number }[] = [
  { frame: "9:16", key: "vertical", w: 14, h: 24 },
  { frame: "16:9", key: "landscape", w: 26, h: 15 },
  { frame: "1:1", key: "square", w: 20, h: 20 },
  { frame: "4:5", key: "portrait", w: 17, h: 21 },
  { frame: "original", key: "original", w: 22, h: 16 },
];

function EditorStart() {
  const { t } = useTranslation();
  const phase = useEditorStore((s) => s.phase);
  const error = useEditorStore((s) => s.error);
  const openFile = useEditorStore((s) => s.openFile);
  const close = useEditorStore((s) => s.close);
  const projectLoading = useProjectStore((s) => s.loading);
  const startFormat = useStartFormat((s) => s.frame);
  const setStartFormat = useStartFormat((s) => s.setFrame);
  // Seçilen biçim (9:16, 1:1…) dosya açılınca dışa aktarma çerçevesi olur.
  async function openWithFormat(path: string) {
    await openFile(path);
    const st = useEditorStore.getState();
    if (st.phase === "ready" && startFormat !== "original")
      st.setExportOptions({ frame: startFormat });
  }
  const loading = phase === "loading" || projectLoading;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg">
          <Clapperboard size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("editor.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("editor.subtitle")}</p>
        </div>
      </header>

      {error ? (
        <ErrorBanner message={error.message} detail={error.detail} onDismiss={close} />
      ) : null}

      <ProjectErrorBanner />
      <ProjectStart busy={loading} />

      <section className="space-y-2" data-tour="editor-format">
        <p className="text-sm font-semibold">{t("editor.startFormat")}</p>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          role="radiogroup"
          aria-label={t("editor.startFormat")}
        >
          {START_FORMATS.map((f) => (
            <button
              key={f.frame}
              type="button"
              role="radio"
              aria-checked={startFormat === f.frame}
              onClick={() => setStartFormat(f.frame)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                startFormat === f.frame
                  ? "dk-selected bg-[var(--dk-accent)]/10"
                  : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
              }`}
            >
              <span
                className="shrink-0 rounded-[4px] border-2 border-current text-[var(--dk-accent-hover)]"
                style={{ width: f.w, height: f.h }}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(`editor.format.${f.key}`)}</span>
                <span className="block truncate text-[11px] text-[var(--dk-text-muted)]">
                  {t(`editor.format.${f.key}Hint`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div data-tour="editor-drop">
        <DropZone onFile={(path) => void openWithFormat(path)} busy={loading} />
      </div>

      <section className="dk-card grid gap-4 p-5 sm:grid-cols-3">
        {(["feature1", "feature2", "feature3"] as const).map((key) => (
          <div key={key} className="flex gap-3">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-[var(--dk-accent-hover)]" />
            <div>
              <p className="text-sm font-medium">{t(`editor.${key}Title`)}</p>
              <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{t(`editor.${key}Desc`)}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function EditorWorkspace() {
  const { t } = useTranslation();
  const editTool = useEditTool((s) => s.tool);
  const setEditTool = useEditTool((s) => s.setTool);
  const mode = useEditorMode((s) => s.mode);
  const setMode = useEditorMode((s) => s.setMode);
  const paletteOpen = usePalette((s) => s.open);
  const setPaletteOpen = usePalette((s) => s.setOpen);
  const addTool = useAddTool((s) => s.tool);
  const setAddTool = useAddTool((s) => s.setTool);
  const source = useEditorStore((s) => s.source);
  const duration = useEditorStore((s) => s.duration);
  const clipCount = useEditorStore((s) => s.clips.length);
  const edited = useEditorStore((s) => s.past.length > 0);
  const projectPath = useProjectStore((s) => s.path);
  const projectDirty = useProjectStore((s) => s.dirty);
  // Kayıtlı projede yalnızca kaydedilmemiş değişiklik varsa sorulur; kaydedilmemiş projede her düzenlemede.
  const needsConfirm = projectPath ? projectDirty : edited;
  const panelTab = useEditorStore((s) => s.panelTab);
  const setPanelTab = useEditorStore((s) => s.setPanelTab);
  const [showKeys, setShowKeys] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const fps = source?.info.fps ?? null;
  useEditorShortcuts(fps);
  useEffect(() => {
    if (mode !== "simple") return;
    if (addTool && !SIMPLE_ADD_TOOLS.includes(addTool)) setAddTool("media");
    if (!SIMPLE_EDIT_TOOLS.includes(editTool)) setEditTool("clip");
  }, [mode, addTool, editTool, setAddTool, setEditTool]);
  useEditorFileDrop();
  const dropHover = useEditorDrop((s) => s.hovering);
  const simpleSteps = useWorkspaceStore((s) => s.active === "simple");

  if (!source) return null;
  const title = source.info.fileName;

  return (
    <div className="relative flex h-full min-h-[600px] flex-col gap-2 p-2">
      {dropHover ? (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--dk-accent)] bg-black/55 text-center">
          <div>
            <p className="text-2xl font-semibold text-white">{t("drop.release")}</p>
            <p className="mt-1 text-sm text-white/75">{t("editor.dropAnywhere")}</p>
          </div>
        </div>
      ) : null}
      {/* İnce üst çubuk: proje adı · mod · düzen · kaydet · dışa aktar · diğerleri. */}
      <header className="flex h-10 shrink-0 items-center gap-2 px-1" data-editor-header>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            <ProjectStatus fallback={title} />
          </p>
          <p className="text-[11px] leading-tight whitespace-nowrap text-[var(--dk-text-muted)]">
            {formatDuration(duration)}
          </p>
        </div>
        <div
          className="flex items-center rounded-lg border border-[var(--dk-border)] p-0.5"
          role="group"
          aria-label={t("editor.modeLabel")}
        >
          {(["simple", "pro"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              title={t(`editor.mode.${m}Hint`)}
              onClick={() => setMode(m)}
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                mode === m
                  ? "bg-[var(--dk-accent)] text-white"
                  : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
              }`}
            >
              {t(`editor.mode.${m}`)}
            </button>
          ))}
        </div>
        <WorkspaceMenu />
        {confirmClose ? (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>
              {t("history.cancelClear")}
            </Button>
            <Button variant="danger" size="sm" icon={<X size={15} />} onClick={closeProject}>
              {t("editor.changeSourceConfirm", { count: clipCount })}
            </Button>
          </div>
        ) : null}
        <ProjectMenu />
        <span data-tour="editor-export-open">
          <Button size="sm" icon={<FileOutput size={15} />} onClick={() => setPanelTab("export")}>
            {t("editor.exportButton")}
          </Button>
        </span>
        <Menu
          label={t("editor.moreMenu")}
          width={240}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={t("editor.moreMenu")}
              title={t("editor.moreMenu")}
              data-tour="editor-shortcuts"
              onClick={toggle}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
            >
              <MoreHorizontal size={17} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<Plus size={14} />}
                label={t("editor.addSource")}
                onSelect={() => {
                  close();
                  setAddTool("media");
                }}
              />
              <MenuItem
                icon={<Search size={14} />}
                label={t("palette.open")}
                onSelect={() => {
                  close();
                  setPaletteOpen(true);
                }}
              />
              <MenuItem
                icon={<Keyboard size={14} />}
                label={t("editor.shortcuts")}
                onSelect={() => {
                  close();
                  setShowKeys(true);
                }}
              />
              <MenuDivider />
              <MenuItem
                icon={<FilePlus2 size={14} />}
                label={t("editor.changeSource")}
                onSelect={() => {
                  close();
                  // Düzenleme yapıldıysa önce sorulur; emek yanlışlıkla kaybolmasın.
                  if (needsConfirm) setConfirmClose(true);
                  else closeProject();
                }}
              />
            </>
          )}
        </Menu>
      </header>
      {simpleSteps ? <SimpleSteps /> : null}
      <Workspace />
      {panelTab === "export" ? <ExportDialog onClose={() => setPanelTab("clip")} /> : null}
      {showKeys ? <ShortcutsDialog onClose={() => setShowKeys(false)} /> : null}
      {paletteOpen ? <CommandPalette fps={fps} onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}

/** Basit düzen: işin adımları (her adım ilgili aracı açar). */
function SimpleSteps() {
  const { t } = useTranslation();
  const tool = useAddTool((s) => s.tool);
  const setTool = useAddTool((s) => s.setTool);
  const setPanelTab = useEditorStore((s) => s.setPanelTab);
  const steps: { id: string; tool: AddTool | null }[] = [
    { id: "media", tool: "media" },
    { id: "cut", tool: "autocut" },
    { id: "captions", tool: "subtitles" },
    { id: "music", tool: "music" },
    { id: "share", tool: null },
  ];
  return (
    <nav
      className="flex shrink-0 items-center gap-1 px-1"
      aria-label={t("workspace.steps")}
      data-simple-steps
    >
      {steps.map((s, i) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={s.tool !== null && tool === s.tool}
          onClick={() => (s.tool ? setTool(s.tool) : setPanelTab("export"))}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            s.tool !== null && tool === s.tool
              ? "bg-[var(--dk-accent)] text-white"
              : "bg-[var(--dk-surface)] text-[var(--dk-text-muted)] hover:text-white"
          }`}
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[10px]">
            {i + 1}
          </span>
          {t(`workspace.step.${s.id}`)}
        </button>
      ))}
    </nav>
  );
}

/** Dışa aktarma / indirme ekranın ortasında açılır; ayarlar ve başlatma düğmesi burada. */
function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.export")}
        className="dk-card flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[var(--dk-border)] px-5 py-3">
          <span className="dk-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white">
            <FileOutput size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">{t("editor.export")}</h2>
            <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.exportDialogHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="dk-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <ExportPanel />
        </div>
      </div>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input:not([type=range]), textarea, select, [contenteditable='true']") !== null
  );
}

/** Düzenlenebilir kısayollar (düzenleyicideki "Kısayollar" penceresi). */
function useEditorShortcuts(fps: number | null) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      // Odaktaki kaydırıcı ok/Home/End tuşlarını kendisi kullanır (imleç gezinmesi değil).
      if (e.target instanceof HTMLInputElement && e.target.type === "range" && isSliderKey(e))
        return;
      // Açık bir pencere (tur, kısayollar) varsa tuşlar ona bırakılır.
      if (document.querySelector(".fixed.inset-0.z-50")) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = findAction(useShortcutStore.getState().map, combo);
      if (!action || !runShortcut(action, fps)) return;
      e.preventDefault();
      // Odaktaki düğme Boşluk/Enter ile ikinci kez tetiklenmesin.
      if (e.target instanceof HTMLButtonElement) e.target.blur();
    }
    // Zaman çizelgesi ve önizleme sürükleme için pointerdown'u engeller; bu,
    // tarayıcının odağı bırakmasını da engeller. Yazı kutusundan sonra klibe
    // tıklayınca odak kutuda kalıyor, Ctrl+A kutunun yazısını seçiyor, Delete
    // kutudan harf siliyordu. Yazı alanı dışına basılınca odak elle bırakılır.
    function onPointerDown(e: PointerEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && isTyping(active) && !isTyping(e.target)) active.blur();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [fps]);
}
