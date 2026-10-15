import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wind } from "lucide-react";
import { HelpTip } from "../ui/HelpTip";
import { Switch } from "../ui/Switch";
import { applyClipSpeedCurve, setClipMotionBlur } from "../../lib/editorActions";
import { clipLength, type SeqClip } from "../../lib/sequence";
import {
  CURVE_MAX,
  CURVE_MIN,
  CURVE_PRESET_IDS,
  CURVE_PRESETS,
  curveDuration,
  normalizeCurve,
  type CurvePresetId,
  type SpeedPoint,
} from "../../lib/speedCurve";

const W = 240;
const H = 96;
const PAD = 8;
// Dikey eksen logaritmik: 1× ortada, 0,25× altta, 4× üstte.
const LOG_MIN = Math.log2(CURVE_MIN);
const LOG_MAX = Math.log2(CURVE_MAX);
const toX = (x: number) => PAD + x * (W - 2 * PAD);
const toY = (v: number) =>
  PAD + (1 - (Math.log2(v) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (H - 2 * PAD);
const fromY = (y: number) => 2 ** (LOG_MIN + (1 - (y - PAD) / (H - 2 * PAD)) * (LOG_MAX - LOG_MIN));
const fromX = (x: number) => (x - PAD) / (W - 2 * PAD);

/** Klip boyunca hız eğrisi: hazır eğriler, noktaları sürükleyerek düzenleme, uygula. */
export function SpeedCurveEditor({ clip }: { clip: SeqClip }) {
  const { t, i18n } = useTranslation();
  const [points, setPoints] = useState<SpeedPoint[]>(CURVE_PRESETS.bullet);
  const [preset, setPreset] = useState<CurvePresetId | null>("bullet");
  const svgRef = useRef<SVGSVGElement>(null);
  const curve = normalizeCurve(points);
  const srcLength = clip.srcEnd - clip.srcStart;
  const after = curveDuration(srcLength, curve);
  const seconds = (v: number) =>
    t("speedCurve.seconds", {
      value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(v),
    });

  const local = (e: { clientX: number; clientY: number }) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * W,
      y: ((e.clientY - box.top) / box.height) * H,
    };
  };

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      setPreset(null);
      setPoints((prev) => {
        const sorted = normalizeCurve(prev);
        const edge = index === 0 || index === sorted.length - 1;
        const lo = edge ? sorted[index]!.x : sorted[index - 1]!.x + 0.02;
        const hi = edge ? sorted[index]!.x : sorted[index + 1]!.x - 0.02;
        const v = Math.min(CURVE_MAX, Math.max(CURVE_MIN, fromY(p.y)));
        return sorted.map((pt, i) =>
          i === index
            ? { x: Math.min(hi, Math.max(lo, fromX(p.x))), v: Math.round(v * 100) / 100 }
            : pt,
        );
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addPoint = (e: React.MouseEvent) => {
    const p = local(e);
    const x = fromX(p.x);
    if (x <= 0.02 || x >= 0.98) return;
    setPreset(null);
    setPoints((prev) => normalizeCurve([...prev, { x, v: fromY(p.y) }]));
  };

  const removePoint = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0 || index === curve.length - 1) return;
    setPreset(null);
    setPoints(curve.filter((_, i) => i !== index));
  };

  const path = curve.map((p, i) => `${i ? "L" : "M"}${toX(p.x)},${toY(p.v)}`).join(" ");

  return (
    <div className="space-y-2" data-testid="speed-curve">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        {t("speedCurve.title")}
        <HelpTip title={t("speedCurve.title")} text={t("speedCurve.hint")} />
      </p>
      <div className="flex flex-wrap gap-1">
        {CURVE_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-curve={id}
            onClick={() => {
              setPoints(CURVE_PRESETS[id]);
              setPreset(id);
            }}
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              preset === id
                ? "border-[var(--dk-accent)] bg-[var(--dk-accent)] text-white"
                : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
            }`}
          >
            {t(`speedCurve.presets.${id}`)}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-lg bg-[var(--dk-bg)]"
        role="img"
        aria-label={t("speedCurve.title")}
        onDoubleClick={addPoint}
      >
        {[CURVE_MIN, 0.5, 1, 2, CURVE_MAX].map((v) => (
          <g key={v}>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={toY(v)}
              y2={toY(v)}
              stroke="currentColor"
              strokeOpacity={v === 1 ? 0.35 : 0.12}
              strokeDasharray={v === 1 ? undefined : "2 3"}
            />
            <text
              x={W - PAD - 1}
              y={toY(v) - 2}
              textAnchor="end"
              fontSize={7}
              fill="currentColor"
              opacity={0.5}
            >
              {v}×
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--dk-accent)" strokeWidth={2} />
        {curve.map((p, i) => (
          <circle
            key={i}
            data-point={i}
            cx={toX(p.x)}
            cy={toY(p.v)}
            r={5}
            fill="var(--dk-surface)"
            stroke="var(--dk-accent)"
            strokeWidth={2}
            className="cursor-ns-resize"
            onPointerDown={startDrag(i)}
            onDoubleClick={removePoint(i)}
          >
            <title>{`${p.v}×`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--dk-text-muted)]">
        <span data-testid="curve-duration">
          {seconds(clipLength(clip))} → {seconds(after)}
        </span>
        <button
          type="button"
          data-testid="apply-curve"
          onClick={() => applyClipSpeedCurve(clip.id, curve)}
          className="rounded-lg bg-[var(--dk-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--dk-accent-hover)]"
        >
          {t("speedCurve.apply")}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--dk-bg)]/60 px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Wind size={13} className="shrink-0 text-[var(--dk-accent-hover)]" />
          <span className="truncate">{t("speedCurve.motionBlur")}</span>
          <HelpTip title={t("speedCurve.motionBlur")} text={t("speedCurve.motionBlurHint")} />
        </p>
        <Switch
          checked={clip.motionBlur === true}
          label={t("speedCurve.motionBlur")}
          onChange={(on) => setClipMotionBlur(clip.id, on)}
        />
      </div>
    </div>
  );
}
