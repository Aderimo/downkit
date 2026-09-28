import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cpu, Film, FolderOpen, Mic, Monitor, Rewind, Save, Square, Volume2 } from "lucide-react";
import { useRecorderStore } from "../../store/recorderStore";
import {
  REPLAY_MAX_SECONDS,
  REPLAY_MIN_SECONDS,
  REPLAY_STEP_SECONDS,
  clampReplaySeconds,
  useRecorderSettings,
} from "../../lib/recorderSettings";
import {
  replayLengthText,
  restartReplay,
  saveReplay,
  toggleRecording,
  toggleReplay,
} from "../../lib/recorder";
import { formatBytes, formatDuration } from "../../lib/format";
import {
  hotkeyLabel,
  resolveSource,
  resolveMonitors,
  monitorsBounds,
  isMonitor,
  monitorLabel,
} from "../../lib/recorderLogic";
import { meterFraction, readLevel, SILENT_METER, stepMeter } from "../../lib/levels";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

/** "Ana ekran · 2560×1440", "2 ekran · 4480×1440" ya da "Oyun — game.exe". */
function useSourceLabel(): string {
  const { t } = useTranslation();
  const source = useRecorderSettings((s) => s.source);
  const sources = useRecorderStore((s) => s.sources);
  if (!sources) return "";
  if (source.kind === "monitors") {
    const monitors = resolveMonitors(source.numbers, sources);
    if (monitors.length === 0) return t("recorder.sourceMissing");
    if (monitors.length === 1) {
      const m = monitors[0];
      return `${monitorLabel(m, t)} · ${m.width}×${m.height}`;
    }
    const bounds = monitorsBounds(monitors);
    return `${t("recorder.multiScreen", { count: monitors.length })} · ${bounds.width}×${bounds.height}`;
  }
  const item = resolveSource(source, sources);
  if (!item) return t("recorder.sourceMissing");
  if (isMonitor(item)) {
    return `${monitorLabel(item, t)} · ${item.width}×${item.height}`;
  }
  return `${item.title} — ${item.exe}`;
}

export function Kbd({ combo }: { combo: string | null }) {
  if (!combo) return null;
  return (
    <kbd className="rounded-md border border-[var(--dk-border-strong)] bg-[var(--dk-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--dk-text)]">
      {hotkeyLabel(combo)}
    </kbd>
  );
}

/** Yeşil (−60…−18 dB), sarı (…−7 dB), kırmızı dilimli seviye çubuğu. Seviye
 * `levels` deposundan her animasyon karesinde okunur ve çubuk doğrudan çizilir. */
function LevelMeter({ icon, label, index }: { icon: ReactNode; label: string; index: number }) {
  const maskRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let state = SILENT_METER;
    let last = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      state = stepMeter(state, readLevel(index, now), now, Math.min(0.1, (now - last) / 1000));
      last = now;
      if (maskRef.current) {
        maskRef.current.style.transform = `scaleX(${1 - meterFraction(state.db)})`;
      }
      if (peakRef.current) {
        const peak = meterFraction(state.peakDb);
        peakRef.current.style.left = `calc(${peak * 100}% - 2px)`;
        peakRef.current.style.opacity = peak > 0.02 ? "1" : "0";
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [index]);

  return (
    <div className="flex items-center gap-2" title={label}>
      <span className="text-[var(--dk-text-muted)]">{icon}</span>
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-full"
        style={{
          background:
            "linear-gradient(90deg, #22c55e 0%, #4ade80 70%, #facc15 70%, #facc15 88%, #ef4444 88%)",
        }}
      >
        {/* Dilim aralıkları: çubuk LED sırası gibi görünsün. */}
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_5px,var(--dk-surface)_5px_7px)] opacity-60" />
        <div
          ref={maskRef}
          className="absolute inset-0 origin-right bg-[var(--dk-bg)]"
          style={{ transform: "scaleX(1)" }}
        />
        <div
          ref={peakRef}
          className="absolute inset-y-0 w-0.5 rounded-full bg-white"
          style={{ left: 0, opacity: 0 }}
        />
      </div>
    </div>
  );
}

