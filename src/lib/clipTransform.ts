// Klip dönüşümü: konum, ölçek, döndürme, saydamlık. Her özellik sabit bir değer ya da
// anahtar karelerle zamana bağlı olabilir. Anahtar kare zamanları KAYNAK saniyesidir:
// klip kısaltılınca, bölünce ya da hızı değişince kareler aynı görüntüde kalır;
// klibin dışında kalan kareler silinmez (yeniden uzatınca geri gelir), eğri onlara göre
// sürer. Formüller Rust `ffmpeg/transform.rs` ile aynı: önizleme = dışa aktarma.
// Saf fonksiyonlar.

export type TransformProp = "x" | "y" | "scale" | "rotation" | "opacity";
export const TRANSFORM_PROPS: TransformProp[] = ["x", "y", "scale", "rotation", "opacity"];

/** Bir kareden sonrakine geçiş eğrisi. */
export type Ease = "linear" | "ease" | "easeIn" | "easeOut" | "hold";
export const EASES: Ease[] = ["linear", "ease", "easeIn", "easeOut", "hold"];

export interface Keyframe {
  /** Kaynak saniyesi. */
  t: number;
  v: number;
  /** Bir sonraki kareye doğru eğri (yoksa doğrusal). */
  ease?: Ease;
}

export interface ClipTransform {
  /** Merkezin kayması: tuvalin genişliği / yüksekliği oranında (0 = ortada). */
  x: number;
  y: number;
  /** 1 = olduğu gibi. */
  scale: number;
  /** Derece, saat yönünde. */
  rotation: number;
  opacity: number;
  keys?: Partial<Record<TransformProp, Keyframe[]>>;
}

export type TransformValues = Omit<ClipTransform, "keys">;

export const DEFAULT_TRANSFORM: TransformValues = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

/** Arayüz sınırları (Rust tarafı da aynı aralığa kırpar). */
export const TRANSFORM_LIMITS: Record<TransformProp, { min: number; max: number; step: number }> = {
  x: { min: -1, max: 1, step: 0.005 },
  y: { min: -1, max: 1, step: 0.005 },
  scale: { min: 0.1, max: 3, step: 0.01 },
  rotation: { min: -180, max: 180, step: 1 },
  opacity: { min: 0, max: 1, step: 0.01 },
};

/** Bir kareyle aynı yerde sayılan uzaklık (kaynak saniyesi). */
export const KEY_SNAP = 1 / 50;
const MAX_KEYS = 64;

const clamp = (prop: TransformProp, v: number) => {
  const { min, max } = TRANSFORM_LIMITS[prop];
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_TRANSFORM[prop];
};

/** Geçiş eğrisinin değeri (0–1 → 0–1); hepsi uçlarda 0 ve 1, aşma yok. */
export function easeValue(ease: Ease | undefined, p: number): number {
  const q = Math.min(1, Math.max(0, p));
  switch (ease) {
    case "ease":
      return q * q * (3 - 2 * q);
    case "easeIn":
      return q * q;
    case "easeOut":
      return q * (2 - q);
    case "hold":
      return 0;
    default:
      return q;
  }
}

export function keysOf(tr: ClipTransform | undefined, prop: TransformProp): Keyframe[] {
  return tr?.keys?.[prop] ?? [];
}

export const hasKeys = (tr: ClipTransform | undefined, prop?: TransformProp): boolean =>
  prop ? keysOf(tr, prop).length > 0 : TRANSFORM_PROPS.some((p) => keysOf(tr, p).length > 0);

/** Kareler arasında değer (kareden önce ilk, sonra son kare). */
export function keyValueAt(keys: readonly Keyframe[], t: number): number {
  if (keys.length === 0) return NaN;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t < b.t) {
      const p = b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 1;
      return a.v + (b.v - a.v) * easeValue(a.ease, p);
    }
  }
  return keys[keys.length - 1].v;
}

