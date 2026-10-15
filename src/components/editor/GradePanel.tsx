import { sliderKeys } from "../../lib/sliderKeys";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCopy, ClipboardPaste, Pipette, Wand2, X } from "lucide-react";
import {
  DEFAULT_GRADE,
  autoGrade,
  clippedRatio,
  gradeTables,
  neutralizeWheel,
  normalizeGrade,
  parseCurve,
  splineAt,
  type ColorGrade,
  type Wheel,
} from "../../lib/colorGrade";
import {
  applyTables,
  lutAxis,
  pixelAt,
  sampleViewerFrame,
  useLutCache,
} from "../../lib/gradePreview";
import { applyLook, applyLookWith } from "../../lib/editorActions";
import { chooseFile } from "../../lib/tauri-api";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { HelpTip } from "../ui/HelpTip";

const CLIPBOARD_KEY = "downkit.gradeClipboard";

type SetGrade = (patch: Partial<ColorGrade>, live?: boolean) => void;

const begin = () => useEditorStore.getState().beginDrag();
const end = () => {
  useEditorStore.getState().endDrag();
  refreshPlayback();
};

/** Renk düzeltme bölümü: seçili (ya da imleçteki) klibin görünümüne yazar. */
export function GradePanel({
  grade,
  disabled,
}: {
  grade: ColorGrade | undefined;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const current = grade ?? DEFAULT_GRADE;
  const [message, setMessage] = useState<string | null>(null);
  const set: SetGrade = (patch, live = false) => {
    applyLookWith(
      (look) => ({ grade: normalizeGrade({ ...(look.grade ?? DEFAULT_GRADE), ...patch }) }),
      live,
    );
  };
  const copy = () => {
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(current));
      setMessage(t("grade.copied"));
    } catch {
      setMessage(t("grade.copyFailed"));
    }
  };
  const paste = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "null") as unknown;
      if (!raw) return setMessage(t("grade.nothingToPaste"));
      const pasted = normalizeGrade(raw);
      applyLook({ grade: pasted });
      setMessage(t("grade.pasted"));
    } catch {
      setMessage(t("grade.nothingToPaste"));
    }
  };
  const auto = () => {
    const frame = sampleViewerFrame(160);
    if (!frame) return setMessage(t("grade.noFrame"));
    applyLook({ grade: autoGrade(frame.data) });
    setMessage(t("grade.autoDone"));
  };
  return (
    <div className="space-y-3" data-grade-panel>
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        {t("grade.title")}
        <HelpTip title={t("grade.title")} text={t("grade.hint")} />
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={disabled} onClick={auto} className={tool}>
          <Wand2 size={13} />
          {t("grade.auto")}
        </button>
        <Eyedropper
          disabled={disabled}
          onPick={(w) => set({ midtones: w })}
          onFail={() => setMessage(t("grade.noFrame"))}
        />
        <button type="button" disabled={disabled} onClick={copy} className={tool}>
          <ClipboardCopy size={13} />
          {t("grade.copy")}
        </button>
        <button type="button" disabled={disabled} onClick={paste} className={tool}>
          <ClipboardPaste size={13} />
          {t("grade.paste")}
        </button>
      </div>
      {message ? (
        <p role="status" className="text-[11px] text-[var(--dk-text-muted)]">
          {message}
        </p>
      ) : null}
      <GradeSlider
        label={t("grade.exposure")}
        value={current.exposure}
        disabled={disabled}
        onChange={(v, live) => set({ exposure: v }, live)}
      />
      <GradeSlider
        label={t("grade.tint")}
        value={current.tint}
        disabled={disabled}
        onChange={(v, live) => set({ tint: v }, live)}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {(["shadows", "midtones", "highlights"] as const).map((key) => (
          <ColorWheel
            key={key}
            label={t(`grade.${key}`)}
            value={current[key]}
            disabled={disabled}
            onChange={(w, live) => set({ [key]: w }, live)}
          />
        ))}
      </div>
      <div className="space-y-1">
        <GradeSlider
          label={t("grade.lift")}
          value={current.lift}
          disabled={disabled}
          onChange={(v, live) => set({ lift: v }, live)}
        />
        <GradeSlider
          label={t("grade.gamma")}
          value={current.gamma}
          disabled={disabled}
          onChange={(v, live) => set({ gamma: v }, live)}
        />
        <GradeSlider
          label={t("grade.gain")}
          value={current.gain}
          disabled={disabled}
          onChange={(v, live) => set({ gain: v }, live)}
        />
      </div>
      <CurveEditor
        curve={current.curve}
        disabled={disabled}
        onChange={(curve, live) => set({ curve }, live)}
      />
      <LutRow grade={current} disabled={disabled} set={set} />
      <Scopes grade={grade} />
    </div>
  );
}

