import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ImagePlus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import {
  bakedFilter,
  clearBackground,
  DEFAULT_BACKGROUND,
  loadBackgroundSource,
  prepareSource,
  rebake,
  setBackgroundSource,
  useBackgroundImage,
  type BackgroundFit,
  type BackgroundSettings,
} from "../lib/background";
import { localizeError } from "../lib/errors";
import { parseThemeFile, toThemeFile } from "../lib/themeFile";
import {
  CUSTOM_THEME_ID,
  customTheme,
  DEFAULT_CUSTOM_COLORS,
  getTheme,
  resolveTheme,
  type CustomColors,
} from "../lib/themes";
import { chooseJsonSavePath, chooseTextFile, textFileRead, textFileWrite } from "../lib/tauri-api";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";
import { Tabs } from "./ui/Tabs";
import { ThemePreview } from "./ThemePreview";

const COLOR_FIELDS = ["bg", "surface", "text", "accent", "accent2"] as const;

/** Ördek temalarının zemin renkleri (koyu ve açık). */
function baseColors(mode: CustomColors["mode"]): Partial<CustomColors> {
  const p = getTheme(mode === "dark" ? "ordek" : "ordekLight").palette;
  return { mode, bg: p.bg, surface: p.surface, text: p.text };
}

/** Ayarlar → Tema → Özel: kendi renklerin, arka plan resmi ve tema paylaşımı. */
export function CustomThemePanel() {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const colors = useSettingsStore((s) => s.customColors);
  const update = useSettingsStore((s) => s.update);
  const active = theme === CUSTOM_THEME_ID;

  // Renk değişince özel tema da seçilir: değişikliği hemen görmek için.
  const setColors = (patch: Partial<CustomColors>) =>
    update({ customColors: { ...colors, ...patch }, theme: CUSTOM_THEME_ID });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-semibold text-white">{t("settings.customColors")}</p>
          <Tabs<CustomColors["mode"]>
            value={colors.mode}
            // Zemin değişince zemin, panel ve yazı o kipe uygun renklere döner; vurgular kalır.
            onChange={(mode) => setColors(baseColors(mode))}
            items={[
              { value: "dark", label: t("settings.customModeDark") },
              { value: "light", label: t("settings.customModeLight") },
            ]}
          />
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
            {COLOR_FIELDS.map((field) => (
              <label
                key={field}
                className="flex items-center gap-2 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface)] px-2 py-1.5 text-xs"
              >
                <input
                  type="color"
                  value={colors[field]}
                  onChange={(e) => setColors({ [field]: e.target.value })}
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="truncate">{t(`settings.customColor.${field}`)}</span>
              </label>
            ))}
          </div>
          <ThemePreview theme={customTheme(colors)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <Button size="sm" onClick={() => update({ theme: CUSTOM_THEME_ID })}>
              {t("settings.customUse")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Şu anki hazır temanın renklerinden başla.
              const p = resolveTheme(theme, colors).palette;
              setColors({
                mode: resolveTheme(theme, colors).mode,
                bg: p.bg,
                surface: p.surface,
                text: p.text,
                accent: p.accent,
                accent2: p.accent2,
              });
            }}
          >
            {t("settings.customFromCurrent")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} />}
            onClick={() => setColors(DEFAULT_CUSTOM_COLORS)}
          >
            {t("settings.customReset")}
          </Button>
        </div>
      </div>

      <BackgroundPanel />
      <ShareRow />
    </div>
  );
}