/** Özelliğin `src` kaynak saniyesindeki değeri. */
export function propAt(tr: ClipTransform | undefined, prop: TransformProp, src: number): number {
  if (!tr) return DEFAULT_TRANSFORM[prop];
  const keys = keysOf(tr, prop);
  return clamp(prop, keys.length > 0 ? keyValueAt(keys, src) : tr[prop]);
}

export function transformAt(tr: ClipTransform | undefined, src: number): TransformValues {
  return {
    x: propAt(tr, "x", src),
    y: propAt(tr, "y", src),
    scale: propAt(tr, "scale", src),
    rotation: propAt(tr, "rotation", src),
    opacity: propAt(tr, "opacity", src),
  };
}

/** Özelliğin aldığı en küçük / en büyük değer (eğriler aşmaz: uçlar karelerdedir). */
function range(tr: ClipTransform, prop: TransformProp): [number, number] {
  const keys = keysOf(tr, prop);
  if (keys.length === 0) return [clamp(prop, tr[prop]), clamp(prop, tr[prop])];
  const values = keys.map((k) => clamp(prop, k.v));
  return [Math.min(...values), Math.max(...values)];
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Dönüşüm görüntüyü değiştirmiyor (varsayılan, ya da her kare varsayılan değerde). */
export function isDefaultTransform(tr: ClipTransform | undefined): boolean {
  if (!tr) return true;
  return TRANSFORM_PROPS.every((p) => {
    const [lo, hi] = range(tr, p);
    return near(lo, DEFAULT_TRANSFORM[p]) && near(hi, DEFAULT_TRANSFORM[p]);
  });
}

/**
 * Klip alttaki görüntüyü açıkta bırakıyor mu: küçülmüş, kaymış (kapladığından fazla),
 * dönmüş ya da saydam. Üst izde böyle klip alttakinin üstüne bindirilir (örtmez).
 */
export function seeThrough(tr: ClipTransform | undefined): boolean {
  if (!tr || isDefaultTransform(tr)) return false;
  const [omin] = range(tr, "opacity");
  const [rmin, rmax] = range(tr, "rotation");
  const [smin] = range(tr, "scale");
  if (omin < 0.999 || !near(rmin, 0) || !near(rmax, 0) || smin < 0.999) return true;
  const room = (smin - 1) / 2;
  const [xmin, xmax] = range(tr, "x");
  const [ymin, ymax] = range(tr, "y");
  return Math.max(-xmin, xmax) > room + 1e-6 || Math.max(-ymin, ymax) > room + 1e-6;
}

function withKeys(tr: ClipTransform, prop: TransformProp, keys: Keyframe[]): ClipTransform {
  const next: ClipTransform = { ...tr, keys: { ...tr.keys } };
  if (keys.length > 0) next.keys![prop] = keys;
  else delete next.keys![prop];
  if (Object.keys(next.keys!).length === 0) delete next.keys;
  return next;
}

const sorted = (keys: Keyframe[]) => [...keys].sort((a, b) => a.t - b.t).slice(0, MAX_KEYS);

/** `src` anına yakın kare (yoksa -1). */
export function keyIndexAt(tr: ClipTransform | undefined, prop: TransformProp, src: number) {
  return keysOf(tr, prop).findIndex((k) => Math.abs(k.t - src) < KEY_SNAP);
}

/**
 * Özelliğe değer verir. Özelliğin karesi varsa o anda kare eklenir ya da güncellenir
 * (otomatik kare), yoksa sabit değer değişir.
 */
export function setProp(
  tr: ClipTransform | undefined,
  prop: TransformProp,
  value: number,
  src: number,
): ClipTransform {
  const base: ClipTransform = tr ?? { ...DEFAULT_TRANSFORM };
  const v = clamp(prop, value);
  const keys = keysOf(base, prop);
  if (keys.length === 0) return { ...base, [prop]: v };
  const i = keyIndexAt(base, prop, src);
  const next =
    i >= 0
      ? keys.map((k, j) => (j === i ? { ...k, v } : k))
      : sorted([...keys, { t: src, v, ease: neighbourEase(keys, src) }]);
  return withKeys(base, prop, next);
}

/** Yeni kare, önündeki karenin eğrisini alır (yoksa doğrusal). */
function neighbourEase(keys: readonly Keyframe[], src: number): Ease | undefined {
  const before = [...keys].reverse().find((k) => k.t < src);
  return before?.ease;
}

/**
 * ◆ düğmesi: o anda kare varsa siler, yoksa o anki değerle ekler. Son kare silinince
 * özellik o değerde sabit kalır (görüntü zıplamaz).
 */
export function toggleKey(
  tr: ClipTransform | undefined,
  prop: TransformProp,
  src: number,
): ClipTransform {
  const base: ClipTransform = tr ?? { ...DEFAULT_TRANSFORM };
  const keys = keysOf(base, prop);
  const i = keyIndexAt(base, prop, src);
  if (i >= 0) {
    const rest = keys.filter((_, j) => j !== i);
    const next = withKeys(base, prop, rest);
    return rest.length === 0 ? { ...next, [prop]: keys[i].v } : next;
  }
  const v = propAt(base, prop, src);
  return withKeys(base, prop, sorted([...keys, { t: src, v, ease: neighbourEase(keys, src) }]));
}

/** Karenin eğrisini değiştirir. */
export function setKeyEase(
  tr: ClipTransform,
  prop: TransformProp,
  index: number,
  ease: Ease,
): ClipTransform {
  const keys = keysOf(tr, prop).map((k, j) =>
    j === index ? (ease === "linear" ? { t: k.t, v: k.v } : { ...k, ease }) : k,
  );
  return withKeys(tr, prop, keys);
}

/** O andaki bütün özelliklerin karesinin eğrisini değiştirir. */
export function setEaseAt(tr: ClipTransform, src: number, ease: Ease): ClipTransform {
  let next = tr;
  for (const p of TRANSFORM_PROPS) {
    const i = keyIndexAt(next, p, src);
    if (i >= 0) next = setKeyEase(next, p, i, ease);
  }
  return next;
}

/** O andaki bütün özelliklerin karelerini siler. */
export function deleteKeysAt(tr: ClipTransform, src: number): ClipTransform {
  let next = tr;
  for (const p of TRANSFORM_PROPS)
    if (keyIndexAt(next, p, src) >= 0) next = toggleKey(next, p, src);
  return next;
}

/** Bütün özelliklerin kare zamanları (sıralı, yakın olanlar tek). */
export function keyTimes(tr: ClipTransform | undefined): number[] {
  const times = TRANSFORM_PROPS.flatMap((p) => keysOf(tr, p).map((k) => k.t)).sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1] >= KEY_SNAP);
}

