import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  FileText,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  Heart,
  RefreshCw,
  ScrollText,
  Sparkles,
  HardDrive,
  Info,
  LifeBuoy,
  ShieldCheck,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { CLOSE_BEHAVIORS, UI_SCALES, useSettingsStore } from "../lib/appSettings";
import {
  getAppSignature,
  getAppVersion,
  getToolVersions,
  openAppDataDir,
  openExternalLink,
  type ToolVersions,
} from "../lib/tauri-api";
import { siDiscord } from "simple-icons";
import { BrandMark } from "../components/BrandMark";
import { AUTHOR_NAME, AUTHOR_URL, DISCORD_URL, DONATE_URL, newIssueUrl } from "../lib/links";
import { useUpdateStore } from "../lib/updateCheck";
import { useTutorialStore } from "../lib/tutorial";
import { LANGUAGES } from "../i18n";
import { openLogFolder } from "../lib/log";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { ThemeSection } from "../components/ThemePicker";
import {
  AutostartRow,
  DiscordWebhookRow,
  HotkeysSection,
  StorageRow,
} from "../components/SettingsExtras";
import { playChime } from "../lib/chime";
import { FolderSettings } from "../components/FolderSettings";
import { PatchNotesPanel } from "../components/PatchNotesPanel";
import { ConfirmButton, Row, Section, ToggleRow } from "../components/SettingsParts";
import { DownloadSettings, YtdlpRows } from "../components/DownloadSettings";

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [toursReset, setToursReset] = useState(false);
  const settings = useSettingsStore();

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolVersions | null>(null);
  const [confirm, setConfirm] = useState<"reset" | null>(null);

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

      <HotkeysSection />

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
            <Row label={t("settings.uiScale")} hint={t("settings.uiScaleHint")}>
              <Select
                className="w-44"
                value={settings.uiScale}
                onChange={(uiScale) => settings.update({ uiScale })}
                options={UI_SCALES.map((scale, i) => ({
                  value: scale,
                  label: t(
                    ["settings.uiScaleNormal", "settings.uiScaleLarge", "settings.uiScaleXLarge"][
                      i
                    ],
                  ),
                }))}
                ariaLabel={t("settings.uiScale")}
              />
            </Row>
            <AutostartRow />
            <ToggleRow
              label={t("settings.advancedMode")}
              hint={t("settings.advancedModeHint")}
              checked={settings.advanced}
              onChange={(advanced) => settings.update({ advanced })}
            />
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
          <DownloadSettings />
        </div>

        <div className="space-y-5">
          <Section
            tour="settings-behavior"
            icon={<Bell size={18} />}
            title={t("settings.behavior")}
          >
            <ToggleRow
              label={t("settings.soundOnSave")}
              hint={t("settings.soundOnSaveHint")}
              checked={settings.soundOnSave}
              onChange={(soundOnSave) => {
                settings.update({ soundOnSave });
                if (soundOnSave) playChime();
              }}
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
            <DiscordWebhookRow />
          </Section>

          <Section tour="settings-tools" icon={<Wrench size={18} />} title={t("settings.tools")}>
            <YtdlpRows
              tools={tools}
              onUpdated={(ytdlp) =>
                setTools((prev) => ({ ffmpeg: null, deno: null, ...prev, ytdlp }))
              }
            />
            <Row label="FFmpeg" hint={tools?.ffmpeg ?? t("settings.toolNotInstalled")} />
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
            <StorageRow />
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
                © 2026 {AUTHOR_NAME} · {t("settings.originalAuthor")}
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
                icon={<LifeBuoy size={14} />}
                onClick={() => void openExternalLink(newIssueUrl("", ""))}
              >
                {t("settings.reportIssue")}
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
                  ["yt-dlp", "Unlicense", t("settings.creditYtdlp")],
                  ["FFmpeg", "LGPL / GPL", t("settings.creditFfmpeg")],
                  ["Deno", "MIT", t("settings.creditDeno")],
                  ["whisper.cpp", "MIT", t("settings.creditWhisper")],
                  ["RNNoise (nnnoiseless)", "BSD-3", t("settings.creditRnnoise")],
                  ["EffectCraft", "MIT / Apache-2.0", t("settings.creditEffectcraft")],
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
