import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Captions,
  FileText,
  Check,
  Copy,
  Globe,
  Download,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  Heart,
  RefreshCw,
  ScrollText,
  Sparkles,
  BarChart3,
  HardDrive,
  History,
  Info,
  ShieldCheck,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  CLOSE_BEHAVIORS,
  DEFAULT_HEIGHTS,
  FILENAME_TEMPLATES,
  RATE_LIMITS_KBPS,
  SUBTITLE_LANGUAGES,
  useSettingsStore,
} from "../lib/appSettings";
import { useHistoryStore } from "../lib/downloadHistory";
import { useSearchStore } from "../lib/recentSearches";
import {
  getAppSignature,
  getAppVersion,
  getToolVersions,
  openAppDataDir,
  openExternalLink,
  copyText,
  updateYtdlp,
  type ToolVersions,
} from "../lib/tauri-api";
import { AUDIO_FORMATS, VIDEO_FORMATS, isAudioFormat, type OutputFormat } from "../types/media";
import { useWorkspaceStore } from "../store/workspaceStore";
import { siDiscord, siGithub } from "simple-icons";
import { BrandMark } from "../components/BrandMark";
import { AUTHOR_NAME, AUTHOR_URL, DISCORD_URL, DONATE_URL, GITHUB_URL } from "../lib/links";
import { useUpdateStore } from "../lib/updateCheck";
import { useTutorialStore } from "../lib/tutorial";
import { LANGUAGES } from "../i18n";
import { openLogFolder } from "../lib/log";
import { bookmarklet } from "../lib/deepLink";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Switch } from "../components/ui/Switch";
import { ThemeSection } from "../components/ThemePicker";
import { FolderSettings } from "../components/FolderSettings";
import { CounterPanel } from "../components/CounterPanel";
import { PatchNotesPanel } from "../components/PatchNotesPanel";

