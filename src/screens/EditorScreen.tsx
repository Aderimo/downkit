import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clapperboard,
  Download,
  ExternalLink,
  FileOutput,
  Film,
  History,
  Keyboard,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  Blend,
  Bookmark,
  Captions,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Type,
  Wand2,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  forgetSession,
  loadSession,
  reloadSource,
  resumeSession,
  useEditorStore,
} from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import {
  applyVolume,
  onSourceTime,
  playerReady,
  refreshPlayback,
  setPreviewRate,
  togglePlayback,
} from "../lib/sequencePlayer";
import { runShortcut } from "../lib/editorActions";
import { comboFromEvent, findAction, useShortcutStore } from "../lib/shortcuts";
import {
  createPreviewCopy,
  onPreviewCopyProgress,
  openOriginalUrl,
  readClipboardText,
} from "../lib/tauri-api";
import { checkSupportedUrl } from "../lib/validation";
import { localizeError } from "../lib/errors";
import { formatDuration } from "../lib/format";
import { PLATFORM_LABEL } from "../lib/platforms";
import { formatTimecode } from "../lib/timeline";
import { MediaPlayer } from "../components/editor/MediaPlayer";
import { MediaPanel } from "../components/editor/MediaPanel";
import { Timeline } from "../components/editor/Timeline";
import { ClipPanel } from "../components/editor/ClipPanel";
import { CropOverlay } from "../components/editor/CropOverlay";
import { TextLayer } from "../components/editor/TextLayer";
import { ExportPanel } from "../components/editor/ExportPanel";
import { ColorPanel, EffectsPanel, FiltersPanel } from "../components/editor/LookPanels";
import {
  PresetsPanel,
  SubtitlesPanel,
  TextTemplatesPanel,
  TransitionsPanel,
} from "../components/editor/AddPanels";
import { ToolRail, type RailItem } from "../components/editor/ToolRail";
import { lookCss } from "../lib/clipLook";
import { ShortcutsDialog } from "../components/editor/ShortcutsDialog";
import { UrlBar } from "../components/UrlBar";
import { DropZone } from "../components/DropZone";
import { ErrorBanner } from "../components/ErrorBanner";
import { PlatformIcon } from "../components/PlatformIcon";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";

/** Klip Düzenleyici: linki indirmeden ya da bilgisayardaki dosyayı izleyerek
 * zaman çizelgesinde kes, böl, taşı, hızlandır; yalnızca kalan kısımları indir. */
export function EditorScreen() {
  const phase = useEditorStore((s) => s.phase);
  return phase === "ready" ? <EditorWorkspace /> : <EditorStart />;
}

