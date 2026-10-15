// Renk düzeltme: pozlama, ton (yeşil–macenta), gölge/orta/parlak renk tekerlekleri,
// seviyeler (lift/gamma/gain), ana eğri ve isteğe bağlı LUT (.cube). Dışa aktarmada
// FFmpeg filtrelerine (Rust `ffmpeg::edit::Grade`) çevrilir: exposure → curves →
// colorbalance → lut3d. Önizlemede aynı zincir kanal başına 256 değerlik tabloya
// dönüştürülür (SVG feComponentTransfer); kapsamlar ve damlalık da bu tabloyu kullanır.
// Renk tekerleği gri piksel varsayımıyla hesaplanır: önizleme dışa aktarmaya yakındır.
// Saf fonksiyonlar.

/** Tekerlekteki nokta: birim dairede (x sağa kırmızı, açı ton). */
export interface Wheel {
  x: number;
  y: number;
}

export interface ColorGrade {
  /** −1…1 → ±2 durak. */
  exposure: number;
  /** −1 yeşil … 1 macenta. */
  tint: number;
  shadows: Wheel;
  midtones: Wheel;
  highlights: Wheel;
  /** −1…1: koyuları kaldır / ortaları aç / parlakları yükselt. */
  lift: number;
  gamma: number;
  gain: number;
  /** Ana eğri noktaları (0–1, x artan); yoksa düz. */
  curve?: [number, number][];
  /** 3B renk tablosu (.cube). */
  lut?: { path: string; name: string };
}

export const ZERO_WHEEL: Wheel = { x: 0, y: 0 };
export const DEFAULT_GRADE: ColorGrade = {
  exposure: 0,
  tint: 0,
  shadows: ZERO_WHEEL,
  midtones: ZERO_WHEEL,
  highlights: ZERO_WHEEL,
  lift: 0,
  gamma: 0,
  gain: 0,
};

/** Tekerleğin en fazla renk kaydırması (colorbalance birimi). */
export const WHEEL_SCALE = 0.3;
/** Seviyelerin en fazla kayması (eğri birimi). */
export const LEVEL_SCALE = 0.15;
/** Tonun en fazla yeşil/macenta kaydırması. */
export const TINT_SCALE = 0.15;

const num = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

function wheel(raw: unknown): Wheel {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Yön korunarak birim daireye: önce uzunluk, sonra (sayı değilse) sıfır.
  let x = typeof r.x === "number" && Number.isFinite(r.x) ? r.x : 0;
  let y = typeof r.y === "number" && Number.isFinite(r.y) ? r.y : 0;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

const isZeroWheel = (w: Wheel) => Math.abs(w.x) < 1e-3 && Math.abs(w.y) < 1e-3;

/** Geçerli düzeltme; hiçbir şey değişmiyorsa undefined. */
export function normalizeGrade(raw: unknown): ColorGrade | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const g: ColorGrade = {
    exposure: num(r.exposure, -1, 1),
    tint: num(r.tint, -1, 1),
    shadows: wheel(r.shadows),
    midtones: wheel(r.midtones),
    highlights: wheel(r.highlights),
    lift: num(r.lift, -1, 1),
    gamma: num(r.gamma, -1, 1),
    gain: num(r.gain, -1, 1),
  };
  const curve = parseCurve(r.curve);
  if (curve) g.curve = curve;
  const lut = r.lut as Record<string, unknown> | undefined;
  if (lut && typeof lut.path === "string" && /\.cube$/i.test(lut.path)) {
    g.lut = { path: lut.path, name: typeof lut.name === "string" ? lut.name : lut.path };
  }
  return isDefaultGrade(g) ? undefined : g;
}

export function isDefaultGrade(g: ColorGrade | undefined): boolean {
  if (!g) return true;
  return (
    Math.abs(g.exposure) < 1e-3 &&
    Math.abs(g.tint) < 1e-3 &&
    isZeroWheel(g.shadows) &&
    isZeroWheel(g.midtones) &&
    isZeroWheel(g.highlights) &&
    Math.abs(g.lift) < 1e-3 &&
    Math.abs(g.gamma) < 1e-3 &&
    Math.abs(g.gain) < 1e-3 &&
    !g.curve &&
    !g.lut
  );
}

