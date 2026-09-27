import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  FileImage,
  FolderOpen,
  Keyboard,
  Languages,
  MousePointerClick,
  SlidersHorizontal,
} from "lucide-react";
import {
  CAPTURE_DELAYS,
  ENTER_ACTIONS,
  QUALITY_MAX,
  QUALITY_MIN,
  SHOT_FORMATS,
  TRANSLATE_DIRECTIONS,
  useSnipSettings,
} from "../../lib/snipSettings";
import { refreshShots, resolveShotDir } from "../../lib/snipActions";
import { chooseDownloadDir, openFolder } from "../../lib/tauri-api";
import { useSnipStore } from "../../store/snipStore";
import { HotkeyInput } from "../recorder/HotkeyInput";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";

function Group({
  icon,
  title,
  tour,
  children,
}: {
  icon: ReactNode;
  title: string;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3" data-tour={tour}>
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className="text-[var(--dk-accent-hover)]">{icon}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs text-[var(--dk-text-muted)]">{label}</p>
      {children}
    </div>
  );
}

/** Ekran Görüntüsü sayfasındaki ayarlar: kısayollar, seçimden sonra ne olacağı,
 * dosya biçimi, klasör, gecikme ve çeviri yönü. */
export function SnipSettingsCard() {
  const { t } = useTranslation();
  const settings = useSnipSettings();
  const update = settings.update;
  const outputDir = useSnipStore((s) => s.outputDir);

  useEffect(() => {
    resolveShotDir().catch(() => {
      // Tarayıcı önizlemesinde klasör yok.
    });
  }, []);

  const changeDir = async (dir: string | null) => {
    update({ outputDir: dir });
    await resolveShotDir().catch(() => {});
    await refreshShots();
  };

  return (
    <section className="dk-card space-y-5 p-5" data-tour="snip-settings">
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          <SlidersHorizontal size={17} />
        </span>
        {t("snip.settingsTitle")}
      </h2>

      <div className="grid gap-6 lg:grid-cols-2">
        <Group icon={<Keyboard size={16} />} title={t("snip.hotkeys")} tour="snip-hotkeys">
          <p className="text-xs text-[var(--dk-text-muted)]">{t("snip.hotkeysHint")}</p>
          <HotkeyInput id="snip" label={t("snip.hotkeyRegion")} />
          <HotkeyInput id="snipFull" label={t("snip.hotkeyFull")} />
          <HotkeyInput id="snipTranslate" label={t("snip.hotkeyTranslate")} />
        </Group>

        <Group icon={<MousePointerClick size={16} />} title={t("snip.afterCapture")}>
          <Field label={t("snip.enterAction")}>
            <Select
              value={settings.enterAction}
              ariaLabel={t("snip.enterAction")}
              onChange={(enterAction) => update({ enterAction })}
              options={ENTER_ACTIONS.map((a) => ({
                value: a,
                label: t(`snip.enter.${a}`),
                hint: t(`snip.enter.${a}Hint`),
              }))}
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block">{t("snip.copyOnSave")}</span>
              <span className="block text-[11px] text-[var(--dk-text-muted)]">
                {t("snip.copyOnSaveHint")}
              </span>
            </span>
            <Switch
              checked={settings.copyOnSave}
              onChange={(copyOnSave) => update({ copyOnSave })}
              label={t("snip.copyOnSave")}
            />
          </label>
          <Field label={t("snip.delay")}>
            <Select
              value={settings.delaySeconds}
              ariaLabel={t("snip.delay")}
              onChange={(delaySeconds) => update({ delaySeconds })}
              options={CAPTURE_DELAYS.map((s) => ({
                value: s,
                label: s === 0 ? t("snip.noDelay") : t("snip.delaySeconds", { n: s }),
              }))}
            />
          </Field>
          <p className="text-[11px] text-[var(--dk-text-muted)]">{t("snip.delayHint")}</p>
        </Group>

        <Group icon={<FileImage size={16} />} title={t("snip.fileFormat")}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("snip.format")}>
              <Select
                value={settings.format}
                ariaLabel={t("snip.format")}
                onChange={(format) => update({ format })}
                options={SHOT_FORMATS.map((f) => ({
                  value: f,
                  label: f.toUpperCase(),
                  hint: t(`snip.formatHint.${f}`),
                }))}
              />
            </Field>
            <Field label={t("snip.quality")}>
              <div className="flex h-10 items-center gap-3">
                <input
                  type="range"
                  min={QUALITY_MIN}
                  max={QUALITY_MAX}
                  step={1}
                  value={settings.quality}
                  disabled={settings.format === "png"}
                  aria-label={t("snip.quality")}
                  onChange={(e) => update({ quality: Number(e.target.value) })}
                  className="flex-1 accent-[var(--dk-accent)] disabled:opacity-40"
                />
                <span className="w-10 text-right font-mono text-xs text-[var(--dk-text-muted)]">
                  {settings.format === "png" ? "—" : `%${settings.quality}`}
                </span>
              </div>
            </Field>
          </div>
          <p className="text-[11px] text-[var(--dk-text-muted)]">
            {settings.format === "png" ? t("snip.pngLossless") : t("snip.qualityHint")}
          </p>
        </Group>

        <Group icon={<Languages size={16} />} title={t("snip.translation")}>
          <Field label={t("snip.translateDirection")}>
            <Select
              value={settings.translateDirection}
              ariaLabel={t("snip.translateDirection")}
              onChange={(translateDirection) => update({ translateDirection })}
              options={TRANSLATE_DIRECTIONS.map((d) => ({
                value: d,
                label: t(`snip.direction.${d}`),
              }))}
            />
          </Field>
          <p className="text-[11px] text-[var(--dk-text-muted)]">{t("snip.translationHint")}</p>
        </Group>

        <Group icon={<FolderOpen size={16} />} title={t("snip.folder")}>
          <p
            className="truncate rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5 font-mono text-xs"
            title={outputDir ?? ""}
          >
            {outputDir ?? "…"}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={async () => {
                const dir = await chooseDownloadDir();
                if (dir) await changeDir(dir);
              }}
              className="rounded-lg border border-[var(--dk-border-strong)] px-2.5 py-1.5 hover:border-[var(--dk-accent)]"
            >
              {t("options.change")}
            </button>
            {outputDir ? (
              <button
                type="button"
                onClick={() => void openFolder(outputDir)}
                className="rounded-lg border border-[var(--dk-border-strong)] px-2.5 py-1.5 hover:border-[var(--dk-accent)]"
              >
                {t("snip.openFolder")}
              </button>
            ) : null}
            {settings.outputDir ? (
              <button
                type="button"
                onClick={() => void changeDir(null)}
                className="px-1 text-[var(--dk-accent-hover)] hover:underline"
              >
                {t("snip.defaultFolder")}
              </button>
            ) : null}
          </div>
        </Group>
      </div>
    </section>
  );
}
