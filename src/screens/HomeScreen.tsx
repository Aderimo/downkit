import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  Check,
  Info,
  Link2,
  ListVideo,
  Maximize2,
  RefreshCw,
  Shrink,
} from "lucide-react";
import { useWorkspaceStore, type WorkspaceAction } from "../store/workspaceStore";
import { useSettingsStore } from "../lib/appSettings";
import { checkSupportedUrl } from "../lib/validation";
import { changeDestination, ensureDestination } from "../lib/destination";
import { enqueueDownload, enqueueMany } from "../lib/jobEngine";
import { estimateDownloadSize, findDuplicateDownload } from "../lib/jobPlanning";
import { clampRange } from "../lib/timeRange";
import { SectionPicker } from "../components/SectionPicker";
import { useJobsStore } from "../store/jobsStore";
import { analyzeLink, hasPlaylistParam, openPlaylist } from "../lib/workspaceActions";
import { PlaylistCard } from "../components/PlaylistCard";
import { Button } from "../components/ui/Button";
import { openOriginalUrl, readClipboardText } from "../lib/tauri-api";
import { useFileDrop } from "../lib/useFileDrop";
import type { Route } from "../types/route";
import { UrlBar } from "../components/UrlBar";
import { PlatformPills } from "../components/PlatformPills";
import { MediaCard } from "../components/MediaCard";
import { PreviewModal } from "../components/PreviewModal";
import { ActionCards } from "../components/ActionCards";
import { OptionsPanel } from "../components/OptionsPanel";
import { PresetsPanel } from "../components/PresetsPanel";
import { JobQueue } from "../components/JobQueue";
import { RecentSearches } from "../components/RecentSearches";
import { ClipboardBanner } from "../components/ClipboardBanner";
import { ErrorBanner } from "../components/ErrorBanner";

const START_ICON = {
  download: <ArrowDownToLine size={18} />,
  convert: <RefreshCw size={18} />,
  compress: <Shrink size={18} />,
  resize: <Maximize2 size={18} />,
};

interface StartFeedback {
  label: string;
  ok: boolean;
}

const LOCAL_TOOL: Record<Exclude<WorkspaceAction, "download">, Route> = {
  convert: "convert",
  compress: "compress",
  resize: "resize",
};

interface HomeScreenProps {
  onNavigate: (route: Route) => void;
  onOpenLocalFile: (path: string) => void;
}