/** Önceki / sonraki kare zamanı (yoksa null). */
export function adjacentKey(
  tr: ClipTransform | undefined,
  src: number,
  dir: -1 | 1,
  prop?: TransformProp,
): number | null {
  const times = prop ? keysOf(tr, prop).map((k) => k.t) : keyTimes(tr);
  const pick =
    dir > 0
      ? times.find((t) => t > src + KEY_SNAP / 2)
      : [...times].reverse().find((t) => t < src - KEY_SNAP / 2);
  return pick ?? null;
}

/** Önizleme: dönüşümün CSS'i (tuval kutusunun içinde; yüzdeler kutuya göre). */
export function transformCss(v: TransformValues): { transform: string; opacity: number } | null {
  if (
    near(v.x, 0) &&
    near(v.y, 0) &&
    near(v.scale, 1) &&
    near(v.rotation, 0) &&
    near(v.opacity, 1)
  ) {
    return null;
  }
  return {
    transform: `translate(${v.x * 100}%, ${v.y * 100}%) rotate(${v.rotation}deg) scale(${v.scale})`,
    opacity: v.opacity,
  };
}

/** Dışa aktarılan dönüşüm (Rust `Transform`): kare zamanları parçanın çıktı saniyesi. */
export interface TransformReq extends TransformValues {
  keys: Partial<Record<TransformProp, { t: number; v: number; ease?: Ease }[]>>;
}

