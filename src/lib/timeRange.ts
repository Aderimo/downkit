export interface TimeRange {
  start: number;
  end: number;
}

/** Bölüm en az bu kadar uzun olmalı (saniye). */
export const MIN_RANGE_SECONDS = 1;

/** "1:05", "01:02:03", "65", "1:05.5" → saniye. Geçersizse null. */
export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(trimmed)) return null;
  const [main, fraction] = trimmed.split(".");
  const parts = main.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return fraction ? seconds + Number(`0.${fraction}`) : seconds;
}

/** 65 → "1:05", 3723 → "1:02:03" (kutucuklarda ve kuyruk satırında gösterim). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Dosya adına eklenen etiket: 65–150 sn → "01.05-02.30". Rust
 * `ffmpeg::trim::range_label` ile aynı; Windows dosya adında ":" olamaz. */
export function rangeLabel(range: TimeRange): string {
  const part = (seconds: number) => {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}.${m}.${s}` : `${m}.${s}`;
  };
  return `${part(range.start)}-${part(range.end)}`;
}

/** Aralığı [0, süre] içinde ve en az `MIN_RANGE_SECONDS` uzunlukta tutar.
 * `moved` hangi ucun değiştiğini söyler; o uç diğerini itmez, onun önünde durur. */
export function clampRange(range: TimeRange, duration: number, moved: "start" | "end"): TimeRange {
  const max = Math.max(duration, MIN_RANGE_SECONDS);
  let start = Math.min(Math.max(range.start, 0), max - MIN_RANGE_SECONDS);
  let end = Math.max(Math.min(range.end, max), MIN_RANGE_SECONDS);
  if (end - start < MIN_RANGE_SECONDS) {
    if (moved === "start") start = end - MIN_RANGE_SECONDS;
    else end = start + MIN_RANGE_SECONDS;
  }
  return { start, end };
}
