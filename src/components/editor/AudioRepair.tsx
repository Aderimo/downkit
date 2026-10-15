import { sliderKeys } from "../../lib/sliderKeys";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Headphones, Mic, Music2, Square } from "lucide-react";
import { AUDIO_FX_PRESETS, EQ_LIMIT, normalizeAudioFx, type AudioFx } from "../../lib/audioFx";
import { clipSourceAt, type SeqClip } from "../../lib/sequence";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { audioFxPreview, openLocalPreview } from "../../lib/tauri-api";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { Switch } from "../ui/Switch";
import { HelpTip } from "../ui/HelpTip";

const OFF: AudioFx = { music: false, noise: 0, wind: false, echo: 0, enhance: false };
const PREVIEW_SECONDS = 6;

function setFx(id: string, fx: AudioFx | undefined, live = false) {
  const s = useEditorStore.getState();
  const next = (clips: SeqClip[]) =>
    clips.map((c) => {
      if (c.id !== id) return c;
      const out: SeqClip = { ...c, audioFx: normalizeAudioFx(fx) };
      if (!out.audioFx) delete out.audioFx;
      return out;
    });
  if (live) s.dragTo(next(s.dragOrigin?.clips ?? s.clips));
  else {
    s.apply(next);
    refreshPlayback();
  }
}