/**
 * Parça için dönüşüm: kaynak saniyesi `srcStart`ten başlayıp `speed` hızıyla akan
 * parçanın kendi saniyesine çevrilir. Parçanın dışındaki karelerden yalnız eğriyi
 * belirleyen en yakın ikisi (önce/sonra) kalır.
 */
export function exportTransform(
  tr: ClipTransform | undefined,
  piece: { srcStart: number; srcEnd: number; speed: number; freezeAt?: number; reverse?: boolean },
): TransformReq | null {
  if (!tr || isDefaultTransform(tr)) return null;
  // Dondurulmuş karede dönüşüm o karedeki değerinde sabit kalır.
  if (piece.freezeAt !== undefined) {
    const v = transformAt(tr, piece.freezeAt);
    return { ...v, keys: {} };
  }
  const toOut = (src: number) =>
    piece.reverse ? (piece.srcEnd - src) / piece.speed : (src - piece.srcStart) / piece.speed;
  const keys: TransformReq["keys"] = {};
  for (const p of TRANSFORM_PROPS) {
    const all = keysOf(tr, p);
    if (all.length === 0) continue;
    const before = [...all].reverse().find((k) => k.t <= piece.srcStart);
    const after = all.find((k) => k.t >= piece.srcEnd);
    const inside = all.filter((k) => k.t > piece.srcStart && k.t < piece.srcEnd);
    const picked = [
      ...(before ? [before] : []),
      ...inside,
      ...(after && after !== before ? [after] : []),
    ];
    // Ters parçada kareler sondan başa dizilir; her aralığın eğrisi (önceki karenin
    // `ease`'i) aralığıyla birlikte taşınır.
    const list = piece.reverse ? [...picked].reverse() : picked;
    keys[p] = list.map((k, i) => {
      const ease = piece.reverse ? picked[picked.length - 2 - i]?.ease : k.ease;
      return {
        t: Number(toOut(k.t).toFixed(4)),
        v: clamp(p, k.v),
        ...(ease && ease !== "linear" ? { ease } : {}),
      };
    });
  }
  return {
    x: clamp("x", tr.x),
    y: clamp("y", tr.y),
    scale: clamp("scale", tr.scale),
    rotation: clamp("rotation", tr.rotation),
    opacity: clamp("opacity", tr.opacity),
    keys,
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Kayıttan gelen dönüşüm (bozuk alanlar varsayılana döner, bozuk kareler atılır). */
export function parseTransform(raw: unknown): ClipTransform | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const tr: ClipTransform = { ...DEFAULT_TRANSFORM };
  for (const p of TRANSFORM_PROPS) if (isNum(r[p])) tr[p] = clamp(p, r[p] as number);
  const keys = r.keys as Record<string, unknown> | undefined;
  if (keys && typeof keys === "object") {
    for (const p of TRANSFORM_PROPS) {
      const list = keys[p];
      if (!Array.isArray(list)) continue;
      const valid = list
        .filter((k): k is Keyframe => !!k && isNum(k.t) && isNum(k.v))
        .map((k) => ({
          t: k.t,
          v: clamp(p, k.v),
          ...(EASES.includes(k.ease as Ease) && k.ease !== "linear" ? { ease: k.ease } : {}),
        }));
      if (valid.length > 0) tr.keys = { ...tr.keys, [p]: sorted(valid) };
    }
  }
  return isDefaultTransform(tr) && !tr.keys ? undefined : tr;
}