const TEMPLATE_LABEL_KEYS: Record<(typeof FILENAME_TEMPLATES)[number], string> = {
  "{title}": "settings.templateTitle",
  "{title} [{id}]": "settings.templateTitleId",
  "{uploader} - {title}": "settings.templateUploaderTitle",
  "{date} - {title}": "settings.templateDateTitle",
};

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [toursReset, setToursReset] = useState(false);
  const [copiedBookmark, setCopiedBookmark] = useState<string | null>(null);
  const settings = useSettingsStore();
  const historyCount = useHistoryStore((s) => s.entries.length);
  const clearHistory = useHistoryStore((s) => s.clear);
  const searchCount = useSearchStore((s) => s.entries.length);
  const clearSearches = useSearchStore((s) => s.clear);

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolVersions | null>(null);
  const [ytdlpStatus, setYtdlpStatus] = useState<"idle" | "updating" | "updated" | "error">("idle");
  const [confirm, setConfirm] = useState<"history" | "searches" | "reset" | null>(null);

  useEffect(() => {
    getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
    getAppSignature()
      .then(setSignature)
      .catch(() => setSignature(null));
    getToolVersions()
      .then(setTools)
      .catch(() => setTools(null));
  }, []);

  async function handleUpdateYtdlp() {
    setYtdlpStatus("updating");
    try {
      const version = await updateYtdlp();
      setTools((prev) => ({ ffmpeg: null, deno: null, ...prev, ytdlp: version }));
      settings.update({ lastYtdlpUpdateCheck: Date.now() });
      setYtdlpStatus("updated");
    } catch {
      setYtdlpStatus("error");
    }
  }

  // Varsayılan format/kalite değişince Ana Sayfa'daki seçim de hemen güncellenir.
  function setDefaultFormat(defaultOutputFormat: OutputFormat) {
    settings.update({ defaultOutputFormat });
    useWorkspaceStore.getState().setOptions({ outputFormat: defaultOutputFormat, formatId: null });
  }

  function setDefaultHeight(value: string) {
    const defaultMaxHeight = value === "best" ? null : Number(value);
    settings.update({ defaultMaxHeight });
    useWorkspaceStore.getState().setOptions({ maxHeight: defaultMaxHeight, formatId: null });
  }

  function toggleSubtitleLang(code: string) {
    const has = settings.subtitleLangs.includes(code);
    // En az bir dil seçili kalmalı.
    if (has && settings.subtitleLangs.length === 1) return;
    settings.update({
      subtitleLangs: has
        ? settings.subtitleLangs.filter((c) => c !== code)
        : [...settings.subtitleLangs, code],
    });
  }

  const templateExample = (template: string) =>
    `${template
      .replace("{title}", t("settings.exampleTitle"))
      .replace("{id}", "dQw4w9WgXcQ")
      .replace("{uploader}", t("settings.exampleUploader"))
      .replace("{date}", "20260924")}.mp4`;

  const dateFormat = (ms: number) =>
    new Date(ms).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  const update = useUpdateStore();
  const updateHint =
    update.status === "checking"
      ? t("update.checking")
      : update.status === "available" && update.latest
        ? t("update.available", { version: update.latest.version })
        : update.status === "error"
          ? t("update.failed")
          : update.status === "upToDate"
            ? t("update.upToDate", { version: appVersion ?? "" })
            : (appVersion ?? "");

  const ytdlpHint =
    ytdlpStatus === "updating"
      ? t("settings.updating")
      : ytdlpStatus === "error"
        ? t("settings.updateFailed")
        : (tools?.ytdlp ?? t("settings.toolNotInstalled"));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="dk-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <Settings size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("settings.subtitle")}</p>
        </div>
        <ConfirmButton
          active={confirm === "reset"}
          onAsk={() => setConfirm("reset")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            settings.reset();
            setConfirm(null);
          }}
          icon={<RotateCcw size={14} />}
          label={t("settings.reset")}
          confirmLabel={t("settings.resetConfirm")}
        />
      </header>

      <ThemeSection />

      <Section
        tour="settings-folders"
        icon={<FolderOpen size={18} />}
        title={t("settings.folders")}
      >
        <p className="-mt-2 text-xs text-[var(--dk-text-muted)]">{t("settings.foldersHint")}</p>
        <FolderSettings />
      </Section>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Section
            tour="settings-general"
            icon={<SlidersHorizontal size={18} />}
            title={t("settings.general")}
          >
            <Row label={t("settings.language")}>
              <Select
                className="w-44"
                value={LANGUAGES.some((l) => l.code === i18n.language) ? i18n.language : "en"}
                onChange={(lng) => void i18n.changeLanguage(lng)}
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
                ariaLabel={t("settings.language")}
              />
            </Row>
            <Row
              label={t("settings.filenameTemplate")}
              hint={templateExample(settings.filenameTemplate)}
            >
              <Select
                className="w-56"
                value={settings.filenameTemplate}
                onChange={(filenameTemplate) => settings.update({ filenameTemplate })}
                options={FILENAME_TEMPLATES.map((tpl) => ({
                  value: tpl,
                  label: t(TEMPLATE_LABEL_KEYS[tpl]),
                }))}
                ariaLabel={t("settings.filenameTemplate")}
              />
            </Row>
            <div className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white">{t("settings.tutorial")}</p>
                  <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
                    {t("settings.tutorialHint")}
                  </p>
                </div>
                <Button
                  size="sm"
                  icon={<GraduationCap size={15} />}
                  onClick={() => useTutorialStore.getState().start()}
                >
                  {t("settings.tutorialStart")}
                </Button>
              </div>
              <div className="mt-3 border-t border-[var(--dk-border)] pt-3">
                <ToggleRow
                  label={t("settings.tutorialOnLaunch")}
                  checked={settings.showTutorial}
                  onChange={(showTutorial) => settings.update({ showTutorial })}
                />
                <div className="mt-3">
                  <ToggleRow
                    label={t("settings.pageTours")}
                    checked={settings.pageTours}
                    onChange={(pageTours) => settings.update({ pageTours })}
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RotateCcw size={14} />}
                    onClick={() => {
                      useTutorialStore.getState().resetSeen();
                      setToursReset(true);
                    }}
                  >
                    {t("settings.resetTours")}
                  </Button>
                  {toursReset ? (
                    <span className="text-xs text-[var(--dk-success)]">
                      {t("settings.resetToursDone")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </Section>

          <Section
            tour="settings-downloads"
            icon={<Download size={18} />}
            title={t("settings.downloads")}
          >
            <Row label={t("settings.defaultFormat")} hint={t("settings.defaultFormatHint")}>
              <Select
                className="w-44"
                value={settings.defaultOutputFormat}
                onChange={setDefaultFormat}
                options={[...VIDEO_FORMATS, ...AUDIO_FORMATS].map((f) => ({
                  value: f,
                  label: f.toUpperCase(),
                  hint: isAudioFormat(f) ? t("options.audio") : t("options.video"),
                }))}
                ariaLabel={t("settings.defaultFormat")}
              />
            </Row>
            <Row label={t("settings.defaultQuality")}>
              <Select
                className="w-44"
                value={String(settings.defaultMaxHeight ?? "best")}
                onChange={setDefaultHeight}
                options={DEFAULT_HEIGHTS.map((h) => ({
                  value: String(h ?? "best"),
                  label: h ? `${h}p` : t("options.qualityBest"),
                }))}
                ariaLabel={t("settings.defaultQuality")}
              />
            </Row>
            <Row label={t("settings.concurrency")} hint={t("settings.concurrencyHint")}>
              <div className="flex rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => settings.update({ concurrency: n })}
                    aria-pressed={settings.concurrency === n}
                    className={`h-8 w-10 rounded-lg text-sm font-medium transition-colors ${
                      settings.concurrency === n
                        ? "dk-gradient text-white"
                        : "text-[var(--dk-text-muted)] hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t("settings.rateLimit")} hint={t("settings.rateLimitHint")}>
              <Select
                className="w-44"
                value={String(settings.rateLimitKbps ?? "none")}
                onChange={(v) =>
                  settings.update({ rateLimitKbps: v === "none" ? null : Number(v) })
                }
                options={RATE_LIMITS_KBPS.map((kbps) => ({
                  value: String(kbps ?? "none"),
                  label: kbps
                    ? t("settings.rateValue", { mb: kbps / 1024 })
                    : t("settings.rateUnlimited"),
                }))}
                ariaLabel={t("settings.rateLimit")}
              />
            </Row>
            <ToggleRow
              label={t("settings.sponsorBlock")}
              hint={t("settings.sponsorBlockHint")}
              checked={settings.sponsorBlock}
              onChange={(sponsorBlock) => settings.update({ sponsorBlock })}
            />
          </Section>

          <Section
            tour="settings-subtitles"
            icon={<Captions size={18} />}
            title={t("settings.subtitles")}
          >
            <div>
              <p className="text-sm text-white">{t("settings.subtitleLangs")}</p>
              <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
                {t("settings.subtitleLangsHint")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUBTITLE_LANGUAGES.map((lang) => {
                  const active = settings.subtitleLangs.includes(lang.code);
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSubtitleLang(lang.code)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-white"
                          : "border-[var(--dk-border)] text-[var(--dk-text-muted)] hover:border-[var(--dk-border-strong)] hover:text-white"
                      }`}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ToggleRow
              label={t("settings.autoSubtitles")}
              hint={t("settings.autoSubtitlesHint")}
              checked={settings.autoSubtitles}
              onChange={(autoSubtitles) => settings.update({ autoSubtitles })}
            />
          </Section>

          <Section
            tour="settings-counter"
            icon={<BarChart3 size={18} />}
            title={t("settings.counter")}
          >
            <p className="-mt-2 text-xs text-[var(--dk-text-muted)]">{t("settings.counterHint")}</p>
            <CounterPanel />
          </Section>
        </div>

        <div className="space-y-5">
          <Section
            tour="settings-behavior"
            icon={<Bell size={18} />}
            title={t("settings.behavior")}
          >
            <ToggleRow
              label={t("settings.clipboardSuggest")}
              hint={t("settings.clipboardSuggestHint")}
              checked={settings.clipboardSuggest}
              onChange={(clipboardSuggest) => settings.update({ clipboardSuggest })}
            />
            <ToggleRow
              label={t("settings.notifyOnComplete")}
              hint={t("settings.notifyOnCompleteHint")}
              checked={settings.notifyOnComplete}
              onChange={(notifyOnComplete) => settings.update({ notifyOnComplete })}
            />
            <ToggleRow
              label={t("settings.revealOnComplete")}
              hint={t("settings.revealOnCompleteHint")}
              checked={settings.revealOnComplete}
              onChange={(revealOnComplete) => settings.update({ revealOnComplete })}
            />
            <Row label={t("settings.closeBehavior")} hint={t("settings.closeBehaviorHint")}>
              <Select
                className="w-56"
                value={settings.closeBehavior}
                onChange={(closeBehavior) => settings.update({ closeBehavior })}
                options={CLOSE_BEHAVIORS.map((behavior) => ({
                  value: behavior,
                  label: t(`settings.close.${behavior}`),
                }))}
                ariaLabel={t("settings.closeBehavior")}
              />
            </Row>
          </Section>

          <Section tour="settings-browser" icon={<Globe size={18} />} title={t("settings.browser")}>
            <p className="text-sm text-[var(--dk-text-muted)]">{t("settings.browserHint")}</p>
            {(["open", "edit"] as const).map((action) => (
              <div
                key={action}
                className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white">{t(`settings.bookmark.${action}`)}</p>
                  <p className="truncate font-mono text-[11px] text-[var(--dk-text-muted)]">
                    {bookmarklet(action)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={copiedBookmark === action ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() =>
                    void copyText(bookmarklet(action)).then((ok) => ok && setCopiedBookmark(action))
                  }
                >
                  {copiedBookmark === action ? t("settings.copied") : t("settings.copy")}
                </Button>
              </div>
            ))}
            <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--dk-text-muted)]">
              <li>{t("settings.bookmarkStep1")}</li>
              <li>{t("settings.bookmarkStep2")}</li>
              <li>{t("settings.bookmarkStep3")}</li>
            </ol>
          </Section>

          <Section tour="settings-tools" icon={<Wrench size={18} />} title={t("settings.tools")}>
            <Row label="yt-dlp" hint={ytdlpHint}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={() => void handleUpdateYtdlp()}
                disabled={ytdlpStatus === "updating"}
              >
                {ytdlpStatus === "updating" ? t("settings.updating") : t("settings.updateYtdlp")}
              </Button>
            </Row>
            <Row label="FFmpeg" hint={tools?.ffmpeg ?? t("settings.toolNotInstalled")} />
            <Row label="Deno" hint={tools?.deno ?? t("settings.denoNotInstalled")} />
            <ToggleRow
              label={t("settings.autoUpdateYtdlp")}
              hint={
                settings.lastYtdlpUpdateCheck
                  ? t("settings.lastChecked", { date: dateFormat(settings.lastYtdlpUpdateCheck) })
                  : t("settings.ytdlpHint")
              }
              checked={settings.autoUpdateYtdlp}
              onChange={(autoUpdateYtdlp) => settings.update({ autoUpdateYtdlp })}
            />
            <Row label={t("settings.appUpdate")} hint={updateHint}>
              {update.status === "available" && update.latest ? (
                <Button size="sm" icon={<Sparkles size={14} />} onClick={() => update.openDialog()}>
                  {t("update.download", { version: update.latest.version })}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  disabled={update.status === "checking"}
                  onClick={() => void update.check()}
                >
                  {t("update.checkNow")}
                </Button>
              )}
            </Row>
            <ToggleRow
              label={t("settings.checkUpdates")}
              hint={t("settings.checkUpdatesHint")}
              checked={settings.checkUpdates}
              onChange={(checkUpdates) => settings.update({ checkUpdates })}
            />
            <Row label={t("settings.toolsFolder")} hint={t("settings.toolsFolderHint")}>
              <Button
                variant="ghost"
                size="sm"
                icon={<HardDrive size={14} />}
                onClick={() => void openAppDataDir()}
              >
                {t("settings.openFolder")}
              </Button>
            </Row>
            <Row label={t("settings.logFolder")} hint={t("settings.logFolderHint")}>
              <Button
                variant="ghost"
                size="sm"
                icon={<FileText size={14} />}
                onClick={() => void openLogFolder()}
              >
                {t("settings.openLog")}
              </Button>
            </Row>
          </Section>

          <Section
            tour="settings-privacy"
            icon={<History size={18} />}
            title={t("settings.privacy")}
          >
            <ToggleRow
              label={t("settings.keepHistory")}
              hint={t("settings.keepHistoryHint")}
              checked={settings.keepHistory}
              onChange={(keepHistory) => settings.update({ keepHistory })}
            />
            <Row
              label={t("settings.downloadHistory")}
              hint={t("settings.entryCount", { count: historyCount })}
            >
              <ConfirmButton
                active={confirm === "history"}
                disabled={historyCount === 0}
                onAsk={() => setConfirm("history")}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                  clearHistory();
                  setConfirm(null);
                }}
                icon={<Trash2 size={14} />}
                label={t("history.clear")}
                confirmLabel={t("history.confirmClear")}
              />
            </Row>
            <Row
              label={t("settings.searchHistory")}
              hint={t("settings.entryCount", { count: searchCount })}
            >
              <ConfirmButton
                active={confirm === "searches"}
                disabled={searchCount === 0}
                onAsk={() => setConfirm("searches")}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                  clearSearches();
                  setConfirm(null);
                }}
                icon={<Trash2 size={14} />}
                label={t("history.clear")}
                confirmLabel={t("history.confirmClear")}
              />
            </Row>
          </Section>
        </div>
      </div>

      <Section
        tour="settings-notes"
        icon={<ScrollText size={18} />}
        title={t("settings.releaseNotes")}
      >
        <PatchNotesPanel />
      </Section>

      <Section tour="settings-about" icon={<Info size={18} />} title={t("settings.about")}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex items-start gap-4 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
            <span className="shrink-0">
              <BrandMark size={56} />
            </span>
            <div className="min-w-0">
              <p className="font-brand text-2xl leading-tight font-black text-white">
                {t("app.name")}
                {appVersion ? (
                  <span className="ml-2 align-middle font-sans text-xs font-medium text-[var(--dk-text-muted)]">
                    v{appVersion}
                  </span>
                ) : null}
              </p>
              <p className="font-brand text-sm font-extrabold text-[var(--dk-brand)]">
                by {AUTHOR_NAME}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--dk-text-muted)]">
                {t("settings.aboutText")}
              </p>
              <p
                className="mt-2 text-[11px] text-[var(--dk-text-muted)]"
                title={signature ?? undefined}
              >
                © 2026 {AUTHOR_NAME} · MIT · {t("settings.originalAuthor")}
              </p>
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
            <p className="text-sm font-semibold text-white">{t("settings.contactTitle")}</p>
            <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
              {t("settings.contactHint")}
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              <button
                type="button"
                onClick={() => void openExternalLink(DISCORD_URL)}
                className="inline-flex h-8 items-center gap-2 rounded-xl bg-[#5865F2] px-3 text-xs font-medium text-white transition hover:brightness-110"
              >
                <svg viewBox="0 0 24 24" width={14} height={14} fill="white" aria-hidden>
                  <path d={siDiscord.path} />
                </svg>
                {t("settings.discord")}
              </button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ExternalLink size={14} />}
                onClick={() => void openExternalLink(AUTHOR_URL)}
              >
                {t("settings.authorPage", { name: AUTHOR_NAME })}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden>
                    <path d={siGithub.path} />
                  </svg>
                }
                onClick={() => void openExternalLink(GITHUB_URL)}
              >
                GitHub
              </Button>
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-[#f472b6]/30 bg-[#f472b6]/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Heart size={14} className="text-[var(--dk-pink)]" />
              {t("settings.donateTitle")}
            </p>
            <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{t("settings.donateHint")}</p>
            <div className="mt-auto pt-3">
              <button
                type="button"
                onClick={() => void openExternalLink(DONATE_URL)}
                className="inline-flex h-8 items-center gap-2 rounded-xl border border-[#f472b6]/40 px-3 text-xs font-medium text-[var(--dk-pink)] transition hover:bg-[#f472b6]/10"
              >
                <Heart size={14} />
                {t("settings.donateButton")}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
            <p className="text-sm font-semibold text-white">{t("settings.openSourceTitle")}</p>
            <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{t("settings.license")}</p>
            <table className="mt-3 w-full text-xs">
              <tbody>
                {[
                  ["DownKit", "MIT", t("settings.creditDownKit")],
                  ["yt-dlp", "Unlicense", t("settings.creditYtdlp")],
                  ["FFmpeg", "LGPL / GPL", t("settings.creditFfmpeg")],
                  ["Deno", "MIT", t("settings.creditDeno")],
                  ["RNNoise (nnnoiseless)", "BSD-3", t("settings.creditRnnoise")],
                ].map(([name, license, role]) => (
                  <tr key={name} className="border-t border-[var(--dk-border)] first:border-t-0">
                    <td className="py-1.5 pr-3 font-medium text-[var(--dk-text)]">{name}</td>
                    <td className="py-1.5 pr-3 font-mono text-[var(--dk-text-muted)]">{license}</td>
                    <td className="py-1.5 text-[var(--dk-text-muted)]">{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 rounded-xl border border-[var(--dk-warning)]/30 bg-[var(--dk-warning)]/10 p-4">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[var(--dk-warning)]" />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-white">{t("settings.responsibleTitle")}</p>
              <p className="text-xs leading-relaxed text-[var(--dk-text)]/85">
                {t("settings.disclaimer")}
              </p>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  tour,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Tanıtım turunda vurgulanacak bölümün adı. */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <section className="dk-card space-y-4 p-5" data-tour={tour}>
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{label}</p>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-[var(--dk-text-muted)]" title={hint}>
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{hint}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Geri alınamayan işlemler için iki adımlı düğme: önce sor, sonra yap. */
function ConfirmButton({
  active,
  disabled,
  onAsk,
  onCancel,
  onConfirm,
  icon,
  label,
  confirmLabel,
}: {
  active: boolean;
  disabled?: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  icon: ReactNode;
  label: string;
  confirmLabel: string;
}) {
  const { t } = useTranslation();
  if (!active) {
    return (
      <Button variant="secondary" size="sm" icon={icon} disabled={disabled} onClick={onAsk}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t("history.cancelClear")}
      </Button>
      <Button variant="danger" size="sm" icon={icon} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}