function EditorStart() {
  const { t } = useTranslation();
  const phase = useEditorStore((s) => s.phase);
  const error = useEditorStore((s) => s.error);
  const openUrl = useEditorStore((s) => s.openUrl);
  const openFile = useEditorStore((s) => s.openFile);
  const close = useEditorStore((s) => s.close);
  const [url, setUrl] = useState("");
  const [session, setSession] = useState(loadSession);
  const check = checkSupportedUrl(url);
  const loading = phase === "loading";

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

      {session && !loading ? (
        <section className="dk-card flex items-center gap-4 p-4" data-tour="editor-resume">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <History size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.resumeTitle")}</p>
            <p className="truncate font-medium">
              {session.sources.map((s) => s.title).join(" + ")}
            </p>
            <p className="text-xs text-[var(--dk-text-muted)]">
              {t("editor.resumeMeta", {
                count: session.clips.length,
                date: new Date(session.savedAt).toLocaleString(),
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              forgetSession();
              setSession(null);
            }}
          >
            {t("editor.resumeForget")}
          </Button>
          <Button size="sm" onClick={() => void resumeSession().then(() => refreshPlayback())}>
            {t("editor.resumeContinue")}
          </Button>
        </section>
      ) : null}

      <section className="space-y-3" data-tour="editor-link">
        <p className="text-sm font-medium">{t("editor.fromLink")}</p>
        <UrlBar
          value={url}
          onChange={setUrl}
          onAnalyze={() => void openUrl(url.trim())}
          onPaste={async () => {
            const text = await readClipboardText();
            if (text) setUrl(text.trim());
          }}
          canAnalyze={check.status === "ok"}
          isAnalyzing={loading}
          actionLabel={t("editor.openLink")}
          actionIcon={<Clapperboard size={18} />}
        />
        {check.status === "invalid" || check.status === "unsupported" ? (
          <p className="text-sm text-[var(--dk-warning)]">
            {check.status === "invalid" ? t("validation.invalid") : t("validation.unsupported")}
          </p>
        ) : null}
      </section>

      <div className="flex items-center gap-3 text-xs text-[var(--dk-text-muted)] uppercase">
        <span className="h-px flex-1 bg-[var(--dk-border)]" />
        {t("editor.or")}
        <span className="h-px flex-1 bg-[var(--dk-border)]" />
      </div>

      <div data-tour="editor-drop">
        <DropZone onFile={openFile} busy={loading} />
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
  const [editTool, setEditTool] = useState<EditTool>("clip");
  // Medya paneli Clipchamp'taki gibi varsayılan olarak açık başlar.
  const [addTool, setAddTool] = useState<AddTool | null>("media");
  const editItems: RailItem<EditTool>[] = [
    { id: "clip", label: t("editor.toolClip"), icon: <SlidersHorizontal size={18} /> },
    { id: "filters", label: t("editor.toolFilters"), icon: <Sparkles size={18} /> },
    { id: "color", label: t("editor.toolColor"), icon: <SunMedium size={18} /> },
    { id: "effects", label: t("editor.toolEffects"), icon: <Wand2 size={18} /> },
  ];
  const addItems: RailItem<AddTool>[] = [
    { id: "media", label: t("editor.toolMedia"), icon: <Film size={18} /> },
    { id: "text", label: t("editor.toolText"), icon: <Type size={18} /> },
    { id: "transitions", label: t("editor.toolTransitions"), icon: <Blend size={18} /> },
    { id: "subtitles", label: t("editor.toolSubtitles"), icon: <Captions size={18} /> },
    { id: "presets", label: t("editor.toolPresets"), icon: <Bookmark size={18} /> },
  ];
  const source = useEditorStore((s) => s.source);
  const stream = useEditorStore((s) => s.stream);
  const duration = useEditorStore((s) => s.duration);
  const close = useEditorStore((s) => s.close);
  const clipCount = useEditorStore((s) => s.clips.length);
  const edited = useEditorStore((s) => s.past.length > 0);
  const panelTab = useEditorStore((s) => s.panelTab);
  const setPanelTab = useEditorStore((s) => s.setPanelTab);
  const [showKeys, setShowKeys] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const fps = source?.kind === "local" ? source.info.fps : (source?.metadata.fps ?? null);
  useEditorShortcuts(fps);

  if (!source) return null;
  const remote = source.kind === "remote";
  const title = remote ? source.metadata.title : source.info.fileName;

  return (
    <div className="flex h-full min-h-[660px] flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="dk-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
          <Clapperboard size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{title}</p>
          <p className="flex items-center gap-2 text-xs whitespace-nowrap text-[var(--dk-text-muted)]">
            {remote ? (
              <>
                <PlatformIcon platform={source.metadata.platform} size={16} />
                {PLATFORM_LABEL[source.metadata.platform]}
              </>
            ) : (
              t("editor.localFile")
            )}
            <span>· {formatDuration(duration)}</span>
            {remote ? (
              <span className="hidden truncate min-[1300px]:inline">
                · {t("editor.notDownloaded")}
              </span>
            ) : null}
          </p>
        </div>
        {remote ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={15} />}
            onClick={() => void openOriginalUrl(source.url)}
          >
            {t("media.openSource")}
          </Button>
        ) : null}
        <span data-tour="editor-add-source">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={15} />}
            // Medya paneli açılır (Clipchamp'taki Medyam); oradan dosya/link eklenir.
            onClick={() => setAddTool(addTool === "media" ? null : "media")}
          >
            {t("editor.addSource")}
          </Button>
        </span>
        <span data-tour="editor-shortcuts">
          <Button
            variant="secondary"
            size="sm"
            icon={<Keyboard size={15} />}
            onClick={() => setShowKeys(true)}
          >
            {t("editor.shortcuts")}
          </Button>
        </span>
        {confirmClose ? (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>
              {t("history.cancelClear")}
            </Button>
            <Button variant="danger" size="sm" icon={<X size={15} />} onClick={close}>
              {t("editor.changeSourceConfirm", { count: clipCount })}
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<X size={15} />}
            // Düzenleme yapıldıysa önce sorulur; emek yanlışlıkla kaybolmasın.
            onClick={() => (edited ? setConfirmClose(true) : close())}
          >
            {t("editor.changeSource")}
          </Button>
        )}
        <span data-tour="editor-export-open">
          <Button
            size="sm"
            icon={remote ? <Download size={15} /> : <FileOutput size={15} />}
            onClick={() => setPanelTab("export")}
          >
            {remote ? t("editor.download") : t("editor.exportButton")}
          </Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Sol: medya kitaplığı ve ekleme araçları (metin, geçiş, altyazı, hazır ayar). */}
        <aside className="dk-card flex shrink-0 overflow-hidden" data-tour="editor-add">
          <ToolRail
            side="left"
            items={addItems}
            value={addTool}
            onChange={(id) => setAddTool(addTool === id ? null : id)}
          />
          {addTool ? (
            <div
              className={`dk-scroll overflow-y-auto p-4 ${addTool === "media" ? "w-80" : "w-64"}`}
            >
              {addTool === "media" ? <MediaPanel /> : null}
              {addTool === "text" ? <TextTemplatesPanel /> : null}
              {addTool === "transitions" ? <TransitionsPanel /> : null}
              {addTool === "subtitles" ? <SubtitlesPanel /> : null}
              {addTool === "presets" ? <PresetsPanel /> : null}
            </div>
          ) : null}
        </aside>
        <section
          className="dk-card flex min-w-0 flex-1 flex-col overflow-hidden"
          data-tour="editor-player"
        >
          <PlayerArea key={stream?.token ?? "none"} />
          <PlayerBar />
        </section>
        {/* Sağ: seçili klibi düzenleme araçları (Clipchamp'taki gibi). */}
        <aside className="dk-card flex w-[380px] shrink-0 overflow-hidden" data-tour="editor-panel">
          <div className="dk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
            {editTool === "clip" ? <ClipPanel /> : null}
            {editTool === "filters" ? <FiltersPanel /> : null}
            {editTool === "color" ? <ColorPanel /> : null}
            {editTool === "effects" ? <EffectsPanel /> : null}
          </div>
          <ToolRail
            side="right"
            tour="editor-tools"
            items={editItems}
            value={editTool}
            onChange={setEditTool}
          />
        </aside>
      </div>

      <Timeline />
      {panelTab === "export" ? (
        <ExportDialog remote={remote} onClose={() => setPanelTab("clip")} />
      ) : null}
      {showKeys ? <ShortcutsDialog onClose={() => setShowKeys(false)} /> : null}
    </div>
  );
}

