import { useEffect, useState, type ReactNode } from "react";
import { formatPercent } from "../../lib/format";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ChevronDown,
  Cpu,
  FolderOpen,
  Keyboard,
  Lock,
  Mic,
  Monitor,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { useRecorderStore } from "../../store/recorderStore";
import {
  BITRATE_MAX_KBPS,
  BITRATE_MIN_KBPS,
  BITRATE_STEP_KBPS,
  clampBitrate,
  RECORD_FPS,
  RECORD_HEIGHTS,
  RECORD_QUALITIES,
  RECORD_SPEEDS,
  useRecorderSettings,
  type RecorderSource,
} from "../../lib/recorderSettings";
import { useSettingsStore } from "../../lib/appSettings";
import { resolveOutputDir } from "../../lib/recorder";
import {
  monitorLabel,
  monitorsBounds,
  resolveMonitors,
  resolveSource,
} from "../../lib/recorderLogic";
import { chooseDownloadDir, openFolder, recorderGpus } from "../../lib/tauri-api";
import type { GpuAdapter, RecorderEncoder } from "../../types/recorder";
import { Select, type SelectOption } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { HotkeyInput } from "./HotkeyInput";
import { SourcePicker } from "./SourcePicker";

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

function VolumeSlider({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  label: string;
}) {
  const { i18n } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={Math.round(value * 100)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 accent-[var(--dk-accent)] disabled:opacity-40"
      />
      <span className="w-11 text-right font-mono text-xs text-[var(--dk-text-muted)]">
        {formatPercent(value, i18n.language)}
      </span>
    </div>
  );
}

const VENDOR_ENCODER: Record<number, RecorderEncoder> = {
  0x10de: "nvenc",
  0x1002: "amf",
  0x8086: "qsv",
};

/** Kodlayıcı ve hız: çoğu kullanıcı "Otomatik"te kalır, bu yüzden kapalı başlar.
 * Ekran kartı seçimi kodlayıcı seçimiyle aynıdır: her kartın kendi kodlayıcısı var. */
