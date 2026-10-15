// Hız eğrisi: klip boyunca değişen hız. Eğri, klibin kaynak aralığı boyunca (0 = baş,
// 1 = son) noktalarla çizilir; uygulanınca klip sabit hızlı kısa parçalara bölünür.
// Böylece önizleme, ses ve dışa aktarma mevcut (parça başına tek hız) yolla çalışır.
import { clampSpeed, MAX_SPEED, MIN_SPEED, replaceWithPieces, type SeqClip } from "./sequence";

export interface SpeedPoint {
  /** Klibin kaynak aralığındaki konum (0–1). */
  x: number;
  /** Hız (MIN_SPEED–MAX_SPEED). */
  v: number;
}

export type CurvePresetId = "montage" | "hero" | "bullet" | "jump" | "flashIn" | "flashOut";

export const CURVE_PRESETS: Record<CurvePresetId, SpeedPoint[]> = {
  // Hızlı – yavaş – hızlı – yavaş: kurgu temposu.
  montage: [
    { x: 0, v: 2 },
    { x: 0.25, v: 0.5 },
    { x: 0.5, v: 2 },
    { x: 0.75, v: 0.5 },
    { x: 1, v: 2 },
  ],
  // Hızlı giriş, ortada uzun yavaş çekim, hızlı çıkış.
  hero: [
    { x: 0, v: 2 },
    { x: 0.35, v: 2 },
    { x: 0.45, v: 0.3 },
    { x: 0.6, v: 0.3 },
    { x: 0.7, v: 2 },
    { x: 1, v: 2 },
  ],
  // Normal akış, ortada neredeyse donan an.
  bullet: [
    { x: 0, v: 1 },
    { x: 0.4, v: 1 },
    { x: 0.45, v: 0.25 },
    { x: 0.6, v: 0.25 },
    { x: 0.65, v: 1 },
    { x: 1, v: 1 },
  ],
  // İki kez hızlanıp yavaşlayan "zıplayan" tempo.
  jump: [
    { x: 0, v: 3 },
    { x: 0.2, v: 0.4 },
    { x: 0.4, v: 3 },
    { x: 0.6, v: 0.4 },
    { x: 0.8, v: 3 },
    { x: 1, v: 1 },
  ],
  // Çok hızlı başlayıp normale oturur.
  flashIn: [
    { x: 0, v: 4 },
    { x: 0.3, v: 1 },
    { x: 1, v: 1 },
  ],
  // Normal akış, sonda çok hızlanır.
  flashOut: [
    { x: 0, v: 1 },
    { x: 0.7, v: 1 },
    { x: 1, v: 4 },
  ],
};

export const CURVE_PRESET_IDS = Object.keys(CURVE_PRESETS) as CurvePresetId[];

/** Bir kaynak saniyesi için en kısa parça (daha kısası pürüzsüzlük katmaz, dosyayı büyütür). */
const MIN_PIECE = 0.15;
const DEFAULT_STEPS = 12;

/** Noktaları sıralar, uçları 0 ve 1'e sabitler, hızları sınırlar. En az iki nokta. */
export function normalizeCurve(points: readonly SpeedPoint[]): SpeedPoint[] {
  const sorted = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.v))
    .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), v: clampSpeed(p.v) }))
    .sort((a, b) => a.x - b.x);
  if (sorted.length === 0)
    return [
      { x: 0, v: 1 },
      { x: 1, v: 1 },
    ];
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first.x > 0) sorted.unshift({ x: 0, v: first.v });
  else first.x = 0;
  if (last.x < 1) sorted.push({ x: 1, v: last.v });
  else last.x = 1;
  return sorted;
}

/** Eğrinin `x` konumundaki hızı (noktalar arası doğrusal). */
export function speedAt(points: readonly SpeedPoint[], x: number): number {
  const curve = normalizeCurve(points);
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (x <= b.x) {
      const span = b.x - a.x;
      const k = span > 0 ? (x - a.x) / span : 1;
      return a.v + (b.v - a.v) * k;
    }
  }
  return curve[curve.length - 1]!.v;
}

/** Eğriyi kaynak aralığında parçalara böler: her parça ortasındaki hızı alır, hızı
 * aynı kalan komşu parçalar birleşir. */
export function curvePieces(
  srcStart: number,
  srcEnd: number,
  points: readonly SpeedPoint[],
  steps = DEFAULT_STEPS,
): Pick<SeqClip, "srcStart" | "srcEnd" | "speed">[] {
  const length = srcEnd - srcStart;
  if (length <= 0) return [];
  const n = Math.max(1, Math.min(steps, Math.floor(length / MIN_PIECE)));
  const out: Pick<SeqClip, "srcStart" | "srcEnd" | "speed">[] = [];
  for (let i = 0; i < n; i++) {
    const a = srcStart + (length * i) / n;
    const b = i === n - 1 ? srcEnd : srcStart + (length * (i + 1)) / n;
    const speed = clampSpeed(speedAt(points, (i + 0.5) / n));
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.speed - speed) < 1e-6) prev.srcEnd = b;
    else out.push({ srcStart: a, srcEnd: b, speed });
  }
  return out;
}

/** Klibe eğriyi uygular (klip parçalara bölünür; aynı izdeki sonraki klipler kayar). */
export function applySpeedCurve(
  clips: readonly SeqClip[],
  id: string,
  points: readonly SpeedPoint[],
  makeId: () => string,
  steps = DEFAULT_STEPS,
): SeqClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return [...clips];
  return replaceWithPieces(
    clips,
    clip,
    curvePieces(clip.srcStart, clip.srcEnd, points, steps),
    makeId,
  );
}

/** Eğri uygulanınca klibin zaman çizelgesinde süreceği süre (saniye). */
export function curveDuration(
  srcLength: number,
  points: readonly SpeedPoint[],
  steps = DEFAULT_STEPS,
) {
  return curvePieces(0, srcLength, points, steps).reduce(
    (sum, p) => sum + (p.srcEnd - p.srcStart) / p.speed,
    0,
  );
}

export { MAX_SPEED as CURVE_MAX, MIN_SPEED as CURVE_MIN };