export function HomeScreen({ onNavigate, onOpenLocalFile }: HomeScreenProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [feedback, setFeedback] = useState<StartFeedback | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const ws = useWorkspaceStore();
  const destinationDir = useSettingsStore((s) => s.defaultDownloadDir);

  const check = checkSupportedUrl(ws.url);
  const detected = check.status === "ok" ? check.platform : null;

  // Bilgisayardan bir medya dosyası sürüklenirse Dönüştür aracında açılır.
  useFileDrop(onOpenLocalFile);

  const analyze = (url: string) => void analyzeLink(url);
  const applyUrl = analyze;

  async function paste() {
    const text = (await readClipboardText())?.trim();
    if (!text) return;
    ws.setUrl(text);
    if (checkSupportedUrl(text).status === "ok") analyze(text);
  }

  const needsTarget = ws.action === "resize" && ws.options.platformTargets.length === 0;
  const hasMedia = ws.metadata !== null || ws.playlist !== null;
  const canStart =
    ws.analyzedUrl !== null &&
    !needsTarget &&
    (ws.metadata !== null || (ws.playlist !== null && ws.playlistSelection.length > 0));

  // Başlat düğmesi birkaç saniye "Kuyruğa eklendi" der; basıldığı belli olsun.
  function flash(label: string, ok: boolean) {
    setFeedback({ label, ok });
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2500);
  }

  // `setAction` seçenekleri değiştirebildiği için (ör. Dönüştür → MP3) her zaman
  // güncel durumu depodan okur, render anındaki kopyayı değil.
  async function start() {
    const state = useWorkspaceStore.getState();
    const missingTarget = state.action === "resize" && state.options.platformTargets.length === 0;
    if (!state.analyzedUrl || missingTarget) return;

    if (state.playlist) {
      const chosen = state.playlist.entries.filter((e) => state.playlistSelection.includes(e.url));
      if (chosen.length === 0) return;
      const dir = await ensureDestination();
      if (!dir) return;
      const previews = new Map(chosen.map((e) => [e.url, e]));
      const { added, skipped } = enqueueMany(
        chosen.map((e) => e.url),
        dir,
        { ...state.options, formatId: null, section: null },
        previews,
      );
      flash(
        skipped > 0
          ? t("batch.addedWithSkipped", { count: added, skipped })
          : t("playlist.queued", { count: added }),
        added > 0,
      );
      return;
    }

    if (!state.metadata) return;
    if (findDuplicateDownload(useJobsStore.getState().jobs, state.analyzedUrl, state.options)) {
      flash(t("options.alreadyQueued"), false);
      return;
    }
    const dir = await ensureDestination();
    if (!dir) return;
    enqueueDownload({
      url: state.analyzedUrl,
      destinationDir: dir,
      options: state.options,
      metadata: state.metadata,
    });
    flash(t("options.queued"), true);
  }

  // Önizlemede "Başlangıç/Bitiş = şu an": bölüm kapalıysa açılır.
  function markSection(edge: "start" | "end", seconds: number, duration: number) {
    const current = useWorkspaceStore.getState().options.section;
    const base = current ?? {
      start: edge === "start" ? seconds : Math.max(0, seconds - 60),
      end: edge === "end" ? seconds : Math.min(duration, seconds + 60),
    };
    ws.setOptions({ section: clampRange({ ...base, [edge]: seconds }, duration, edge) });
  }

  // Klavye kısayolları: Ctrl+V linki yapıştırıp analiz eder, Enter başlatır.
  // Yazı alanındayken (ya da bir düğme odaktayken Enter) karışmaz.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    shortcutRef.current = (e) => {
      if (previewOpen || e.defaultPrevented) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && !typing) {
        e.preventDefault();
        void paste();
      } else if (
        e.key === "Enter" &&
        !e.repeat &&
        !typing &&
        !(el && /^(BUTTON|A)$/.test(el.tagName)) &&
        canStart
      ) {
        e.preventDefault();
        void start();
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function select(action: WorkspaceAction) {
    ws.setAction(action);
    if (!hasMedia) {
      if (action === "download") inputRef.current?.focus();
      else onNavigate(LOCAL_TOOL[action]);
    }
  }

  // İndir ve Sıkıştır mevcut seçeneklerle hemen başlar. Dönüştür ve Boyut Ayarla
  // önce bir hedef (format / platform) seçtirir; seçenekler paneline götürülür.
  function run(action: WorkspaceAction) {
    if (!hasMedia) {
      select(action);
      return;
    }
    ws.setAction(action);
    if (action === "convert" || action === "resize") {
      optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    void start();
  }

  const actionLabel = t(`actions.${ws.action}Button`);
  const startLabel = ws.playlist
    ? `${actionLabel} (${t("playlist.videoCount", { count: ws.playlistSelection.length })})`
    : actionLabel;
  const presets = (
    <PresetsPanel
      tab={ws.presetsTab}
      onTabChange={ws.setPresetsTab}
      options={ws.options}
      onChange={ws.setOptions}
      onReplace={ws.replaceOptions}
    />
  );

  return (
    <div className="flex min-h-full gap-6 p-6">
      <div className="min-w-0 flex-1 space-y-5">
        <UrlBar
          ref={inputRef}
          value={ws.url}
          onChange={(url) => {
            ws.setUrl(url);
            if (ws.phase === "error") ws.clearError();
          }}
          onAnalyze={() => analyze(ws.url)}
          onPaste={() => void paste()}
          canAnalyze={check.status === "ok"}
          isAnalyzing={ws.phase === "analyzing"}
        />

        <ClipboardBanner currentUrl={ws.url} onUse={applyUrl} />

        <PlatformPills
          detected={detected ?? ws.metadata?.platform ?? ws.playlist?.platform ?? null}
        />

        {ws.phase === "error" && ws.errorMessage ? (
          <ErrorBanner
            message={ws.errorMessage}
            hint={t("error.analyzeHint")}
            detail={ws.errorDetail}
            onRetry={check.status === "ok" ? () => analyze(ws.url) : undefined}
            onDismiss={ws.clearError}
          />
        ) : null}

        {ws.playlist ? (
          <PlaylistCard
            playlist={ws.playlist}
            selection={ws.playlistSelection}
            onToggle={ws.togglePlaylistEntry}
            onSelectAll={ws.setPlaylistSelection}
            onClear={ws.resetMedia}
          />
        ) : ws.metadata ? (
          <>
            <MediaCard
              metadata={ws.metadata}
              onPreview={() => setPreviewOpen(true)}
              onOpenOriginal={() => ws.analyzedUrl && void openOriginalUrl(ws.analyzedUrl)}
              onClear={ws.resetMedia}
            />
            {ws.analyzedUrl && hasPlaylistParam(ws.analyzedUrl) ? (
              <div className="dk-card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <ListVideo size={18} className="shrink-0 text-[var(--dk-accent-hover)]" />
                <span className="min-w-0 flex-1 text-[var(--dk-text)]">
                  {t("playlist.partOfList")}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => ws.analyzedUrl && void openPlaylist(ws.analyzedUrl)}
                >
                  {t("playlist.openList")}
                </Button>
              </div>
            ) : null}
            {ws.metadata.durationSeconds && ws.metadata.durationSeconds > 2 ? (
              <SectionPicker
                duration={ws.metadata.durationSeconds}
                section={ws.options.section}
                onChange={(section) => ws.setOptions({ section })}
                estimatedBytes={
                  ws.options.section ? estimateDownloadSize(ws.metadata, ws.options) : null
                }
                onOpenPreview={ws.metadata.previewUrl ? () => setPreviewOpen(true) : undefined}
              />
            ) : null}
          </>
        ) : (
          <section className="dk-card flex items-center gap-5 p-6">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
              <Link2 size={26} />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold">{t("home.emptyTitle")}</p>
              <p className="mt-1 text-sm text-[var(--dk-text-muted)]">{t("home.emptySubtitle")}</p>
            </div>
          </section>
        )}

        <RecentSearches onSelect={applyUrl} onViewAll={() => onNavigate("history")} />

        <ActionCards selected={ws.action} onSelect={select} onRun={run} />
        {!hasMedia ? (
          <p className="-mt-2 text-xs text-[var(--dk-text-muted)]">{t("home.cardsHint")}</p>
        ) : null}

        <div ref={optionsRef} className="scroll-mt-6">
          <OptionsPanel
            metadata={ws.metadata}
            playlistCount={ws.playlist ? ws.playlistSelection.length : null}
            options={ws.options}
            onChange={ws.setOptions}
            tab={ws.optionsTab}
            onTabChange={ws.setOptionsTab}
            destinationDir={destinationDir}
            onChangeDestination={() => void changeDestination()}
            startLabel={
              feedback ? feedback.label : needsTarget ? t("options.pickTarget") : startLabel
            }
            startIcon={
              feedback ? (
                feedback.ok ? (
                  <Check size={18} />
                ) : (
                  <Info size={18} />
                )
              ) : (
                START_ICON[ws.action]
              )
            }
            canStart={canStart}
            onStart={() => void start()}
            onEnqueueBatch={async (urls) => {
              const dir = await ensureDestination();
              if (!dir) return null;
              const options = {
                ...useWorkspaceStore.getState().options,
                formatId: null,
                section: null,
              };
              return enqueueMany(urls, dir, options);
            }}
          />
        </div>

        <div className="min-[1360px]:hidden">{presets}</div>

        <JobQueue limit={4} onViewAll={() => onNavigate("downloads")} />
      </div>

      <div className="hidden w-80 shrink-0 min-[1360px]:block">
        <div className="sticky top-6">{presets}</div>
      </div>

      {previewOpen && ws.metadata ? (
        <PreviewModal
          title={ws.metadata.title}
          previewUrl={ws.metadata.previewUrl}
          posterUrl={ws.metadata.thumbnailUrl}
          onOpenOriginal={() => ws.analyzedUrl && void openOriginalUrl(ws.analyzedUrl)}
          onClose={() => setPreviewOpen(false)}
          section={ws.options.section}
          onMark={
            ws.metadata.durationSeconds
              ? (edge, seconds) => markSection(edge, seconds, ws.metadata?.durationSeconds ?? 0)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
