import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FRAME_SIZES, useEditorStore } from "../../store/editorStore";
import {
  BAND_RANGE,
  DEFAULT_BAND,
  CAM_SHARE_RANGE,
  effectiveSplit,
  GRADIENTS,
  RING_COLORS,
  SPOT_PRESETS,
  SPOT_SIZE_RANGE,
  withShare,
  type SplitLayout,
  type SpotPreset,
} from "../../lib/splitLayout";
import { Switch } from "../ui/Switch";
import { HelpTip } from "../ui/HelpTip";
import { ScanFace } from "lucide-react";
import {
  placePodcastByFaces,
  stopFaceTracking,
  trackFaces,
  useFaceStore,
} from "../../lib/faceActions";
import { localizeError } from "../../lib/errors";
import {
  currentLayout,
  FRAME_LAYOUTS,
  layoutOptions,
  type FrameLayoutId,
} from "../../lib/frameLayouts";

// Dikey düzen galerisi: kırp / siyah bant / bulanık / renk geçişi arka plan ve kamera +
// oyun düzenleri (kamera üstte, altta, iki kamera, daire kamera, köşede kamera). Kartlar
// küçük şemalarla; seçilen düzenin ayarları altında.

const CAM = "#FFD43B";
const GAME = "#4f7bff";