/** Eğri noktaları: 0–1, x artan, uçlar dahil; düz eğri (y = x) undefined. */
export function parseCurve(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pts = raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2)
    .map(([x, y]) => [num(x, 0, 1), num(y, 0, 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1]![0] > 0.01) out.push(p);
  if (out.length < 2) return undefined;
  if (out.every(([x, y]) => Math.abs(x - y) < 1e-3)) return undefined;
  return out.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/** Tekerlek → kırmızı/yeşil/mavi kaydırması (toplamı 0; 120° aralıkla). */
export function wheelRgb(w: Wheel): [number, number, number] {
  const s = Math.sqrt(3) / 2;
  return [w.x, -w.x / 2 + s * w.y, -w.x / 2 - s * w.y].map((v) => v * WHEEL_SCALE) as [
    number,
    number,
    number,
  ];
}

/** Kaydırmanın tersi: toplamı 0'a çekilmiş RGB farkından tekerlek noktası. */
export function rgbWheel(offset: [number, number, number]): Wheel {
  const mean = (offset[0] + offset[1] + offset[2]) / 3;
  const [r, g, b] = offset.map((v) => (v - mean) / WHEEL_SCALE) as [number, number, number];
  return wheel({ x: r, y: (g - b) / Math.sqrt(3) });
}

/** Seviyeler eğrisi: artı lift siyahı kaldırır, eksi lift koyuları siyaha çeker; artı
 * gain parlakları beyaza çeker, eksi gain beyazı indirir (Rust `level_points` ile aynı). */
export function levelPoints(g: Pick<ColorGrade, "lift" | "gamma" | "gain">): [number, number][] {
  const s = LEVEL_SCALE;
  return [
    g.lift >= 0 ? [0, s * g.lift] : [-s * g.lift, 0],
    [0.5, 0.5 + s * g.gamma],
    g.gain >= 0 ? [1 - s * g.gain, 1] : [1, 1 + s * g.gain],
  ];
}

/** Doğal kübik eğri (FFmpeg `curves` ile aynı yöntem); `x` için değer. */
export function splineAt(points: readonly [number, number][], x: number): number {
  const n = points.length;
  if (n === 0) return x;
  if (n === 1) return points[0]![1];
  if (x <= points[0]![0]) return points[0]![1];
  if (x >= points[n - 1]![0]) return points[n - 1]![1];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const h = xs.slice(1).map((v, i) => v - xs[i]!);
  // İkinci türevler (uçlarda 0).
  const m = new Array<number>(n).fill(0);
  if (n > 2) {
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(0);
    const c = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1]!;
      b[i] = 2 * (h[i - 1]! + h[i]!);
      c[i] = h[i]!;
      d[i] = 6 * ((ys[i + 1]! - ys[i]!) / h[i]! - (ys[i]! - ys[i - 1]!) / h[i - 1]!);
    }
    for (let i = 2; i < n - 1; i++) {
      const w = a[i]! / b[i - 1]!;
      b[i] = b[i]! - w * c[i - 1]!;
      d[i] = d[i]! - w * d[i - 1]!;
    }
    for (let i = n - 2; i >= 1; i--) m[i] = (d[i]! - c[i]! * m[i + 1]!) / b[i]!;
  }
  let k = 0;
  while (k < n - 2 && x > xs[k + 1]!) k++;
  const t = (x - xs[k]!) / h[k]!;
  const y =
    ys[k]! * (1 - t) +
    ys[k + 1]! * t +
    ((h[k]! * h[k]!) / 6) *
      ((Math.pow(1 - t, 3) - (1 - t)) * m[k]! + (Math.pow(t, 3) - t) * m[k + 1]!);
  return Math.min(1, Math.max(0, y));
}

/** FFmpeg `colorbalance` bileşeni (gri piksel: açıklık = 2v). */
function balance(v: number, s: number, m: number, h: number): number {
  const a = 4;
  const b = 0.333;
  const scale = 0.7;
  const l = 2 * v;
  const clip = (x: number) => Math.min(1, Math.max(0, x));
  const out =
    v +
    s * clip((b - l) * a + 0.5) * scale +
    m * clip((l - b) * a + 0.5) * clip((1 - l - b) * a + 0.5) * scale +
    h * clip((l + b - 1) * a + 0.5) * scale;
  return clip(out);
}

/** Kanal başına renk tablosu (0–1 → 0–1, 256 değer). `lut`: önceden okunmuş 1B
 * yaklaşık LUT (gri eksen), varsa en sonda uygulanır. */