/** Anlık tekrar arabelleği: durum yarım saniyede bir gelir, çubuk aradaki süreyi
 * kendisi ilerletir (zıplamaz). Kayıttan sonra sıfıra geri kaymadan iner. */
function BufferBar({
  buffered,
  length,
  active,
}: {
  buffered: number;
  length: number;
  active: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const base = useRef({ value: buffered, at: 0 });

  useEffect(() => {
    base.current = { value: buffered, at: performance.now() };
  }, [buffered]);

  useEffect(() => {
    let frame = 0;
    const draw = (now: number) => {
      const value = active
        ? Math.min(length, base.current.value + (now - base.current.at) / 1000)
        : 0;
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${length > 0 ? value / length : 0})`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, length]);

  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--dk-bg)]">
      <div
        ref={barRef}
        className="h-full origin-left rounded-full bg-[#FFD43B]"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}

/** Kaydın özeti: hangi sesler, hangi görüntü ayarı, nereye kaydedilecek. Kart
 * boş kalmasın ve ayarlar aşağıya inmeden görülsün. */
function RecordInfo() {
  const { t, i18n } = useTranslation();
  const settings = useRecorderSettings();
  const sources = useRecorderStore((s) => s.sources);
  const outputDir = useRecorderStore((s) => s.outputDir);
  const speaker = sources?.speakers.find((d) => d.id === settings.systemAudioId);
  const mic = sources?.microphones.find((d) => d.id === settings.microphoneId);
  const audio = [
    settings.systemAudio ? (speaker?.name ?? t("recorder.systemAudio")) : null,
    settings.microphone
      ? `${mic?.name ?? t("recorder.microphone")}${settings.noiseSuppression ? ` · ${t("recorder.noiseShort")}` : ""}`
      : null,
  ].filter(Boolean);
  const quality =
    settings.bitrateKbps !== null
      ? `${(settings.bitrateKbps / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} Mbps`
      : t(`recorder.quality${settings.quality[0].toUpperCase()}${settings.quality.slice(1)}`);
  const video = [
    `${settings.fps} fps`,
    settings.maxHeight ? `${settings.maxHeight}p` : t("recorder.native"),
    quality,
  ].join(" · ");
  const rows: [ReactNode, string, string][] = [
    [
      <Volume2 key="a" size={13} />,
      t("recorder.audio"),
      audio.length ? audio.join(", ") : t("recorder.noAudio"),
    ],
    [<Film key="v" size={13} />, t("recorder.video"), video],
    [
      <FolderOpen key="f" size={13} />,
      t("recorder.folder"),
      `${outputDir ?? "…"}${settings.byApp ? ` ${t("recorder.byAppShort")}` : ""}`,
    ],
  ];
  return (
    <dl className="grid gap-1.5 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3 text-xs">
      {rows.map(([icon, label, value]) => (
        <div key={label} className="flex min-w-0 items-center gap-2">
          <dt className="flex w-24 shrink-0 items-center gap-1.5 text-[var(--dk-text-muted)]">
            {icon}
            {label}
          </dt>
          <dd className="min-w-0 truncate text-[var(--dk-text)]" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Kayıt süresi. FFmpeg'in bildirdiği süre düzensiz aralıklarla ve biraz geriden
 * gelir; sayaç ona her seferinde eşitlenince takılıyor, bazen bir saniye geri
 * sekiyordu. Artık kendi saatiyle akar ve yalnızca bildirilen süreden 1,5 sn'den
 * fazla kayarsa (ör. pencere yeniden açıldı) ona eşitlenir. Değişen rakam yukarıdan
 * kayarak girer. */
function DurationClock({ seconds, active }: { seconds: number; active: boolean }) {
  const [shown, setShown] = useState(0);
  // Sayacın 0:00 anı (Date.now() cinsinden); kayıt yokken boş.
  const origin = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      origin.current = null;
      return;
    }
    const now = Date.now();
    if (origin.current === null || Math.abs((now - origin.current) / 1000 - seconds) > 1.5) {
      origin.current = now - seconds * 1000;
    }
  }, [seconds, active]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      if (origin.current !== null) {
        const whole = Math.max(0, Math.floor((Date.now() - origin.current) / 1000));
        // Yalnızca saniye değişince çizilir.
        if (whole !== last) {
          last = whole;
          setShown(whole);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const text = formatDuration(active ? shown : seconds);
  return (
    <span className="inline-flex overflow-hidden">
      {[...text].map((ch, i) => (
        // Anahtar karakteri de içerir: yalnızca değişen rakam yeniden girer (canlanır).
        <span key={`${i}-${ch}`} className={active && /\d/.test(ch) ? "dk-digit" : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** Büyük kayıt düğmesi, süre, boyut ve ses seviyeleri. */
export function RecordCard() {
  const { t } = useTranslation();
  const recording = useRecorderStore((s) => s.status.recording);
  const replay = useRecorderStore((s) => s.status.replay);
  const pending = useRecorderStore((s) => s.pending);
  const encoder = useRecorderStore((s) => s.encoder);
  const settings = useRecorderSettings();
  const sourceLabel = useSourceLabel();
  const busy = pending === "record";
  const active = recording !== null;
  // Seviyeler yalnızca bir oturum açıkken gelir; açık kaynaklar sırasıyla.
  const live = active || replay !== null;
  const systemIndex = settings.systemAudio ? 0 : null;
  const micIndex = settings.microphone ? (settings.systemAudio ? 1 : 0) : null;

  return (
    <section className="dk-card flex flex-col gap-4 p-5" data-tour="record-main">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => void toggleRecording()}
          disabled={busy}
          aria-label={active ? t("recorder.stop") : t("recorder.start")}
          title={active ? t("recorder.stop") : t("recorder.start")}
          className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 transition disabled:opacity-60 ${
            active
              ? "border-[var(--dk-error)] bg-[var(--dk-error)]/15"
              : "border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] hover:border-[var(--dk-error)]"
          }`}
        >
          {active ? (
            <>
              <span className="absolute -inset-1.5 animate-pulse rounded-full border-2 border-[var(--dk-error)]/40" />
              <Square size={26} className="fill-[var(--dk-error)] text-[var(--dk-error)]" />
            </>
          ) : (
            <span className="h-9 w-9 rounded-full bg-[var(--dk-error)] shadow-[0_0_24px_rgb(248_113_113/45%)]" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm text-[var(--dk-text-muted)]">
            {active ? (
              <span className="flex items-center gap-1.5 font-semibold text-[var(--dk-error)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--dk-error)]" />
                {t("recorder.recordingNow")}
              </span>
            ) : busy ? (
              t("recorder.starting")
            ) : (
              t("recorder.ready")
            )}
          </p>
          <p className="font-mono text-4xl font-semibold text-white tabular-nums">
            <DurationClock seconds={recording?.seconds ?? 0} active={active} />
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--dk-text-muted)]">
            <Monitor size={13} className="shrink-0" />
            <span className="truncate">{sourceLabel}</span>
            {active ? <span className="shrink-0">· {formatBytes(recording.bytes)}</span> : null}
          </p>
        </div>
      </div>

      {live && (systemIndex !== null || micIndex !== null) ? (
        <div className="grid gap-1.5">
          {systemIndex !== null ? (
            <LevelMeter
              icon={<Volume2 size={14} />}
              label={t("recorder.systemAudio")}
              index={systemIndex}
            />
          ) : null}
          {micIndex !== null ? (
            <LevelMeter
              icon={<Mic size={14} />}
              label={t("recorder.microphone")}
              index={micIndex}
            />
          ) : null}
        </div>
      ) : null}

      <RecordInfo />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--dk-border)] pt-3 text-xs text-[var(--dk-text-muted)]">
        <span className="flex items-center gap-1.5">
          {t("recorder.hotkey")}: <Kbd combo={settings.hotkeys.record} />
        </span>
        {encoder ? (
          <span className="flex items-center gap-1.5" title={t("recorder.encoderHint")}>
            <Cpu size={13} />
            {encoder.hardware ? t("recorder.encoderGpu", { name: encoder.label }) : encoder.label}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/** Anlık tekrar süresi kaydırıcısı: 10 sn – 10 dk. Sürüklerken yalnızca yazı
 * değişir; bırakınca kaydedilir (açıksa anlık tekrar yeni süreyle yeniden başlar). */
function ReplayLength({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const seconds = useRecorderSettings((s) => s.replaySeconds);
  const update = useRecorderSettings((s) => s.update);
  const active = useRecorderStore((s) => s.status.replay !== null);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? seconds;

  const commit = () => {
    if (draft === null) return;
    const next = clampReplaySeconds(draft);
    setDraft(null);
    if (next === seconds) return;
    update({ replaySeconds: next });
    if (active) void restartReplay();
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-[var(--dk-text-muted)]">
        <span>{t("recorder.replayLength")}</span>
        <span className="font-mono text-[var(--dk-text)]">{replayLengthText(value)}</span>
      </div>
      <input
        type="range"
        min={REPLAY_MIN_SECONDS}
        max={REPLAY_MAX_SECONDS}
        step={REPLAY_STEP_SECONDS}
        value={value}
        disabled={disabled}
        aria-label={t("recorder.replayLength")}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-full accent-[#FFD43B] disabled:opacity-40"
      />
      <div className="flex justify-between text-[10px] text-[var(--dk-text-muted)]">
        <span>{replayLengthText(REPLAY_MIN_SECONDS)}</span>
        <span>{replayLengthText(REPLAY_MAX_SECONDS)}</span>
      </div>
    </div>
  );
}

/** Geriye dönük kayıt (anlık tekrar): aç/kapat, arabellek, son N saniyeyi kaydet. */
export function ReplayCard() {
  const { t } = useTranslation();
  const replay = useRecorderStore((s) => s.status.replay);
  const pending = useRecorderStore((s) => s.pending);
  const seconds = useRecorderSettings((s) => s.replaySeconds);
  const onStartup = useRecorderSettings((s) => s.replayOnStartup);
  const hotkeys = useRecorderSettings((s) => s.hotkeys);
  const update = useRecorderSettings((s) => s.update);
  const active = replay !== null;
  const length = replay?.seconds ?? seconds;
  const buffered = Math.min(replay?.bufferedSeconds ?? 0, length);
  const lengthLabel = replayLengthText(length);

  return (
    <section className="dk-card flex flex-col gap-4 p-5" data-tour="record-replay">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFD43B]/15 text-[var(--dk-brand)]">
          <Rewind size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{t("recorder.replayTitle")}</p>
          <p className="text-xs text-[var(--dk-text-muted)]">
            {t("recorder.replayHint", { length: lengthLabel })}
          </p>
        </div>
        <Switch
          checked={active}
          disabled={pending === "replay"}
          onChange={() => void toggleReplay()}
          label={t("recorder.replayTitle")}
        />
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-[var(--dk-text-muted)]">
          <span>
            {active
              ? t("recorder.buffer", {
                  have: formatDuration(buffered),
                  total: formatDuration(length),
                })
              : pending === "replay"
                ? t("recorder.starting")
                : t("recorder.replayOffShort")}
          </span>
          {replay ? <span>{replay.encoder}</span> : null}
        </div>
        <BufferBar buffered={buffered} length={length} active={active} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Save size={16} />}
          disabled={!active || pending === "save" || buffered < 1}
          onClick={() => void saveReplay()}
          className="flex-1"
        >
          {pending === "save"
            ? t("recorder.saving")
            : t("recorder.saveLast", { length: lengthLabel })}
        </Button>
      </div>

      <ReplayLength disabled={pending !== null} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--dk-border)] pt-3 text-xs text-[var(--dk-text-muted)]">
        <span className="flex items-center gap-1.5">
          {t("recorder.saveHotkey")}: <Kbd combo={hotkeys.saveReplay} />
        </span>
        <label className="flex items-center gap-2">
          {t("recorder.replayOnStartup")}
          <Switch
            checked={onStartup}
            onChange={(replayOnStartup) => update({ replayOnStartup })}
            label={t("recorder.replayOnStartup")}
          />
        </label>
      </div>
    </section>
  );
}