/** Ses onarım asistanı: konuşma/müzik, gürültü, rüzgâr, yankı, iyileştirme ve önce/sonra. */
export function AudioRepair({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const fx = clip.audioFx ?? OFF;
  const update = (patch: Partial<AudioFx>, live = false) =>
    setFx(clip.id, { ...fx, ...patch }, live);
  return (
    <div className="space-y-2 rounded-xl bg-[var(--dk-bg)]/60 p-2.5" data-audio-repair>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        {t("audioFx.title")}
        <HelpTip title={t("audioFx.title")} text={t("audioFx.hint")} />
      </p>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t("audioFx.mode")}>
        {(["speech", "music"] as const).map((mode) => {
          const on = clip.audioFx !== undefined && fx.music === (mode === "music");
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setFx(clip.id, AUDIO_FX_PRESETS[mode])}
              className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] ${
                on
                  ? "border-transparent bg-[var(--dk-accent)] text-white"
                  : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
              }`}
            >
              {mode === "speech" ? <Mic size={12} /> : <Music2 size={12} />}
              {t(`audioFx.${mode}`)}
            </button>
          );
        })}
      </div>
      <Amount
        label={t("audioFx.noise")}
        value={fx.noise}
        onChange={(v, live) => update({ noise: v }, live)}
      />
      <Amount
        label={t("audioFx.echo")}
        value={fx.echo}
        onChange={(v, live) => update({ echo: v }, live)}
      />
      <Toggle label={t("audioFx.wind")} checked={fx.wind} onChange={(wind) => update({ wind })} />
      <Toggle
        label={t(fx.music ? "audioFx.enhanceMusic" : "audioFx.enhance")}
        checked={fx.enhance}
        onChange={(enhance) => update({ enhance })}
      />
      <EqDynamics fx={fx} update={update} />
      <BeforeAfter clip={clip} />
    </div>
  );
}

/** Eşitleyici (bas/orta/tiz), sıkıştırıcı ve sınırlayıcı: açılır bölüm. */
function EqDynamics({
  fx,
  update,
}: {
  fx: AudioFx;
  update: (patch: Partial<AudioFx>, live?: boolean) => void;
}) {
  const { t } = useTranslation();
  const used = !!(fx.low || fx.mid || fx.high || fx.compress || fx.limit);
  const [open, setOpen] = useState(used);
  return (
    <div className="space-y-2 border-t border-[var(--dk-border)] pt-2" data-audio-eq>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-[11px] font-medium"
      >
        <span>
          {t("audioFx.eqTitle")}
          {used && !open ? <span className="ml-1 text-[var(--dk-accent-hover)]">•</span> : null}
        </span>
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          {(["low", "mid", "high"] as const).map((band) => (
            <Gain
              key={band}
              label={t(`audioFx.${band}`)}
              value={fx[band] ?? 0}
              onChange={(v, live) => update({ [band]: v }, live)}
            />
          ))}
          <Amount
            label={t("audioFx.compress")}
            value={fx.compress ?? 0}
            onChange={(v, live) => update({ compress: v }, live)}
          />
          <Toggle
            label={t("audioFx.limit")}
            checked={fx.limit === true}
            onChange={(limit) => update({ limit })}
          />
          <button
            type="button"
            disabled={!used}
            onClick={() => update({ low: 0, mid: 0, high: 0, compress: 0, limit: false })}
            className="text-[11px] text-[var(--dk-text-muted)] hover:text-[var(--dk-text)] disabled:opacity-40"
          >
            {t("audioFx.eqReset")}
          </button>
        </>
      ) : null}
    </div>
  );
}

function Gain({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number, live: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-1.5 text-[11px]">
      <span className="truncate">{label}</span>
      <input
        type="range"
        min={-EQ_LIMIT}
        max={EQ_LIMIT}
        step={0.5}
        value={value}
        aria-label={label}
        onPointerDown={() => useEditorStore.getState().beginDrag()}
        onPointerUp={() => {
          useEditorStore.getState().endDrag();
          refreshPlayback();
        }}
        onDoubleClick={() => onChange(0, false)}
        {...sliderKeys()}
        onChange={(e) => onChange(Number(e.target.value), true)}
        className="dk-volume w-full"
      />
      <span className="text-right font-mono text-[var(--dk-text-muted)]">
        {value > 0 ? "+" : ""}
        {value} dB
      </span>
    </label>
  );
}

function Amount({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number, live: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[5rem_1fr_2rem] items-center gap-1.5 text-[11px]">
      <span className="truncate">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-label={label}
        onPointerDown={() => useEditorStore.getState().beginDrag()}
        onPointerUp={() => {
          useEditorStore.getState().endDrag();
          refreshPlayback();
        }}
        {...sliderKeys()}
        onChange={(e) => onChange(Number(e.target.value), true)}
        className="dk-volume w-full"
      />
      <span className="text-right font-mono text-[var(--dk-text-muted)]">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span>{label}</span>
      <Switch checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

/** İmleçten 6 sn: önce (olduğu gibi) ve sonra (onarılmış) dinle. */
function BeforeAfter({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "before" | "after">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Aynı dosya yeniden yazılınca tarayıcı önbelleği eskisini çalmasın.
  const playCount = useRef(0);
  useEffect(() => () => audio.current?.pause(), []);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setState("idle");
  };
  const play = async (which: "before" | "after") => {
    stop();
    setError(null);
    const s = useEditorStore.getState();
    const source = s.sources.find((x) => x.id === clip.sourceId) ?? s.sources[0];
    const path = source?.source.path;
    if (!path) return setError(t("audioFx.previewFailed"));
    const t0 = usePlayerStore.getState().currentTime;
    const at = t0 >= clip.start ? clipSourceAt(clip, t0) : clip.srcStart;
    setState("loading");
    try {
      const file = await audioFxPreview(
        path,
        at,
        PREVIEW_SECONDS,
        which === "after" ? (clip.audioFx ?? null) : null,
        null,
      );
      const { url } = await openLocalPreview(file);
      const el = new Audio(`${url}${url.includes("?") ? "&" : "?"}v=${(playCount.current += 1)}`);
      audio.current = el;
      el.onended = () => setState("idle");
      await el.play();
      setState(which);
    } catch {
      setState("idle");
      setError(t("audioFx.previewFailed"));
    }
  };
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5">
        {(["before", "after"] as const).map((which) => (
          <button
            key={which}
            type="button"
            disabled={state === "loading" || (which === "after" && !clip.audioFx)}
            onClick={() => (state === which ? stop() : void play(which))}
            className="flex items-center justify-center gap-1 rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)] disabled:opacity-40"
          >
            {state === which ? <Square size={11} /> : <Headphones size={11} />}
            {t(`audioFx.${which}`)}
          </button>
        ))}
      </div>
      {state === "loading" ? (
        <p className="text-[11px] text-[var(--dk-text-muted)]">{t("audioFx.preparing")}</p>
      ) : null}
      {error ? <p className="text-[11px] text-[var(--dk-warning)]">{error}</p> : null}
    </div>
  );
}
