// Zamanlı yakınlaştırma: klibin bir aralığında görüntünün bir bölgesine yaklaşılır,
// bekler, sonra geri açılır. Aralığın başı/sonu KAYNAK saniyesidir (kesme, bölme ve
// hız değişiminde aynı görüntüde kalır); yaklaşma ve geri açılma süreleri çıktı
// milisaniyesidir (kullanıcının gördüğü süre). Anahtar karelere çevrilir; önizleme ve
// dışa aktarma aynı hesabı kullanır (lib/clipTransform). Saf fonksiyonlar.

import { DEFAULT_TRANSFORM, type ClipTransform, type Keyframe } from "./clipTransform";

export interface ZoomSpan {
  id: string;
  /** Kaynak saniyesi. */
  start: number;
  end: number;
  /** Yaklaşılan bölgenin merkezi (0–1) ve kenarı (görüntünün oranı; 0,5 = 2×). */
  x: number;
  y: number;
  size: number;
  /** Yaklaşma ve geri açılma süresi (çıktı milisaniyesi; 0 = anında). */
  inMs: number;
  outMs: number;
  /** Kaydır & yakınlaştır: bekleme boyunca bölge buradan bu bölgeye kayar (yoksa sabit). */
  pan?: ZoomRegion;
}

export interface ZoomRegion {
  x: number;
  y: number;
  size: number;
}

export const ZOOM_SIZE = { min: 1 / 3, max: 0.95 };
export const ZOOM_MS = { max: 3000 };
/** Anında yaklaşmada bile bir kare kadar geçiş (iki kare aynı ana düşmesin). */
const MIN_RAMP = 1 / 60;
export const DEFAULT_ZOOM_SECONDS = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function newZoom(id: string, start: number, end: number): ZoomSpan {
  return { id, start, end, x: 0.5, y: 0.5, size: 0.6, inMs: 300, outMs: 300 };
}

/** Bölgenin yakınlaştırma katı. */
export const zoomFactor = (z: Pick<ZoomSpan, "size">) =>
  1 / clamp(z.size, ZOOM_SIZE.min, ZOOM_SIZE.max);

/** Bölge görüntünün dışına taşmasın (yaklaşınca kenarda siyah kalmasın). */
export function clampRegion(r: ZoomRegion): ZoomRegion {
  const size = clamp(r.size, ZOOM_SIZE.min, ZOOM_SIZE.max);
  const half = size / 2;
  return { size, x: clamp(r.x, half, 1 - half), y: clamp(r.y, half, 1 - half) };
}

export function clampZoom(z: ZoomSpan): ZoomSpan {
  const out: ZoomSpan = {
    ...z,
    ...clampRegion(z),
    inMs: clamp(Math.round(z.inMs), 0, ZOOM_MS.max),
    outMs: clamp(Math.round(z.outMs), 0, ZOOM_MS.max),
  };
  if (z.pan) out.pan = clampRegion(z.pan);
  else delete out.pan;
  return out;
}

/** Kaydır & yakınlaştırmanın varsayılan bitiş bölgesi: biraz daha yakın, yana kaymış. */
export function defaultPan(z: ZoomRegion): ZoomRegion {
  const size = Math.max(ZOOM_SIZE.min, z.size * 0.8);
  const x = z.x <= 0.5 ? z.x + 0.2 : z.x - 0.2;
  return clampRegion({ x, y: z.y, size });
}

/** Kaynak sırasına dizilmiş, çakışmayan aralıklar (çakışanın başı öncekinin sonuna itilir). */
export function orderedZooms(spans: readonly ZoomSpan[]): ZoomSpan[] {
  const out: ZoomSpan[] = [];
  for (const z of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(z.start, out.at(-1)?.end ?? -Infinity);
    if (z.end - start > 0.05) out.push({ ...z, start });
  }
  return out;
}

/**
 * Aralıkların dönüşümü (ölçek + konum kareleri, kaynak saniyesi). `speed`: klibin hızı
 * (çıktı süresi kaynağa çevrilir). Aralık dışında görüntü olduğu gibi.
 */
