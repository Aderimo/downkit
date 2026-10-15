import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Captions, Download, History, Trash2 } from "lucide-react";
import {
  DEFAULT_HEIGHTS,
  FILENAME_TEMPLATES,
  RATE_LIMITS_KBPS,
  SUBTITLE_LANGUAGES,
  useSettingsStore,
} from "../lib/appSettings";
import { useHistoryStore } from "../lib/downloadHistory";
import { useSearchStore } from "../lib/recentSearches";
import { updateYtdlp, type ToolVersions } from "../lib/tauri-api";
import { useWorkspaceStore } from "../store/workspaceStore";
import { AUDIO_FORMATS, VIDEO_FORMATS, isAudioFormat, type OutputFormat } from "../types/media";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { ConfirmButton, Row, Section, ToggleRow } from "./SettingsParts";

/** İndirme, altyazı ve geçmiş ayarları (İndir sayfasının varsayılanları). */
export function DownloadSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const historyCount = useHistoryStore((s) => s.entries.length);
  const clearHistory = useHistoryStore((s) => s.clear);
  const searchCount = useSearchStore((s) => s.entries.length);
  const clearSearches = useSearchStore((s) => s.clear);
  const [confirm, setConfirm] = useState<"history" | "searches" | null>(null);

  // Varsayılan format/kalite değişince İndir sayfasındaki seçim de hemen güncellenir.
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

  return (
    <>
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
        <Row
          label={t("settings.filenameTemplate")}
          hint={templateExample(settings.filenameTemplate)}
        >
          <Select
            className="w-56"
            value={settings.filenameTemplate}
            onChange={(filenameTemplate) => settings.update({ filenameTemplate })}
            options={FILENAME_TEMPLATES.map((tpl) => ({ value: tpl, label: tpl }))}
            ariaLabel={t("settings.filenameTemplate")}
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
                    : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
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
            onChange={(v) => settings.update({ rateLimitKbps: v === "none" ? null : Number(v) })}
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
          label={t("settings.groupByPlatform")}
          hint={t("settings.groupByPlatformHint")}
          checked={settings.groupByPlatform}
          onChange={(groupByPlatform) => settings.update({ groupByPlatform })}
        />
        <ToggleRow
          label={t("settings.clipboardSuggest")}
          hint={t("settings.clipboardSuggestHint")}
          checked={settings.clipboardSuggest}
          onChange={(clipboardSuggest) => settings.update({ clipboardSuggest })}
        />
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
          <p className="text-sm text-[var(--dk-text)]">{t("settings.subtitleLangs")}</p>
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
                      ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-[var(--dk-text)]"
                      : "border-[var(--dk-border)] text-[var(--dk-text-muted)] hover:border-[var(--dk-border-strong)] hover:text-[var(--dk-text)]"
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

      <Section tour="settings-privacy" icon={<History size={18} />} title={t("settings.privacy")}>
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
    </>
  );
}

/** Araçlar bölümündeki yt-dlp ve Deno satırları (sürüm, elle ve otomatik güncelleme). */
export function YtdlpRows({
  tools,
  onUpdated,
}: {
  tools: ToolVersions | null;
  onUpdated: (version: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore();
  const [status, setStatus] = useState<"idle" | "updating" | "error">("idle");

  async function updateNow() {
    setStatus("updating");
    try {
      const version = await updateYtdlp();
      settings.update({ lastYtdlpUpdateCheck: Date.now() });
      onUpdated(version);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const hint =
    status === "updating"
      ? t("settings.updating")
      : status === "error"
        ? t("settings.updateFailed")
        : (tools?.ytdlp ?? t("settings.toolNotInstalled"));
  const date = (ms: number) =>
    new Date(ms).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Row label="yt-dlp" hint={hint}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          onClick={() => void updateNow()}
          disabled={status === "updating"}
        >
          {status === "updating" ? t("settings.updating") : t("settings.updateYtdlp")}
        </Button>
      </Row>
      <Row label="Deno" hint={tools?.deno ?? t("settings.denoNotInstalled")} />
      <ToggleRow
        label={t("settings.autoUpdateYtdlp")}
        hint={
          settings.lastYtdlpUpdateCheck
            ? t("settings.lastChecked", { date: date(settings.lastYtdlpUpdateCheck) })
            : t("settings.ytdlpHint")
        }
        checked={settings.autoUpdateYtdlp}
        onChange={(autoUpdateYtdlp) => settings.update({ autoUpdateYtdlp })}
      />
    </>
  );
}