/** Kartın şeması: 27×48'lik dikey kare. */
function Schematic({ id }: { id: FrameLayoutId }) {
  const frame = (
    <rect x="0.5" y="0.5" width="27" height="48" rx="3" fill="#0b0b0f" stroke="#ffffff33" />
  );
  const video = (y: number, h: number) => (
    <rect x="1.5" y={y} width="25" height={h} rx="1" fill={GAME} opacity="0.9" />
  );
  let body: ReactNode;
  switch (id) {
    case "crop":
      body = <rect x="1.5" y="1.5" width="25" height="46" rx="2" fill={GAME} opacity="0.9" />;
      break;
    case "fit":
      body = video(19, 11);
      break;
    case "blur":
      body = (
        <>
          <rect x="1.5" y="1.5" width="25" height="46" rx="2" fill={GAME} opacity="0.35" />
          {video(19, 11)}
        </>
      );
      break;
    case "gradient":
      body = (
        <>
          <defs>
            <linearGradient id="dk-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1e3a8a" />
              <stop offset="1" stopColor="#9333ea" />
            </linearGradient>
          </defs>
          <rect x="1.5" y="1.5" width="25" height="46" rx="2" fill="url(#dk-grad)" />
          {video(19, 11)}
        </>
      );
      break;
    case "stackTop":
    case "stackBottom": {
      const top = id === "stackTop";
      body = (
        <>
          <rect x="1.5" y={top ? 1.5 : 31} width="25" height="16.5" rx="1" fill={CAM} />
          <rect
            x="1.5"
            y={top ? 19 : 1.5}
            width="25"
            height="28.5"
            rx="1"
            fill={GAME}
            opacity="0.9"
          />
        </>
      );
      break;
    }
    case "duo":
      body = (
        <>
          <rect x="1.5" y="1.5" width="12" height="16.5" rx="1" fill={CAM} />
          <rect x="14.5" y="1.5" width="12" height="16.5" rx="1" fill="#ff9f43" />
          <rect x="1.5" y="19" width="25" height="28.5" rx="1" fill={GAME} opacity="0.9" />
        </>
      );
      break;
    case "podcast":
      body = (
        <>
          <rect x="1.5" y="1.5" width="25" height="22.5" rx="1" fill={CAM} />
          <rect x="1.5" y="25" width="25" height="22.5" rx="1" fill="#ff9f43" />
          <circle cx="14" cy="10" r="4" fill="#0b0b0f" opacity="0.55" />
          <circle cx="14" cy="34" r="4" fill="#0b0b0f" opacity="0.55" />
        </>
      );
      break;
    case "circle":
      body = (
        <>
          <rect x="1.5" y="1.5" width="25" height="46" rx="2" fill={GAME} opacity="0.9" />
          <circle cx="14" cy="38" r="6.5" fill={CAM} stroke="#fff" strokeWidth="1" />
        </>
      );
      break;
    case "pip":
      body = (
        <>
          <rect x="1.5" y="1.5" width="25" height="46" rx="2" fill={GAME} opacity="0.9" />
          <rect
            x="15"
            y="4"
            width="10"
            height="7.5"
            rx="1.6"
            fill={CAM}
            stroke="#fff"
            strokeWidth="0.8"
          />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 28 49" className="h-12 w-7" aria-hidden="true">
      {frame}
      {body}
    </svg>
  );
}

/** Daire / köşe kamerasının yeri, boyu ve çerçeve rengi. */
function SpotControls({
  layout,
  onChange,
}: {
  layout: SplitLayout;
  onChange: (l: SplitLayout) => void;
}) {
  const { t } = useTranslation();
  const spot = layout.spot ?? { x: 0.5, y: 0.8, size: 0.42 };
  return (
    <div className="space-y-2" data-spot-controls>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("layouts.spot")}>
        {(Object.keys(SPOT_PRESETS) as SpotPreset[]).map((key) => {
          const p = SPOT_PRESETS[key];
          const on = Math.abs(p.x - spot.x) < 0.02 && Math.abs(p.y - spot.y) < 0.02;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...layout, spot: { ...spot, x: p.x, y: p.y } })}
              className={`rounded-md py-1 text-[11px] ${on ? "bg-[var(--dk-accent)] text-white" : "bg-[var(--dk-bg)] hover:bg-white/10"}`}
            >
              {t(`layouts.spots.${key}`)}
            </button>
          );
        })}
      </div>
      <label className="block text-xs">
        <span className="flex justify-between">
          <span>{t("layouts.camSize")}</span>
          <span className="font-mono text-[var(--dk-text-muted)]">
            %{Math.round(spot.size * 100)}
          </span>
        </span>
        <input
          type="range"
          min={SPOT_SIZE_RANGE.min}
          max={SPOT_SIZE_RANGE.max}
          step={0.01}
          value={spot.size}
          aria-label={t("layouts.camSize")}
          onChange={(e) => onChange({ ...layout, spot: { ...spot, size: Number(e.target.value) } })}
          className="dk-volume w-full"
        />
      </label>
      <div className="flex items-center gap-1.5" role="group" aria-label={t("layouts.ring")}>
        <span className="mr-auto text-xs">{t("layouts.ring")}</span>
        <button
          type="button"
          aria-pressed={layout.ring === null}
          aria-label={t("layouts.ringNone")}
          title={t("layouts.ringNone")}
          onClick={() => onChange({ ...layout, ring: null })}
          className={`h-5 w-5 rounded-full border border-dashed border-white/50 ${layout.ring === null ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
        />
        {RING_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={layout.ring === c}
            aria-label={c}
            onClick={() => onChange({ ...layout, ring: c })}
            className={`h-5 w-5 rounded-full border border-white/30 ${layout.ring === c ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

/** Kamera payı (alt alta ve iki kamera düzenlerinde). */
function ShareControl({
  layout,
  onChange,
}: {
  layout: SplitLayout;
  onChange: (share: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="block text-xs">
      <span className="flex justify-between">
        <span>{t("editor.splitShare")}</span>
        <span className="font-mono text-[var(--dk-text-muted)]">
          %{Math.round(layout.camShare * 100)}
        </span>
      </span>
      <input
        type="range"
        min={CAM_SHARE_RANGE.min}
        max={CAM_SHARE_RANGE.max}
        step={0.01}
        value={layout.camShare}
        aria-label={t("editor.splitShare")}
        onChange={(e) => onChange(Number(e.target.value))}
        className="dk-volume w-full"
      />
    </label>
  );
}

const BAND_COLORS = ["#000000", "#ffffff", "#ffd43b", "#4f7bff", "#e11d48", "#111827"];

/** Kamera ile oyun arasında renkli şerit (logo, başlık için): aç / kapat, renk, kalınlık. */
function BandControls({
  layout,
  onChange,
}: {
  layout: SplitLayout;
  onChange: (next: SplitLayout) => void;
}) {
  const { t } = useTranslation();
  const band = layout.band ?? null;
  return (
    <div className="space-y-1.5" data-band-controls>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">{t("phone.band")}</span>
        <Switch
          checked={!!band}
          label={t("phone.band")}
          onChange={(on) => onChange({ ...layout, band: on ? { ...DEFAULT_BAND } : null })}
        />
      </div>
      {band ? (
        <>
          <div className="flex items-center gap-1" role="group" aria-label={t("phone.bandColor")}>
            {BAND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={band.color === c}
                aria-label={c}
                onClick={() => onChange({ ...layout, band: { ...band, color: c } })}
                className={`h-5 w-5 rounded-full border border-white/30 ${band.color === c ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <input
            type="range"
            min={BAND_RANGE.min}
            max={BAND_RANGE.max}
            step={0.01}
            value={band.share}
            aria-label={t("phone.bandSize")}
            onChange={(e) =>
              onChange({ ...layout, band: { ...band, share: Number(e.target.value) } })
            }
            className="dk-volume w-full"
          />
        </>
      ) : null}
    </div>
  );
}

/** Podcast: pay, kimin üstte olduğu ve yüzlere göre yerleştirme. */
function PodcastControls({
  layout,
  sourceAspect,
  frame: [fw, fh],
}: {
  layout: SplitLayout;
  sourceAspect: number;
  frame: [number, number];
}) {
  const { t } = useTranslation();
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2" data-podcast-controls>
      <ShareControl
        layout={layout}
        onChange={(share) => setOptions({ split: withShare(layout, share, sourceAspect, fw, fh) })}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">{t("layouts.podcastSwap")}</span>
        <Switch
          checked={!layout.camTop}
          label={t("layouts.podcastSwap")}
          onChange={(swap) => setOptions({ split: { ...layout, camTop: !swap } })}
        />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setStatus(null);
          void placePodcastByFaces()
            .then((ok) => setStatus(t(ok ? "layouts.podcastPlaced" : "layouts.podcastNoFaces")))
            .catch((err: unknown) => setStatus(localizeError(err, "face.failed").message))
            .finally(() => setBusy(false));
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--dk-surface)] py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
      >
        <ScanFace size={13} />
        {busy ? t("face.running", { percent: "…" }) : t("layouts.podcastFaces")}
      </button>
      {status ? (
        <p className="text-[11px] text-[var(--dk-text-muted)]" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

/** Yüzü takip et: kırpma kadrajı konuşan yüzü kendiliğinden izler. */
function FaceFollow() {
  const { t } = useTranslation();
  const on = useEditorStore((s) => s.exportOptions.frameTrack !== null);
  const status = useFaceStore((s) => s.status);
  const progress = useFaceStore((s) => s.progress);
  const coverage = useFaceStore((s) => s.coverage);
  const error = useFaceStore((s) => s.error);
  const running = status === "running";
  return (
    <div
      className="space-y-1.5 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-2"
      data-face-follow
    >
      <div className="flex items-center gap-2">
        <ScanFace size={14} className={on ? "text-[#4ade80]" : "text-[var(--dk-text-muted)]"} />
        <span className="flex-1 text-xs">{t("face.title")}</span>
        {on ? (
          <button
            type="button"
            onClick={stopFaceTracking}
            className="rounded-md bg-[var(--dk-surface)] px-2 py-0.5 text-[11px] hover:bg-white/10"
          >
            {t("face.off")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={running}
          onClick={() => void trackFaces()}
          className="rounded-md bg-[var(--dk-accent)] px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {running
            ? t("face.running", { percent: Math.round(progress * 100) })
            : on
              ? t("face.again")
              : t("face.start")}
        </button>
      </div>
      <p className="text-[11px] text-[var(--dk-text-muted)]" data-face-status>
        {status === "done" && coverage !== null
          ? t("face.done", { percent: Math.round(coverage * 100) })
          : status === "none"
            ? t("face.none")
            : status === "error"
              ? localizeError(error, "face.failed").message
              : on
                ? t("face.on")
                : t("face.hint")}
      </p>
    </div>
  );
}

export function FrameLayouts({ sourceAspect }: { sourceAspect: number }) {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  if (options.frame === "original") return null;
  const [fw, fh] = FRAME_SIZES[options.frame];
  const current = currentLayout(options);
  const layout = effectiveSplit(options.split, sourceAspect, fw, fh);
  const setSplit = (split: SplitLayout) => setOptions({ split });

  // Seçili düzenin nasıl ayarlandığı "?" baloncuğunda (ekranda kalıcı yazı yok).
  const hint = t(
    current === "crop"
      ? "editor.frameCropHint"
      : current === "blur"
        ? "editor.frameBlurHint"
        : current === "fit" || current === "gradient"
          ? "editor.frameFitHint"
          : current === "duo"
            ? "layouts.duoHint"
            : current === "podcast"
              ? "layouts.podcastHint"
              : "editor.splitHint",
  );

  return (
    <div className="space-y-2.5" data-frame-layouts>
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-[var(--dk-text-muted)]">{t("layouts.title")}</p>
        <HelpTip title={t(`layouts.name.${current}`)} text={hint} />
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("layouts.title")}>
        {FRAME_LAYOUTS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={current === id}
            data-layout={id}
            onClick={() => setOptions(layoutOptions(id, options, sourceAspect))}
            className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[10px] leading-tight ${
              current === id
                ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-white"
                : "border-[var(--dk-border)] bg-[var(--dk-bg)]/40 text-[var(--dk-text-muted)] hover:text-white"
            }`}
          >
            <Schematic id={id} />
            <span className="text-center">{t(`layouts.name.${id}`)}</span>
          </button>
        ))}
      </div>

      {current === "crop" ? (
        <>
          <FaceFollow />
          <input
            hidden={options.frameTrack !== null}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={options.framePosition}
            aria-label={t("editor.framePosition")}
            onChange={(e) => setOptions({ framePosition: Number(e.target.value) })}
            className="dk-volume w-full"
          />
        </>
      ) : null}
      {current === "gradient" ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("layouts.gradientColors")}
        >
          {GRADIENTS.map(([a, b]) => {
            const on = options.frameGradient?.[0] === a && options.frameGradient?.[1] === b;
            return (
              <button
                key={a + b}
                type="button"
                aria-pressed={on}
                aria-label={`${a} → ${b}`}
                onClick={() => setOptions({ frameGradient: [a, b] })}
                className={`h-7 w-7 rounded-md border border-white/20 ${on ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
                style={{ background: `linear-gradient(${a}, ${b})` }}
              />
            );
          })}
        </div>
      ) : null}
      {current === "podcast" ? (
        <>
          <PodcastControls layout={layout} sourceAspect={sourceAspect} frame={[fw, fh]} />
          <BandControls
            layout={layout}
            onChange={(next) => setSplit(withShare(next, next.camShare, sourceAspect, fw, fh))}
          />
        </>
      ) : null}
      {current === "stackTop" || current === "stackBottom" || current === "duo" ? (
        <div className="space-y-2">
          <ShareControl
            layout={layout}
            onChange={(share) => setSplit(withShare(layout, share, sourceAspect, fw, fh))}
          />
          <BandControls
            layout={layout}
            onChange={(next) => setSplit(withShare(next, next.camShare, sourceAspect, fw, fh))}
          />
          {current === "duo" ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs">{t("editor.splitCamTop")}</span>
              <Switch
                checked={layout.camTop}
                label={t("editor.splitCamTop")}
                onChange={(camTop) => setSplit({ ...layout, camTop })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {current === "circle" || current === "pip" ? (
        <SpotControls
          layout={layout}
          onChange={(next) => setSplit(withShare(next, next.camShare, sourceAspect, fw, fh))}
        />
      ) : null}
      {options.frameSplit ? (
        <>
          <button
            type="button"
            onClick={() =>
              setOptions(layoutOptions(current, { ...options, split: null }, sourceAspect))
            }
            className="text-xs text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("editor.splitReset")}
          </button>
        </>
      ) : null}
    </div>
  );
}