function BackgroundPanel() {
  const { t } = useTranslation();
  const background = useSettingsStore((s) => s.background);
  const update = useSettingsStore((s) => s.update);
  const image = useBackgroundImage((s) => s.image);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<BackgroundSettings>) =>
    update({ background: { ...useSettingsStore.getState().background, ...patch } });

  // Bulanıklık ve renk ayarları değişince resim bir kez yeniden işlenir
  // (kaydırıcı bırakılmasını beklemek için kısa gecikmeyle).
  const filter = bakedFilter(background);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void rebake(useSettingsStore.getState().background).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [filter]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const source = await prepareSource(file);
      const next = { ...useSettingsStore.getState().background, enabled: true };
      await setBackgroundSource(source, next);
      update({ background: next });
    } catch (err) {
      setError(
        err instanceof Error
          ? t("settings.bgFailed")
          : localizeError(err, "settings.bgFailed").message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-4">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-sm font-semibold text-white">{t("settings.bgTitle")}</p>
        {image ? (
          <Switch
            checked={background.enabled}
            onChange={(enabled) => set({ enabled })}
            label={t("settings.bgShow")}
          />
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            className="h-16 w-28 rounded-lg border border-[var(--dk-border)] object-cover"
          />
        ) : (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("settings.bgHint")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<ImagePlus size={14} />}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {image ? t("settings.bgChange") : t("settings.bgPick")}
          </Button>
          {image ? (
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} />}
              disabled={busy}
              onClick={() => {
                void clearBackground();
                set({ enabled: false });
              }}
            >
              {t("settings.bgRemove")}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-[var(--dk-error)]">{error}</p> : null}
      {image ? (
        <>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Slider
              label={t("settings.bgOpacity")}
              value={background.opacity}
              min={0.1}
              max={1}
              percent
              onChange={(opacity) => set({ opacity })}
            />
            <Slider
              label={t("settings.bgPanels")}
              value={background.panelAlpha}
              min={0.4}
              max={1}
              percent
              onChange={(panelAlpha) => set({ panelAlpha })}
            />
            <Slider
              label={t("settings.bgBlur")}
              value={background.blur}
              min={0}
              max={40}
              step={1}
              onChange={(blur) => set({ blur })}
            />
            <Slider
              label={t("settings.bgBrightness")}
              value={background.brightness}
              min={0.2}
              max={1.5}
              percent
              onChange={(brightness) => set({ brightness })}
            />
            <Slider
              label={t("settings.bgContrast")}
              value={background.contrast}
              min={0.5}
              max={1.5}
              percent
              onChange={(contrast) => set({ contrast })}
            />
            <Slider
              label={t("settings.bgSaturate")}
              value={background.saturate}
              min={0}
              max={2}
              percent
              onChange={(saturate) => set({ saturate })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs<BackgroundFit>
              value={background.fit}
              onChange={(fit) => set({ fit })}
              items={[
                { value: "cover", label: t("settings.bgCover") },
                { value: "contain", label: t("settings.bgContain") },
                { value: "center", label: t("settings.bgCenter") },
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              onClick={() => set({ ...DEFAULT_BACKGROUND, enabled: background.enabled })}
            >
              {t("settings.bgReset")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  percent,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  percent?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-[var(--dk-text-muted)]">
          {percent ? `${Math.round(value * 100)}%` : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--dk-accent)]"
      />
    </label>
  );
}

/** Temayı (renkler + arka plan + resim) JSON dosyası olarak paylaş. */
function ShareRow() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.update);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const exportFile = async () => {
    setMessage(null);
    try {
      const path = await chooseJsonSavePath("downkit-tema.json");
      if (!path) return;
      const { customColors, background } = useSettingsStore.getState();
      const source = await loadBackgroundSource();
      const file = toThemeFile(customColors, background, source);
      await textFileWrite(path, JSON.stringify(file));
      setMessage({
        ok: true,
        text:
          source && !file.image ? t("settings.themeExportedNoImage") : t("settings.themeExported"),
      });
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "settings.themeFileFailed").message });
    }
  };

  const importFile = async () => {
    setMessage(null);
    try {
      const path = await chooseTextFile("json");
      if (!path) return;
      const parsed = parseThemeFile(JSON.parse(await textFileRead(path)));
      if (!parsed) {
        setMessage({ ok: false, text: t("settings.themeFileInvalid") });
        return;
      }
      if (parsed.image) await setBackgroundSource(parsed.image, parsed.background);
      else await clearBackground();
      update({
        customColors: parsed.colors,
        background: parsed.background,
        theme: CUSTOM_THEME_ID,
      });
      setMessage({ ok: true, text: t("settings.themeImported") });
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "settings.themeFileFailed").message });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
      <Button
        size="sm"
        variant="secondary"
        icon={<Upload size={14} />}
        onClick={() => void exportFile()}
      >
        {t("settings.themeExport")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={<Download size={14} />}
        onClick={() => void importFile()}
      >
        {t("settings.themeImport")}
      </Button>
      <span className="text-xs text-[var(--dk-text-muted)]">{t("settings.themeShareHint")}</span>
      {message ? (
        <span
          className={`text-xs ${message.ok ? "text-[var(--dk-success)]" : "text-[var(--dk-error)]"}`}
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