function AdvancedVideo() {
  const { t } = useTranslation();
  const settings = useRecorderSettings();
  const current = useRecorderStore((s) => s.encoder);
  const [open, setOpen] = useState(settings.encoder !== null || settings.speed !== "balanced");
  const [gpus, setGpus] = useState<GpuAdapter[]>([]);
  useEffect(() => {
    recorderGpus()
      .then(setGpus)
      .catch(() => setGpus([]));
  }, []);

  const encoderOptions: SelectOption<RecorderEncoder | "auto">[] = [
    {
      value: "auto",
      label: t("recorder.encoderAuto"),
      hint: current ? current.label : t("recorder.encoderAutoHint"),
    },
  ];
  const seen = new Set<RecorderEncoder>();
  for (const gpu of gpus) {
    const encoder = VENDOR_ENCODER[gpu.vendorId];
    if (!encoder || seen.has(encoder)) continue;
    seen.add(encoder);
    encoderOptions.push({
      value: encoder,
      label: gpu.name,
      hint: t(`recorder.encoderName.${encoder}`),
    });
  }
  // Kayıtlı seçim bu bilgisayarda yoksa (kart çıkarıldı) yine görünsün.
  if (settings.encoder && settings.encoder !== "x264" && !seen.has(settings.encoder)) {
    encoderOptions.push({
      value: settings.encoder,
      label: t(`recorder.encoderName.${settings.encoder}`),
      hint: t("recorder.encoderMissing"),
    });
  }
  encoderOptions.push({
    value: "x264",
    label: t("recorder.encoderCpu"),
    hint: t("recorder.encoderCpuHint"),
  });

  return (
    <div className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 lg:col-span-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
      >
        <Cpu size={15} className="text-[var(--dk-text-muted)]" />
        <span className="flex-1">{t("recorder.advanced")}</span>
        <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-[var(--dk-border)] p-3 sm:grid-cols-2">
          <Field label={t("recorder.encoder")}>
            <Select
              value={settings.encoder ?? "auto"}
              ariaLabel={t("recorder.encoder")}
              onChange={(v) => settings.update({ encoder: v === "auto" ? null : v })}
              options={encoderOptions}
            />
          </Field>
          <Field label={t("recorder.speed")}>
            <Select
              value={settings.speed}
              ariaLabel={t("recorder.speed")}
              onChange={(speed) => settings.update({ speed })}
              options={RECORD_SPEEDS.map((v) => ({
                value: v,
                label: t(`recorder.speedName.${v}`),
                hint: t(`recorder.speedHint.${v}`),
              }))}
            />
          </Field>
          <p className="text-[11px] text-[var(--dk-text-muted)] sm:col-span-2">
            {t("recorder.advancedHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Pencere kaynağının anahtarı: exe ile başlık görünmez bir ayraçla birleşir.
const WINDOW_SEP = String.fromCharCode(0);

function sourceValue(source: RecorderSource): string {
  if (source.kind === "monitors") return "m:multi";
  return source.kind === "monitor"
    ? `m:${source.number}`
    : `w:${source.exe}${WINDOW_SEP}${source.title}`;
}

export function RecorderSettingsCard() {
  const { t, i18n } = useTranslation();
  const settings = useRecorderSettings();
  const update = settings.update;
  const sources = useRecorderStore((s) => s.sources);
  const outputDir = useRecorderStore((s) => s.outputDir);
  const active = useRecorderStore((s) => s.status.recording !== null || s.status.replay !== null);

  const current = sources ? resolveSource(settings.source, sources) : null;
  const multi =
    settings.source.kind === "monitors" && sources
      ? resolveMonitors(settings.source.numbers, sources)
      : null;
  const options: SelectOption<string>[] = [];
  const sourceMap = new Map<string, RecorderSource>();
  const add = (source: RecorderSource, label: string, hint?: string) => {
    const value = sourceValue(source);
    sourceMap.set(value, source);
    options.push({ value, label, hint });
  };
  // Her ekran bir kez listelenir: birincil "Ana ekran", ötekiler "2. ekran"…
  for (const m of sources?.monitors ?? []) {
    add({ kind: "monitor", number: m.number }, monitorLabel(m, t), `${m.width}×${m.height}`);
  }
  for (const w of sources?.windows ?? []) {
    if (w.own) continue;
    add({ kind: "window", exe: w.exe, title: w.title }, w.title, w.exe);
  }
  // Kayıtlı pencere şu an açık değilse de seçili görünsün.
  let selected = sourceValue(settings.source);
  if (settings.source.kind === "monitors") {
    // Çoklu seçim açılır listede karşılığı olmayan özel bir değerle gösterilir.
    selected = "m:multi";
    const label =
      multi && multi.length > 0
        ? multi.length === 1
          ? monitorLabel(multi[0], t)
          : t("recorder.multiScreen", { count: multi.length })
        : t("recorder.sourceMissing");
    const hint =
      multi && multi.length > 1
        ? (() => {
            const b = monitorsBounds(multi);
            return `${b.width}×${b.height}`;
          })()
        : undefined;
    options.unshift({ value: selected, label, hint });
  } else if (!sourceMap.has(selected) && settings.source.kind === "window") {
    add(settings.source, settings.source.title, t("recorder.windowClosed"));
  }

  const [picking, setPicking] = useState(false);
  const speakerOptions: SelectOption<string>[] = [
    { value: "", label: t("recorder.defaultSpeaker") },
    ...(sources?.speakers ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const microphones = sources?.microphones ?? [];
  const micOptions: SelectOption<string>[] = [
    { value: "", label: t("recorder.defaultMic") },
    ...microphones.map((m) => ({ value: m.id, label: m.name })),
  ];

  // Basit modda yalnızca varsayılan değerindeki gelişmiş ayarlar gizlenir.
  const advanced = useSettingsStore((s) => s.advanced);
  const showResolution = advanced || settings.maxHeight !== null;

  const qualityLabel = {
    high: t("recorder.qualityHigh"),
    balanced: t("recorder.qualityBalanced"),
    small: t("recorder.qualitySmall"),
  };

  return (
    <section className="dk-card space-y-5 p-5" data-tour="record-settings">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <SlidersHorizontal size={17} />
          </span>
          {t("recorder.settingsTitle")}
        </h2>
      </div>

      {active ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-[var(--dk-warning)]/40 bg-[var(--dk-warning)]/10 px-3 py-2.5 text-sm"
        >
          <Lock size={15} className="shrink-0 text-[var(--dk-warning)]" />
          {t("recorder.lockedWhileActive")}
        </p>
      ) : null}

      {/* Kayıt ya da geriye dönük kayıt sürerken ayarlar kilitlenir: süren ffmpeg
          oturumu değişikliği almaz, yarıda değişen kaynak ya da klasör hata verir. */}
      <fieldset
        disabled={active}
        className={`grid gap-6 lg:grid-cols-2 ${active ? "pointer-events-none opacity-60 select-none" : ""}`}
      >
        <Group
          icon={current && "hwnd" in current ? <AppWindow size={16} /> : <Monitor size={16} />}
          title={t("recorder.whatToRecord")}
          tour="record-source"
        >
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] px-3 py-2.5 text-left transition hover:border-[var(--dk-accent)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
              {current && "hwnd" in current ? <AppWindow size={17} /> : <Monitor size={17} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">
                {options.find((o) => o.value === selected)?.label ?? "…"}
              </span>
              <span className="block truncate text-xs text-[var(--dk-text-muted)]">
                {options.find((o) => o.value === selected)?.hint ?? ""}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-[var(--dk-accent-hover)]">
              {t("options.change")}
            </span>
          </button>
          {picking && !active ? <SourcePicker onClose={() => setPicking(false)} /> : null}
          <p className="text-xs text-[var(--dk-text-muted)]">
            {settings.source.kind === "window"
              ? t("recorder.windowHint")
              : t("recorder.screenHint")}
          </p>
          <div className={`grid gap-3 ${showResolution ? "grid-cols-3" : "grid-cols-2"}`}>
            <Field label={t("recorder.fps")}>
              <Select
                value={settings.fps}
                ariaLabel={t("recorder.fps")}
                onChange={(fps) => update({ fps })}
                options={RECORD_FPS.map((f) => ({ value: f, label: `${f} fps` }))}
              />
            </Field>
            {showResolution ? (
              <Field label={t("recorder.resolution")}>
                <Select
                  value={settings.maxHeight ?? 0}
                  ariaLabel={t("recorder.resolution")}
                  onChange={(h) => update({ maxHeight: h === 0 ? null : h })}
                  options={RECORD_HEIGHTS.map((h) => ({
                    value: h ?? 0,
                    label: h === null ? t("recorder.native") : `${h}p`,
                  }))}
                />
              </Field>
            ) : null}
            <Field label={t("recorder.quality")}>
              <Select
                value={settings.bitrateKbps === null ? settings.quality : "custom"}
                ariaLabel={t("recorder.quality")}
                onChange={(value) =>
                  value === "custom"
                    ? update({ bitrateKbps: settings.bitrateKbps ?? 12_000 })
                    : update({ quality: value, bitrateKbps: null })
                }
                options={[
                  ...RECORD_QUALITIES.map((q) => ({ value: q, label: qualityLabel[q] })),
                  ...(advanced || settings.bitrateKbps !== null
                    ? [{ value: "custom" as const, label: t("recorder.customBitrate") }]
                    : []),
                ]}
              />
            </Field>
          </div>
          {settings.bitrateKbps !== null ? (
            <div className="space-y-1 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3">
              <div className="flex items-center justify-between text-xs text-[var(--dk-text-muted)]">
                <span>{t("recorder.bitrate")}</span>
                <span className="font-mono text-[var(--dk-text)]">
                  {(settings.bitrateKbps / 1000).toLocaleString(i18n.language, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  Mbps
                </span>
              </div>
              <input
                type="range"
                min={BITRATE_MIN_KBPS}
                max={BITRATE_MAX_KBPS}
                step={BITRATE_STEP_KBPS}
                value={settings.bitrateKbps}
                aria-label={t("recorder.bitrate")}
                onChange={(e) => update({ bitrateKbps: clampBitrate(Number(e.target.value)) })}
                className="w-full accent-[var(--dk-accent)]"
              />
              <p className="text-[11px] text-[var(--dk-text-muted)]">{t("recorder.bitrateHint")}</p>
            </div>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("recorder.showCursor")}
            <Switch
              checked={settings.cursor}
              onChange={(cursor) => update({ cursor })}
              label={t("recorder.showCursor")}
            />
          </label>
        </Group>

        <Group icon={<Volume2 size={16} />} title={t("recorder.audio")} tour="record-audio">
          <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Volume2 size={15} className="text-[var(--dk-text-muted)]" />
                {t("recorder.systemAudio")}
              </span>
              <Switch
                checked={settings.systemAudio}
                onChange={(systemAudio) => update({ systemAudio })}
                label={t("recorder.systemAudio")}
              />
            </label>
            {advanced || settings.systemAudioId !== null ? (
              <Select
                value={settings.systemAudioId ?? ""}
                disabled={!settings.systemAudio}
                ariaLabel={t("recorder.speakerDevice")}
                onChange={(id) => update({ systemAudioId: id || null })}
                options={speakerOptions}
              />
            ) : null}
            <VolumeSlider
              value={settings.systemVolume}
              disabled={!settings.systemAudio}
              label={t("recorder.systemVolume")}
              onChange={(systemVolume) => update({ systemVolume })}
            />
          </div>
          <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Mic size={15} className="text-[var(--dk-text-muted)]" />
                {t("recorder.microphone")}
              </span>
              <Switch
                checked={settings.microphone}
                onChange={(microphone) => update({ microphone })}
                label={t("recorder.microphone")}
              />
            </label>
            <Select
              value={settings.microphoneId ?? ""}
              disabled={!settings.microphone}
              ariaLabel={t("recorder.microphoneDevice")}
              onChange={(id) => update({ microphoneId: id || null })}
              options={micOptions}
            />
            <VolumeSlider
              value={settings.microphoneVolume}
              disabled={!settings.microphone}
              label={t("recorder.microphoneVolume")}
              onChange={(microphoneVolume) => update({ microphoneVolume })}
            />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{t("recorder.noiseSuppression")}</span>
                <span className="block text-[11px] text-[var(--dk-text-muted)]">
                  {t("recorder.noiseSuppressionHint")}
                </span>
              </span>
              <Switch
                checked={settings.noiseSuppression}
                disabled={!settings.microphone}
                onChange={(noiseSuppression) => update({ noiseSuppression })}
                label={t("recorder.noiseSuppression")}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{t("recorder.micSeparate")}</span>
                <span className="block text-[11px] text-[var(--dk-text-muted)]">
                  {t("recorder.micSeparateHint")}
                </span>
              </span>
              <Switch
                checked={settings.microphoneSeparate}
                disabled={!settings.microphone}
                onChange={(microphoneSeparate) => update({ microphoneSeparate })}
                label={t("recorder.micSeparate")}
              />
            </label>
          </div>
        </Group>

        <Group icon={<Keyboard size={16} />} title={t("recorder.hotkeys")} tour="record-hotkeys">
          <p className="text-xs text-[var(--dk-text-muted)]">{t("recorder.hotkeysHint")}</p>
          <HotkeyInput id="record" label={t("recorder.hotkeyRecord")} />
          <HotkeyInput id="saveReplay" label={t("recorder.hotkeySave")} />
          <HotkeyInput id="toggleReplay" label={t("recorder.hotkeyToggleReplay")} />
          <HotkeyInput id="marker" label={t("recorder.hotkeyMarker")} />
        </Group>

        <Group icon={<FolderOpen size={16} />} title={t("recorder.folder")}>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block">{t("recorder.byApp")}</span>
              <span className="block text-[11px] text-[var(--dk-text-muted)]">
                {t("recorder.byAppHint")}
              </span>
            </span>
            <Switch
              checked={settings.byApp}
              onChange={(byApp) => update({ byApp })}
              label={t("recorder.byApp")}
            />
          </label>
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
                if (dir) {
                  update({ outputDir: dir });
                  await resolveOutputDir();
                }
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
                {t("recorder.openFolder")}
              </button>
            ) : null}
            {settings.outputDir ? (
              <button
                type="button"
                onClick={async () => {
                  update({ outputDir: null });
                  await resolveOutputDir();
                }}
                className="px-1 text-[var(--dk-accent-hover)] hover:underline"
              >
                {t("recorder.defaultFolder")}
              </button>
            ) : null}
          </div>
        </Group>

        {advanced || settings.encoder !== null || settings.speed !== "balanced" ? (
          <AdvancedVideo />
        ) : (
          <button
            type="button"
            onClick={() => useSettingsStore.getState().update({ advanced: true })}
            className="flex items-center gap-2 text-left text-xs text-[var(--dk-text-muted)] hover:text-[var(--dk-text)] lg:col-span-2"
          >
            <Cpu size={14} />
            {t("recorder.showAdvanced")}
          </button>
        )}
      </fieldset>
    </section>
  );
}