const tool =
  "flex items-center justify-center gap-1 rounded-lg border border-[var(--dk-border)] px-2 py-1.5 text-[11px] hover:border-[var(--dk-accent)] disabled:opacity-40";

function GradeSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number, live: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-1.5 text-[11px]">
      <span className="truncate">{label}</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.02}
        value={value}
        disabled={disabled}
        aria-label={label}
        onPointerDown={begin}
        onPointerUp={end}
        {...sliderKeys()}
        onDoubleClick={() => onChange(0, false)}
        onChange={(e) => onChange(Number(e.target.value), true)}
        className="dk-volume w-full"
      />
      <span className="text-right font-mono text-[var(--dk-text-muted)]">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

/** Renk tekerleği: noktayı sürükle (ton ve şiddet), çift tıkla sıfırla. */
function ColorWheel({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: Wheel;
  disabled: boolean;
  onChange: (w: Wheel, live: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pick = (e: { clientX: number; clientY: number }) => {
    const box = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 2 - 1;
    const y = -(((e.clientY - box.top) / box.height) * 2 - 1);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  };
  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    begin();
    onChange(pick(e), true);
    const move = (ev: PointerEvent) => onChange(pick(ev), true);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="space-y-0.5 text-center">
      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuetext={`${Math.round(Math.hypot(value.x, value.y) * 100)}`}
        data-wheel={label}
        onPointerDown={down}
        onDoubleClick={() => onChange({ x: 0, y: 0 }, false)}
        className={`relative mx-auto aspect-square w-full max-w-[72px] touch-none rounded-full border border-[var(--dk-border)] ${disabled ? "opacity-40" : "cursor-crosshair"}`}
        style={{
          background:
            "radial-gradient(circle, rgb(128 128 128) 0%, transparent 70%), conic-gradient(from 90deg, #f33, #f3f, #33f, #3ff, #3f3, #ff3, #f33)",
        }}
      >
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60"
          style={{ left: `${(value.x + 1) * 50}%`, top: `${(1 - value.y) * 50}%` }}
        />
      </div>
      <span className="block truncate text-[10px] text-[var(--dk-text-muted)]">{label}</span>
    </div>
  );
}

const CW = 200;
const CH = 120;
const CP = 6;

/** Ana eğri: noktaları sürükle, çift tıklayınca ekle, noktaya çift tıklayınca sil. */
function CurveEditor({
  curve,
  disabled,
  onChange,
}: {
  curve: [number, number][] | undefined;
  disabled: boolean;
  onChange: (curve: [number, number][] | undefined, live: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<SVGSVGElement>(null);
  const points: [number, number][] = curve ?? [
    [0, 0],
    [1, 1],
  ];
  const toX = (x: number) => CP + x * (CW - 2 * CP);
  const toY = (y: number) => CH - CP - y * (CH - 2 * CP);
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = ref.current!.getBoundingClientRect();
    const x = (((e.clientX - box.left) / box.width) * CW - CP) / (CW - 2 * CP);
    const y = (CH - CP - ((e.clientY - box.top) / box.height) * CH) / (CH - 2 * CP);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const drag = (index: number) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    begin();
    const move = (ev: PointerEvent) => {
      const [x, y] = local(ev);
      const edge = index === 0 || index === points.length - 1;
      const lo = edge ? points[index]![0] : points[index - 1]![0] + 0.02;
      const hi = edge ? points[index]![0] : points[index + 1]![0] - 0.02;
      const next = points.map((p, i) => (i === index ? [Math.min(hi, Math.max(lo, x)), y] : p)) as [
        number,
        number,
      ][];
      onChange(parseCurve(next), true);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const path = Array.from({ length: 41 }, (_, i) => {
    const x = i / 40;
    return `${i ? "L" : "M"}${toX(x).toFixed(1)},${toY(splineAt(points, x)).toFixed(1)}`;
  }).join(" ");
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span>{t("grade.curve")}</span>
        {curve ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(undefined, false)}
            className="text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
          >
            {t("grade.reset")}
          </button>
        ) : null}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${CW} ${CH}`}
        data-grade-curve
        className={`w-full touch-none rounded-lg bg-[var(--dk-bg)] ${disabled ? "opacity-40" : ""}`}
        onDoubleClick={(e) => {
          if (disabled) return;
          onChange(parseCurve([...points, local(e)]), false);
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="currentColor" strokeOpacity={0.12}>
            <line x1={toX(g)} x2={toX(g)} y1={toY(0)} y2={toY(1)} />
            <line x1={toX(0)} x2={toX(1)} y1={toY(g)} y2={toY(g)} />
          </g>
        ))}
        <line
          x1={toX(0)}
          y1={toY(0)}
          x2={toX(1)}
          y2={toY(1)}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 3"
        />
        <path d={path} fill="none" stroke="#fff" strokeWidth={1.6} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={toX(x)}
            cy={toY(y)}
            r={4.5}
            fill="var(--dk-surface)"
            stroke="#fff"
            strokeWidth={1.6}
            onPointerDown={drag(i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (disabled || i === 0 || i === points.length - 1) return;
              onChange(parseCurve(points.filter((_, j) => j !== i)), false);
            }}
          />
        ))}
      </svg>
    </div>
  );
}

function LutRow({ grade, disabled, set }: { grade: ColorGrade; disabled: boolean; set: SetGrade }) {
  const { t } = useTranslation();
  const axis = useLutCache((s) => (grade.lut ? s.axes[grade.lut.path] : undefined));
  const choose = async () => {
    const path = await chooseFile(t("grade.lutFiles"), ["cube"]);
    if (!path) return;
    const name = path.split(/[\\/]/).pop() ?? path;
    lutAxis(path);
    set({ lut: { path, name } });
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="shrink-0">LUT</span>
        {grade.lut ? (
          <>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[var(--dk-text-muted)]"
              title={grade.lut.path}
            >
              {grade.lut.name}
            </span>
            <button
              type="button"
              disabled={disabled}
              aria-label={t("grade.lutRemove")}
              onClick={() => set({ lut: undefined })}
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void choose()}
            className={`${tool} flex-1`}
          >
            {t("grade.lutChoose")}
          </button>
        )}
      </div>
      {grade.lut && axis === null ? (
        <p className="text-[11px] text-[var(--dk-warning)]">{t("grade.lutBad")}</p>
      ) : null}
    </div>
  );
}

/** Damlalık: videoda gri olması gereken bir yere tıkla → orta tonlar nötrlenir. */
function Eyedropper({
  disabled,
  onPick,
  onFail,
}: {
  disabled: boolean;
  onPick: (w: Wheel) => void;
  onFail: () => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const pickRef = useRef(onPick);
  const failRef = useRef(onFail);
  useEffect(() => {
    pickRef.current = onPick;
    failRef.current = onFail;
  });
  useEffect(() => {
    if (!active) return;
    const host = document.querySelector<HTMLElement>("[data-main-viewer]");
    const video = host?.querySelector("video");
    if (!host || !video) return;
    host.style.cursor = "crosshair";
    const click = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setActive(false);
      // Videonun ekrandaki gerçek alanı (siyah bantlar hariç).
      const box = video.getBoundingClientRect();
      const ratio = video.videoWidth / Math.max(1, video.videoHeight);
      const w = Math.min(box.width, box.height * ratio);
      const h = w / ratio;
      const x = (e.clientX - (box.left + (box.width - w) / 2)) / w;
      const y = (e.clientY - (box.top + (box.height - h) / 2)) / h;
      const frame = sampleViewerFrame(320);
      if (!frame || x < 0 || x > 1 || y < 0 || y > 1) return failRef.current();
      pickRef.current(neutralizeWheel(pixelAt(frame, x, y)));
    };
    host.addEventListener("click", click, { capture: true, once: true });
    return () => {
      host.style.cursor = "";
      host.removeEventListener("click", click, { capture: true });
    };
  }, [active]);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      title={t("grade.pickHint")}
      onClick={() => {
        if (!active && !document.querySelector("[data-main-viewer] video")) return onFail();
        setActive((a) => !a);
      }}
      className={`${tool} ${active ? "border-[var(--dk-accent)] bg-[var(--dk-accent)] text-white" : ""}`}
    >
      <Pipette size={13} />
      {t("grade.pick")}
    </button>
  );
}

type ScopeKind = "histogram" | "waveform" | "vectorscope";

/** Kapsamlar: imleçteki karenin (düzeltilmiş hâli) histogramı, dalga formu, vektörskop. */
function Scopes({ grade }: { grade: ColorGrade | undefined }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ScopeKind>("histogram");
  const [clipped, setClipped] = useState(0);
  const [empty, setEmpty] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = usePlayerStore((s) => s.currentTime);
  const lutPath = grade?.lut?.path;
  const axis = useLutCache((s) => (lutPath ? s.axes[lutPath] : undefined));
  useEffect(() => {
    const id = window.setTimeout(() => {
      const frame = sampleViewerFrame(160);
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !canvas.current) return;
      const W = canvas.current.width;
      const H = canvas.current.height;
      ctx.fillStyle = "#0b0d12";
      ctx.fillRect(0, 0, W, H);
      if (!frame) {
        setEmpty(true);
        return;
      }
      setEmpty(false);
      const px = applyTables(frame, gradeTables(grade, axis ?? null));
      setClipped(clippedRatio(px));
      drawScope(ctx, kind, px, frame.width, frame.height, W, H);
    }, 120);
    return () => window.clearTimeout(id);
  }, [kind, grade, axis, time]);
  return (
    <div className="space-y-1" data-scopes>
      <div className="flex gap-1" role="tablist">
        {(["histogram", "waveform", "vectorscope"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              kind === k
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] text-[var(--dk-text-muted)]"
            }`}
          >
            {t(`grade.scopes.${k}`)}
          </button>
        ))}
      </div>
      <canvas
        ref={canvas}
        width={240}
        height={120}
        className="w-full rounded-lg"
        aria-label={t(`grade.scopes.${kind}`)}
      />
      {empty ? (
        <p className="text-[11px] text-[var(--dk-text-muted)]">{t("grade.noFrame")}</p>
      ) : clipped > 0.02 ? (
        <p role="status" className="text-[11px] text-[var(--dk-warning)]" data-clip-warning>
          {t("grade.clipped", { percent: Math.round(clipped * 100) })}
        </p>
      ) : null}
    </div>
  );
}

