import type { Storyboard } from "../types/media";

// Klip Düzenleyici zaman çizelgesinin saf hesapları: görünür aralık (yakınlaştırma,
// kaydırma), piksel ↔ saniye, cetvel aralığı, kare şeridi ve dalga formu.

/** Zaman çizelgesinde görünen aralık (saniye). */
export interface TimelineView {
  start: number;
  end: number;
}

/** En fazla bu kadar yakınlaşılır: ekranda en az 2 saniye görünür. */
export const MIN_VIEW_SECONDS = 2;

export function fullView(duration: number): TimelineView {
  return { start: 0, end: Math.max(duration, 0.001) };
}

/** Görünür aralığı [0, süre] içine sığdırır, genişliğini korumaya çalışır. */
export function clampView(view: TimelineView, duration: number): TimelineView {
  const total = Math.max(duration, 0.001);
  const span = Math.min(Math.max(view.end - view.start, Math.min(MIN_VIEW_SECONDS, total)), total);
  const start = Math.min(Math.max(view.start, 0), total - span);
  return { start, end: start + span };
}

/** `factor` < 1 yakınlaştırır. `anchor` (ör. imlecin altındaki an) ekranda yerinde kalır. */
export function zoomView(
  view: TimelineView,
  factor: number,
  anchor: number,
  duration: number,
): TimelineView {
  const total = Math.max(duration, 0.001);
  const span = view.end - view.start;
  // Sınır önce uygulanır ki en yakın/uzak noktada da çapa kaymasın.
  const next = Math.min(Math.max(span * factor, Math.min(MIN_VIEW_SECONDS, total)), total);
  const ratio = span > 0 ? (anchor - view.start) / span : 0.5;
  const start = anchor - next * ratio;
  return clampView({ start, end: start + next }, duration);
}

export function panView(view: TimelineView, deltaSeconds: number, duration: number): TimelineView {
  return clampView({ start: view.start + deltaSeconds, end: view.end + deltaSeconds }, duration);
}

/** Oynatma imleci görünür aralıktan çıkarsa sayfayı çevirir: imleç soldan %10'a gelir. */
export function followPlayhead(view: TimelineView, time: number, duration: number): TimelineView {
  if (time >= view.start && time <= view.end) return view;
  const span = view.end - view.start;
  return clampView({ start: time - span * 0.1, end: time + span * 0.9 }, duration);
}

export function timeToX(time: number, view: TimelineView, width: number): number {
  const span = view.end - view.start;
  return span > 0 ? ((time - view.start) / span) * width : 0;
}

export function xToTime(x: number, view: TimelineView, width: number): number {
  return width > 0 ? view.start + (x / width) * (view.end - view.start) : view.start;
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Cetvel etiketleri arasındaki saniye: etiketler en az `minPx` piksel aralıklı. */
export function tickStep(secondsPerPixel: number, minPx = 90): number {
  return (
    TICK_STEPS.find((step) => step / secondsPerPixel >= minPx) ?? TICK_STEPS[TICK_STEPS.length - 1]
  );
}

/** 83.456 → "1:23.45", 3723.1 → "1:02:03.10". Düzenleyicide salise hassasiyeti. */
export function formatTimecode(seconds: number, fractionDigits: 0 | 1 | 2 = 2): string {
  const scale = 10 ** fractionDigits;
  const total = Math.max(0, Math.round(seconds * scale));
  const whole = Math.floor(total / scale);
  const fraction = total % scale;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const main = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return fractionDigits > 0 ? `${main}.${String(fraction).padStart(fractionDigits, "0")}` : main;
}

/** Cetvel etiketi: adım 1 saniyenin altındaysa ondalık da yazılır. */
export function formatTick(seconds: number, step: number): string {
  return formatTimecode(seconds, step < 1 ? 1 : 0);
}

/** Kare sayfasında `time` anına düşen karenin konumu. */
export function storyboardFrame(
  board: Storyboard,
  time: number,
): { url: string; column: number; row: number } | null {
  const { sheets, rows, columns, interval } = board;
  if (sheets.length === 0 || interval <= 0) return null;
  let sheet = sheets[0];
  for (const candidate of sheets) {
    if (candidate.start <= time) sheet = candidate;
    else break;
  }
  const perSheet = rows * columns;
  // Son sayfa yarım olabilir; olmayan kareye atlanmasın.
  const framesInSheet = Math.min(perSheet, Math.max(1, Math.round(sheet.duration / interval)));
  const index = Math.min(
    framesInSheet - 1,
    Math.max(0, Math.floor((time - sheet.start) / interval)),
  );
  return { url: sheet.url, column: index % columns, row: Math.floor(index / columns) };
}

/** Kare şeridi için eşit aralıklı anlar (her dilimin ortası). */
export function thumbTimes(duration: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n);
}

/** [t0, t1) aralığındaki en yüksek tepe değeri (0..1). */
export function peakInRange(
  peaks: readonly number[],
  duration: number,
  t0: number,
  t1: number,
): number {
  const n = peaks.length;
  if (n === 0 || duration <= 0) return 0;
  const first = Math.max(0, Math.floor((t0 / duration) * n));
  const last = Math.min(n - 1, Math.max(first, Math.ceil((t1 / duration) * n) - 1));
  let peak = 0;
  for (let i = first; i <= last; i += 1) {
    if (peaks[i] > peak) peak = peaks[i];
  }
  return peak;
}