type EditTool = "clip" | "filters" | "color" | "effects";
type AddTool = "media" | "text" | "transitions" | "subtitles" | "presets";

/** Dışa aktarma / indirme ekranın ortasında açılır; ayarlar ve başlatma düğmesi burada. */
function ExportDialog({ remote, onClose }: { remote: boolean; onClose: () => void }) {
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
        aria-label={remote ? t("editor.tabDownload") : t("editor.export")}
        className="dk-card flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[var(--dk-border)] px-5 py-3">
          <span className="dk-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white">
            {remote ? <Download size={16} /> : <FileOutput size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">
              {remote ? t("editor.tabDownload") : t("editor.export")}
            </h2>
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

function PlayerArea() {
  const { t } = useTranslation();
  const source = useEditorStore((s) => s.source);
  const stream = useEditorStore((s) => s.stream);
  const replaceStream = useEditorStore((s) => s.replaceStream);
  const inGap = usePlayerStore((s) => s.inGap);
  const gapPlaying = usePlayerStore((s) => s.gapPlaying);
  const clipOpacity = usePlayerStore((s) => s.clipOpacity);
  const clipFadeWhite = usePlayerStore((s) => s.clipFadeWhite);
  const clipLook = usePlayerStore((s) => s.clipLook);
  const look = lookCss(clipLook);
  const frameAspect = useEditorStore((s) => s.exportOptions.frame);
  const output = useEditorStore((s) => s.exportOptions.output);
  // Dikey/kare çerçeve seçiliyken İndir sekmesinde kalacak bölge gösterilir.
  const sourceAspect = (() => {
    const w = source?.kind === "remote" ? source.metadata.sourceWidth : source?.info.width;
    const h = source?.kind === "remote" ? source.metadata.sourceHeight : source?.info.height;
    return w && h ? w / h : 16 / 9;
  })();
  // Dikey/kare çerçeve seçiliyse kalacak bölge önizlemede hep görünür: dışa aktarma
  // penceresi kapanınca sürüklenerek konumlandırılır.
  const showCrop = frameAspect !== "original" && output !== "audio";
  const setApi = usePlayerStore((s) => s.setApi);
  const patch = usePlayerStore((s) => s.patch);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<{ percent: number | null; error: string | null } | null>(null);

  // Oynatıcı değişince ses ayarları yeni öğeye de uygulanır.
  useEffect(() => {
    const { api, muted } = usePlayerStore.getState();
    applyVolume();
    api?.setMuted(muted);
  });

  async function makeCopy() {
    if (!stream) return;
    setCopy({ percent: null, error: null });
    const unlisten = await onPreviewCopyProgress((p) => {
      if (p.token === stream.token) setCopy({ percent: p.percent, error: null });
    });
    try {
      const result = await createPreviewCopy(stream.token);
      replaceStream({ ...stream, url: result.url, token: result.token, kind: "file" });
    } catch (err) {
      setCopy({ percent: null, error: localizeError(err, "editor.copyFailed").message });
    } finally {
      unlisten();
    }
  }

  const poster = source?.kind === "remote" ? source.metadata.thumbnailUrl : null;
  const frame = "relative min-h-0 flex-1 bg-black";

  if (!stream || failed) {
    return (
      <div className={`${frame} flex flex-col items-center justify-center gap-3 p-6 text-center`}>
        <VideoOff size={36} className="text-[var(--dk-text-muted)]" />
        {source?.kind === "local" ? (
          copy ? (
            copy.error ? (
              <p className="text-sm text-[var(--dk-error)]">{copy.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[var(--dk-text-muted)]">
                <Loader2 size={16} className="animate-spin" />
                {t("editor.copyProgress", {
                  percent: copy.percent === null ? "…" : Math.round(copy.percent),
                })}
              </p>
            )
          ) : (
            <>
              <p className="max-w-md text-sm text-[var(--dk-text-muted)]">
                {t("editor.localUnplayable")}
              </p>
              <Button icon={<RefreshCw size={16} />} onClick={() => void makeCopy()}>
                {t("editor.makeCopy")}
              </Button>
            </>
          )
        ) : (
          <>
            <p className="max-w-md text-sm text-[var(--dk-text-muted)]">
              {stream ? t("editor.remoteFailed") : t("editor.noPreview")}
            </p>
            {source?.kind === "remote" ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  icon={<RefreshCw size={16} />}
                  onClick={() => void reloadSource()}
                >
                  {t("editor.retryPreview")}
                </Button>
                <Button
                  variant="ghost"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openOriginalUrl(source.url)}
                >
                  {t("media.openSource")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={frame} onClick={togglePlayback}>
      {/* Klibin filtresi, renk ayarı ve efektleri önizlemede CSS ile gösterilir. */}
      <div
        className="absolute inset-0"
        style={{ filter: look.filter || undefined, transform: look.transform || undefined }}
      >
        <MediaPlayer
          stream={stream}
          poster={poster}
          className="h-full w-full"
          onApi={(api) => {
            setApi(api);
            if (api) playerReady();
          }}
          onTime={onSourceTime}
          onPlayingChange={(playing) => patch({ playing })}
          onWaitingChange={(waiting) => patch({ waiting })}
          onError={() => setFailed(true)}
        />
      </div>
      {/* Klibin açılma/kararma geçişi önizlemede siyah örtüyle gösterilir. */}
      {!inGap && look.vignette ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/65%)_100%)]" />
      ) : null}
      {!inGap && clipOpacity < 1 ? (
        <div
          className={`pointer-events-none absolute inset-0 ${clipFadeWhite ? "bg-white" : "bg-black"}`}
          style={{ opacity: 1 - clipOpacity }}
        />
      ) : null}
      {/* Boşluk dışa aktarımda siyah ekran: önizlemede de öyle. Açıklama yalnızca
          dururken görünür, oynarken ekran düz siyahtır. */}
      {inGap ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black text-center">
          {gapPlaying ? null : (
            <p className="max-w-xs text-sm text-[var(--dk-text-muted)]">{t("editor.gapPreview")}</p>
          )}
        </div>
      ) : null}
      {/* Yazılar boşluğun üstünde de görünür (dışa aktarımda siyah zemine yazılır). */}
      {stream?.hasVideo ? <TextLayer sourceAspect={sourceAspect} /> : null}
      {showCrop && stream?.hasVideo ? <CropOverlay sourceAspect={sourceAspect} /> : null}
    </div>
  );
}

const PREVIEW_RATES = [0.5, 1, 1.5, 2];

function PlayerBar() {
  const { t } = useTranslation();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const waiting = usePlayerStore((s) => s.waiting);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const rate = usePlayerStore((s) => s.rate);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const api = usePlayerStore((s) => s.api);
  const patch = usePlayerStore((s) => s.patch);
  const barRef = useRef<HTMLDivElement>(null);

  function fullscreen() {
    const player = barRef.current?.parentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player?.requestFullscreen?.();
  }

  return (
    <div
      ref={barRef}
      className="flex items-center gap-3 border-t border-[var(--dk-border)] bg-[var(--dk-surface)] px-3 py-1.5"
    >
      <p className="font-mono text-xs tabular-nums">{formatTimecode(currentTime)}</p>
      {waiting && playing ? (
        <span className="text-xs text-[var(--dk-text-muted)]">{t("editor.buffering")}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-xs text-[var(--dk-text-muted)] min-[1300px]:inline">
          {t("editor.previewSpeed")}
        </span>
        <Select
          value={rate}
          ariaLabel={t("editor.previewSpeed")}
          className="w-20 [&>button]:h-8"
          options={PREVIEW_RATES.map((r) => ({ value: r, label: `${r}×` }))}
          onChange={setPreviewRate}
        />
        <button
          type="button"
          title={muted ? t("editor.unmute") : t("editor.mute")}
          aria-label={muted ? t("editor.unmute") : t("editor.mute")}
          onClick={() => {
            api?.setMuted(!muted);
            patch({ muted: !muted });
          }}
          className="inline-flex h-8 w-8 items-center justify-center text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
        >
          {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t("editor.volume")}
          onChange={(e) => {
            const value = Number(e.target.value);
            patch({ volume: value, muted: false });
            applyVolume();
            api?.setMuted(false);
          }}
          className="dk-volume w-24"
        />
        <button
          type="button"
          title={t("editor.fullscreen")}
          aria-label={t("editor.fullscreen")}
          onClick={fullscreen}
          className="inline-flex h-8 w-8 items-center justify-center text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
        >
          <Maximize2 size={15} />
        </button>
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