function drawScope(
  ctx: CanvasRenderingContext2D,
  kind: ScopeKind,
  px: Uint8ClampedArray,
  fw: number,
  fh: number,
  W: number,
  H: number,
) {
  if (kind === "histogram") {
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < px.length; i += 4) {
      bins[0]![px[i]!]!++;
      bins[1]![px[i + 1]!]!++;
      bins[2]![px[i + 2]!]!++;
    }
    const max = Math.max(1, ...bins.flatMap((b) => Array.from(b.subarray(2, 254))));
    ctx.globalCompositeOperation = "lighter";
    ["rgba(255,70,70,0.75)", "rgba(70,255,110,0.75)", "rgba(80,140,255,0.75)"].forEach(
      (color, c) => {
        ctx.fillStyle = color;
        for (let v = 0; v < 256; v++) {
          const h = Math.min(H, (bins[c]![v]! / max) * H);
          ctx.fillRect((v / 256) * W, H - h, W / 256 + 0.5, h);
        }
      },
    );
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  if (kind === "waveform") {
    // Sütun başına parlaklık dağılımı (soldan sağa görüntünün kendisi).
    ctx.fillStyle = "rgba(140,255,160,0.18)";
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const i = (y * fw + x) * 4;
        const l = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
        ctx.fillRect((x / fw) * W, H - (l / 255) * H, 1.5, 1.5);
      }
    }
    return;
  }
  // Vektörskop: renk tonu açı, doygunluk uzaklık (YUV düzlemi).
  const cx = W / 2;
  const cy = H / 2;
  const r = H / 2 - 4;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < px.length; i += 4) {
    const R = px[i]! / 255;
    const G = px[i + 1]! / 255;
    const B = px[i + 2]! / 255;
    const u = -0.1146 * R - 0.3854 * G + 0.5 * B;
    const v = 0.5 * R - 0.4542 * G - 0.0458 * B;
    ctx.fillRect(cx + u * 2 * r, cy - v * 2 * r, 1.2, 1.2);
  }
}
