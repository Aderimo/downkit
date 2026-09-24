import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clampRange, formatClock, parseClock, type TimeRange } from "../lib/timeRange";

interface TimeRangeEditorProps {
  duration: number;
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  /** Süre satırının yanına eklenecek bilgi (ör. tahmini boyut). */
  extra?: ReactNode;
  /** Kutuların sağına eklenecek düğmeler (ör. "Önizlemede seç"). */
  actions?: ReactNode;
}

/** Bir videonun başlangıç–bitiş aralığını seçtirir: sürüklenen iki tutamaç ve
 * elle yazılabilen zaman kutuları ("1:05", "1:02:03"). */
export function TimeRangeEditor({
  duration,
  value,
  onChange,
  extra,
  actions,
}: TimeRangeEditorProps) {
  const { t } = useTranslation();
  const step = duration > 600 ? 1 : 0.5;
  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;

  function set(next: TimeRange, moved: "start" | "end") {
    onChange(clampRange(next, duration, moved));
  }

  return (
    <div className="space-y-3">
      <div className="dk-range relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--dk-surface-2)]" />
        <div
          className="dk-gradient absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{ left: pct(value.start), width: pct(value.end - value.start) }}
        />
        <input
          type="range"
          min={0}
          max={duration}
          step={step}
          value={value.start}
          aria-label={t("section.start")}
          onChange={(e) => set({ ...value, start: Number(e.target.value) }, "start")}
        />
        <input
          type="range"
          min={0}
          max={duration}
          step={step}
          value={value.end}
          aria-label={t("section.end")}
          onChange={(e) => set({ ...value, end: Number(e.target.value) }, "end")}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-[var(--dk-text-muted)]">
        <span>0:00</span>
        <span>{formatClock(duration)}</span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <TimeField
          key={`s-${value.start}`}
          label={t("section.start")}
          seconds={value.start}
          onCommit={(start) => set({ ...value, start }, "start")}
        />
        <TimeField
          key={`e-${value.end}`}
          label={t("section.end")}
          seconds={value.end}
          onCommit={(end) => set({ ...value, end }, "end")}
        />
        <div className="pb-2 text-sm text-[var(--dk-text)]">
          {t("section.length", { length: formatClock(value.end - value.start) })}
          {extra ? (
            <span className="text-[var(--dk-text-muted)]">
              {"  ·  "}
              {extra}
            </span>
          ) : null}
        </div>
        {actions ? <div className="ml-auto flex gap-2 pb-0.5">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Elle zaman girişi. Geçersiz yazılırsa odaktan çıkınca eski değere döner;
 * dışarıdan değer değişince `key` ile yeniden kurulur. */
function TimeField({
  label,
  seconds,
  onCommit,
}: {
  label: string;
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState(formatClock(seconds));
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const parsed = parseClock(draft);
    if (parsed === null) {
      setInvalid(true);
      setDraft(formatClock(seconds));
      return;
    }
    setInvalid(false);
    if (parsed !== seconds) onCommit(parsed);
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--dk-text-muted)]">{label}</span>
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        inputMode="numeric"
        className={`h-9 w-24 rounded-lg border bg-[var(--dk-surface-2)] px-2.5 text-sm tabular-nums text-white outline-none focus:border-[var(--dk-accent)] ${
          invalid ? "border-[var(--dk-error)]" : "border-[var(--dk-border)]"
        }`}
      />
    </label>
  );
}
