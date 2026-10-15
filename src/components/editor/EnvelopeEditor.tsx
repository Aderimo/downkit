import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { envelopeAt, parseEnvelope, type MusicItem } from "../../lib/layers";
import { updateMusic } from "../../lib/layerActions";
import { useEditorStore } from "../../store/editorStore";
import { HelpTip } from "../ui/HelpTip";

const W = 240;
const H = 64;
const P = 5;
const MAX = 2;

/** Müziğin ses zarfı: düzey çizgisi, noktalar sürüklenir, çift tıkla ekle/sil. */
export function EnvelopeEditor({ item }: { item: MusicItem }) {
  const { t } = useTranslation();
  const ref = useRef<SVGSVGElement>(null);
  const len = Math.max(0.1, item.length);
  const points: [number, number][] = item.envelope ?? [
    [0, 1],
    [len, 1],
  ];
  const toX = (s: number) => P + (s / len) * (W - 2 * P);
  const toY = (v: number) => H - P - (v / MAX) * (H - 2 * P);
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = ref.current!.getBoundingClientRect();
    const s = ((((e.clientX - box.left) / box.width) * W - P) / (W - 2 * P)) * len;
    const v = ((H - P - ((e.clientY - box.top) / box.height) * H) / (H - 2 * P)) * MAX;
    return [Math.min(len, Math.max(0, s)), Math.min(MAX, Math.max(0, v))];
  };
  const write = (next: [number, number][], live: boolean) =>
    updateMusic(item.id, { envelope: parseEnvelope(next) }, live);
  const drag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    useEditorStore.getState().beginDrag();
    const move = (ev: PointerEvent) => {
      const [s, v] = local(ev);
      const lo = index === 0 ? 0 : points[index - 1]![0] + 0.05;
      const hi = index === points.length - 1 ? len : points[index + 1]![0] - 0.05;
      write(
        points.map((p, i) => (i === index ? [Math.min(hi, Math.max(lo, s)), v] : p)) as [
          number,
          number,
        ][],
        true,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditorStore.getState().endDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const preset = (kind: "duck" | "swell" | "flat") => {
    if (kind === "flat") return write([], false);
    if (kind === "duck") {
      return write(
        [
          [0, 1],
          [Math.min(1, len * 0.15), 0.3],
          [Math.max(len - 1, len * 0.85), 0.3],
          [len, 1],
        ],
        false,
      );
    }
    write(
      [
        [0, 0],
        [Math.min(2, len * 0.25), 1],
        [Math.max(len - 2, len * 0.75), 1],
        [len, 0],
      ],
      false,
    );
  };
  const path = points.map(([s, v], i) => `${i ? "L" : "M"}${toX(s)},${toY(v)}`).join(" ");
  return (
    <div className="space-y-1" data-envelope>
      <div className="flex items-center gap-1 text-[11px]">
        <span>{t("envelope.title")}</span>
        <HelpTip title={t("envelope.title")} text={t("envelope.hint")} />
        <span className="ml-auto flex gap-1">
          {(["duck", "swell", "flat"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => preset(k)}
              className="rounded bg-[var(--dk-bg)] px-1.5 py-0.5 text-[10px] hover:bg-white/10"
            >
              {t(
                k === "duck"
                  ? "envelope.duckMiddle"
                  : k === "swell"
                    ? "envelope.swell"
                    : "envelope.reset",
              )}
            </button>
          ))}
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-lg bg-[var(--dk-bg)]"
        onDoubleClick={(e) => {
          const [s] = local(e);
          write([...points, [s, envelopeAt(points, s)]], false);
        }}
      >
        <line
          x1={P}
          x2={W - P}
          y1={toY(1)}
          y2={toY(1)}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 3"
        />
        <path
          d={`${path} L${toX(len)},${toY(0)} L${toX(0)},${toY(0)} Z`}
          fill="#34d399"
          fillOpacity={0.15}
        />
        <path d={path} fill="none" stroke="#34d399" strokeWidth={1.8} />
        {points.map(([s, v], i) => (
          <circle
            key={i}
            data-envelope-point={i}
            cx={toX(s)}
            cy={toY(v)}
            r={4.5}
            fill="var(--dk-surface)"
            stroke="#34d399"
            strokeWidth={1.8}
            className="cursor-ns-resize"
            onPointerDown={drag(i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (points.length > 2)
                write(
                  points.filter((_, j) => j !== i),
                  false,
                );
            }}
          >
            <title>{`${Math.round(v * 100)}%`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