export function gradeTables(
  g: ColorGrade | undefined,
  lut?: readonly [number, number, number][] | null,
): [Float32Array, Float32Array, Float32Array] {
  const tables: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(256),
    new Float32Array(256),
    new Float32Array(256),
  ];
  const grade = g ?? DEFAULT_GRADE;
  const gainExp = Math.pow(2, 2 * grade.exposure);
  const levels = levelPoints(grade);
  const flatLevels = levels.every(([x, y]) => Math.abs(x - y) < 1e-6);
  const s = wheelRgb(grade.shadows);
  const mid = wheelRgb(grade.midtones);
  const hi = wheelRgb(grade.highlights);
  const tint = -grade.tint * TINT_SCALE;
  for (let i = 0; i < 256; i++) {
    let v = Math.min(1, (i / 255) * gainExp);
    if (grade.curve) v = splineAt(grade.curve, v);
    if (!flatLevels) v = splineAt(levels, v);
    for (let c = 0; c < 3; c++) {
      const t = c === 1 ? tint : 0;
      let out = balance(v, s[c]! + t, mid[c]! + t, hi[c]! + t);
      if (lut && lut.length > 1) {
        const pos = out * (lut.length - 1);
        const lo = Math.floor(pos);
        const f = pos - lo;
        const a = lut[lo]![c]!;
        const b = lut[Math.min(lut.length - 1, lo + 1)]![c]!;
        out = a + (b - a) * f;
      }
      tables[c]![i] = out;
    }
  }
  return tables;
}

/** SVG feComponentTransfer `tableValues` (33 nokta yeter, aradaki doğrusal). */
export function tableValues(table: Float32Array, points = 33): string {
  const out: string[] = [];
  for (let i = 0; i < points; i++) {
    const v = table[Math.round((i / (points - 1)) * 255)]!;
    out.push(v.toFixed(4));
  }
  return out.join(" ");
}

/** .cube dosyası → gri eksen boyunca 1B yaklaşık tablo (önizleme ve kapsam için). */
export function cubeGrayAxis(text: string): [number, number, number][] | null {
  let size = 0;
  const rows: [number, number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (m) {
      size = Number(m[1]);
      continue;
    }
    if (/^[A-Z_]/i.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((v) => Number.isFinite(v))) {
      rows.push([parts[0]!, parts[1]!, parts[2]!]);
    }
  }
  if (size < 2 || size > 128 || rows.length !== size * size * size) return null;
  // Sıra: kırmızı en hızlı değişir → (i, i, i) satırı i + i·n + i·n².
  const out: [number, number, number][] = [];
  for (let i = 0; i < size; i++) out.push(rows[i + i * size + i * size * size]!);
  return out;
}

/** Karedeki ortalama renge göre otomatik düzeltme: beyaz dengesi (orta tekerlek),
 * pozlama (ortalama parlaklık ~%45) ve seviyeler (%1 / %99 uçları). */
export function autoGrade(pixels: Uint8ClampedArray | readonly number[]): ColorGrade | undefined {
  const lum: number[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    const pr = pixels[i]! / 255;
    const pg = pixels[i + 1]! / 255;
    const pb = pixels[i + 2]! / 255;
    r += pr;
    g += pg;
    b += pb;
    lum.push(0.2126 * pr + 0.7152 * pg + 0.0722 * pb);
    n += 1;
  }
  if (n === 0) return undefined;
  r /= n;
  g /= n;
  b /= n;
  lum.sort((x, y) => x - y);
  const low = lum[Math.floor(n * 0.01)]!;
  const high = lum[Math.min(n - 1, Math.floor(n * 0.99))]!;
  const mean = lum.reduce((a, v) => a + v, 0) / n;
  const exposure = mean > 0.01 ? Math.max(-1, Math.min(1, Math.log2(0.45 / mean) / 2)) : 0;
  const gray = (r + g + b) / 3;
  return normalizeGrade({
    exposure: Math.abs(exposure) < 0.05 ? 0 : Math.round(exposure * 100) / 100,
    midtones: rgbWheel(
      [gray - r, gray - g, gray - b].map((v) => v * 1.4) as [number, number, number],
    ),
    lift: low > 0.04 ? -Math.min(1, (low - 0.02) / LEVEL_SCALE) : 0,
    gain: high < 0.95 ? Math.min(1, (0.98 - high) / LEVEL_SCALE) : 0,
  });
}

/** Bir pikseli nötr griye çeken orta ton tekerleği (damlalık). */
export function neutralizeWheel(rgb: [number, number, number]): Wheel {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const gray = (r + g + b) / 3;
  return rgbWheel([gray - r, gray - g, gray - b].map((v) => v * 1.4) as [number, number, number]);
}

/** Örnek karede patlayan (neredeyse beyaz) piksellerin oranı. */
export function clippedRatio(pixels: Uint8ClampedArray, threshold = 250): number {
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    if (pixels[i]! >= threshold && pixels[i + 1]! >= threshold && pixels[i + 2]! >= threshold)
      hit++;
    n++;
  }
  return n ? hit / n : 0;
}