export function zoomTransform(
  spans: readonly ZoomSpan[] | undefined,
  speed: number,
): ClipTransform | undefined {
  if (!spans || spans.length === 0) return undefined;
  const scale: Keyframe[] = [];
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  for (const raw of orderedZooms(spans)) {
    const z = clampZoom(raw);
    // Bölgenin merkezi karenin ortasına gelir: kayma = −kat × (merkez − 0,5).
    const frame = (r: ZoomRegion) => {
      const k = zoomFactor(r);
      const room = (k - 1) / 2;
      return {
        s: k,
        tx: clamp(-k * (r.x - 0.5), -room, room),
        ty: clamp(-k * (r.y - 0.5), -room, room),
      };
    };
    const from = frame(z);
    const to = frame(z.pan ?? z);
    const length = z.end - z.start;
    let ramp = Math.max(MIN_RAMP, (z.inMs / 1000) * speed);
    let back = Math.max(MIN_RAMP, (z.outMs / 1000) * speed);
    // Süreler aralığa sığmazsa orantılı kısalır.
    if (ramp + back > length) {
      const k = length / (ramp + back);
      ramp *= k;
      back *= k;
    }
    const a = z.start;
    const ia = a + ramp;
    const ob = z.end - back;
    const push = (list: Keyframe[], held: number, end: number) => {
      // Bitişik aralık: öncekinin bitiş karesi bu aralığın başlangıcıyla aynı an.
      if (list.length > 0 && list[list.length - 1].t >= a - 1e-4) list.pop();
      list.push(
        { t: a, v: list === scale ? 1 : 0, ease: "ease" },
        // Kaydırmada bekleme boyunca sabit hızla kayar (doğrusal).
        { t: ia, v: held },
        ...(ob - ia > 1e-4 ? [{ t: ob, v: end, ease: "ease" as const }] : []),
        { t: z.end, v: list === scale ? 1 : 0 },
      );
    };
    push(scale, from.s, to.s);
    push(x, from.tx, to.tx);
    push(y, from.ty, to.ty);
    // Bekleme yoksa (yaklaş-uzaklaş) tepe noktasından geri dönüş de yumuşak.
    if (ob - ia <= 1e-4) {
      for (const list of [scale, x, y]) list[list.length - 2].ease = "ease";
    }
  }
  return { ...DEFAULT_TRANSFORM, keys: { scale, x, y } };
}

/**
 * Aralığı taşır (`move`: süresi korunur) ya da kenarından uzatır (`resize`: yalnız oynayan
 * kenar sınırlanır). Komşu aralıklarla çakışmaz, `bounds` dışına çıkmaz; en az 0,2 sn.
 * Yer yoksa değişmez.
 */
export function placeZoom(
  spans: readonly ZoomSpan[],
  id: string,
  start: number,
  end: number,
  bounds: { min: number; max: number },
  mode: "move" | "resize" = "move",
): ZoomSpan[] {
  const others = spans.filter((z) => z.id !== id);
  const mid = (start + end) / 2;
  const lo = Math.max(
    bounds.min,
    ...others.filter((z) => (z.start + z.end) / 2 <= mid).map((z) => z.end),
  );
  const hi = Math.min(
    bounds.max,
    ...others.filter((z) => (z.start + z.end) / 2 > mid).map((z) => z.start),
  );
  if (hi - lo < 0.2) return [...spans];
  let a: number;
  let b: number;
  if (mode === "move") {
    const length = Math.min(Math.max(0.2, end - start), hi - lo);
    a = Math.min(Math.max(start, lo), hi - length);
    b = a + length;
  } else {
    a = Math.max(lo, Math.min(start, hi - 0.2));
    b = Math.min(hi, Math.max(end, a + 0.2));
  }
  return spans.map((z) => (z.id === id ? { ...z, start: a, end: b } : z));
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseRegion(raw: unknown): ZoomRegion | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !isNum(r.x) || !isNum(r.y) || !isNum(r.size)) return null;
  return { x: r.x, y: r.y, size: r.size };
}

/** Kayıttan gelen aralıklar (bozuk olan atılır). */
export function parseZooms(raw: unknown): ZoomSpan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== "string" || !isNum(r.start) || !isNum(r.end) || r.end <= r.start)
      return [];
    return [
      clampZoom({
        id: r.id,
        start: r.start,
        end: r.end,
        x: isNum(r.x) ? r.x : 0.5,
        y: isNum(r.y) ? r.y : 0.5,
        size: isNum(r.size) ? r.size : 0.6,
        inMs: isNum(r.inMs) ? r.inMs : 300,
        outMs: isNum(r.outMs) ? r.outMs : 300,
        ...(parseRegion(r.pan) ? { pan: parseRegion(r.pan)! } : {}),
      }),
    ];
  });
  return out.length > 0 ? orderedZooms(out) : undefined;
}
