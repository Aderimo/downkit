// Efekt şeridi: zaman çizelgesinin üstünde, yazılar gibi taşınan / uzatılan efekt
// blokları. Bir blok altındaki görüntüye yalnızca kendi aralığında uygulanır (filtre,
// bulanıklık, ayna, kenar karartma ya da hareket). Oynatma ve dışa aktarma, parçaları
// blok sınırlarından bölüp bloğun görünümünü parçanın görünümüne katar; Rust tarafı
// değişmez. Saf fonksiyonlar.

import { DEFAULT_LOOK, FILTERS, normalizeLook, type ClipLook, type FilterId } from "./clipLook";
import { MOTIONS, clampStrength, type MotionId } from "./clipFx";
import { LOOK_FX_IDS, mergeFx, normalizeFx } from "./lookFx";
import type { Segment } from "./sequence";

export interface EffectItem {
  id: string;
  /** Zaman çizelgesi saniyesi. */
  start: number;
  end: number;
  /** Değiştirilen görünüm alanları (filtre, bulanıklık, ayna, kenar karartma). */
  look?: Partial<Pick<ClipLook, "filter" | "blur" | "mirror" | "vignette" | "fx">>;
  /** Blok boyunca hareket (yakınlaştır, kaydır, sarsıntı…). */
  motion?: MotionId;
  motionStrength?: number;
}

export const DEFAULT_EFFECT_SECONDS = 3;
const EPS = 1e-6;

export function newEffect(
  id: string,
  start: number,
  end: number,
  patch: Pick<EffectItem, "look" | "motion" | "motionStrength">,
): EffectItem {
  return { id, start: Math.max(0, start), end: Math.max(start + 0.2, end), ...patch };
}

/** `t` anında etkin bloklar (listedeki sırayla; sonraki öncekini ezer). */
export function effectsAt(items: readonly EffectItem[], t: number): EffectItem[] {
  return items.filter((e) => t >= e.start - EPS && t < e.end - EPS);
}

/** Klibin görünümü + blokların görünümü (filtre ezer, bulanıklık büyüğü, ayna ve kenar karartma açar). */
export function mergeEffectLook(
  base: ClipLook | undefined,
  items: readonly EffectItem[],
): ClipLook | undefined {
  const withLook = items.filter((e) => e.look);
  if (withLook.length === 0) return base;
  const look: ClipLook = { ...normalizeLook(base ?? DEFAULT_LOOK) };
  for (const e of withLook) {
    if (e.look!.filter !== undefined) look.filter = e.look!.filter;
    if (e.look!.blur !== undefined) look.blur = Math.max(look.blur, e.look!.blur);
    if (e.look!.mirror) look.mirror = true;
    if (e.look!.vignette) look.vignette = true;
    if (e.look!.fx) look.fx = mergeFx(look.fx, e.look!.fx);
  }
  return look;
}

/** Parçayı `t` anında ikiye böler (kaynak zamanı hızla eşlenir; geçişler uçlarda kalır). */
function splitSegment(s: Segment, t: number): [Segment, Segment] {
  // Ters parçada baş kısım kaynağın sonunu gösterir.
  if (s.reverse) {
    const src = s.srcEnd - (t - s.tStart) * s.speed;
    const head: Segment = { ...s, tEnd: t, srcStart: src, fadeOut: 0 };
    delete head.xfadeOut;
    const tail: Segment = { ...s, tStart: t, srcEnd: src, fadeIn: 0 };
    return [head, tail];
  }
  const src = s.srcStart + (t - s.tStart) * s.speed;
  const head: Segment = { ...s, tEnd: t, srcEnd: src, fadeOut: 0 };
  delete head.xfadeOut;
  const tail: Segment = { ...s, tStart: t, srcStart: src, fadeIn: 0 };
  return [head, tail];
}

/**
 * Parçalara efekt bloklarını uygular: parçalar blok sınırlarından bölünür, her parçaya
 * üstündeki blokların görünümü ve (varsa) hareketi katılır. Hareketin ilerlemesi
 * bloğa göredir (bloğun başında başlar, sonunda biter).
 */
export function withEffects(
  segments: readonly Segment[],
  items: readonly EffectItem[] | undefined,
): Segment[] {
  if (!items || items.length === 0) return segments as Segment[];
  const cuts = [...new Set(items.flatMap((e) => [e.start, e.end]))].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (const segment of segments) {
    let rest: Segment = segment;
    for (const c of cuts) {
      if (c > rest.tStart + 0.02 && c < rest.tEnd - 0.02) {
        const [head, tail] = splitSegment(rest, c);
        out.push(head);
        rest = tail;
      }
    }
    out.push(rest);
  }
  return out.map((s) => {
    const active = effectsAt(items, (s.tStart + s.tEnd) / 2);
    if (active.length === 0) return s;
    const next: Segment = { ...s, look: mergeEffectLook(s.look, active) };
    const moving = [...active].reverse().find((e) => e.motion && e.motion !== "none");
    if (moving) {
      next.motion = moving.motion;
      next.motionStrength = clampStrength(moving.motionStrength);
      next.clipStart = moving.start;
      next.clipLength = moving.end - moving.start;
    }
    return next;
  });
}

/** Bloğun kısa adı için çeviri anahtarı ve parametresi. */
export function effectKey(e: EffectItem): { key: string; id?: string } {
  if (e.motion && e.motion !== "none") return { key: "editor.motionName", id: e.motion };
  if (e.look?.filter && e.look.filter !== "none")
    return { key: "editor.filter", id: e.look.filter };
  const fx = e.look?.fx ? LOOK_FX_IDS.find((id) => (e.look!.fx![id] ?? 0) > 0) : undefined;
  if (fx) return { key: "lookFx.names", id: fx };
  if (e.look?.blur) return { key: "editor.blur" };
  if (e.look?.mirror) return { key: "editor.mirror" };
  if (e.look?.vignette) return { key: "editor.vignette" };
  return { key: "effectLane.empty" };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Kayıttan gelen bloklar (bozuk olan atılır). */
export function parseEffects(raw: unknown): EffectItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== "string" || !isNum(r.start) || !isNum(r.end) || r.end <= r.start)
      return [];
    const item: EffectItem = { id: r.id, start: Math.max(0, r.start), end: r.end };
    const look = r.look as Record<string, unknown> | undefined;
    if (look && typeof look === "object") {
      const out: NonNullable<EffectItem["look"]> = {};
      if (FILTERS.includes(look.filter as FilterId)) out.filter = look.filter as FilterId;
      if (isNum(look.blur)) out.blur = Math.min(1, Math.max(0, look.blur));
      if (look.mirror === true) out.mirror = true;
      if (look.vignette === true) out.vignette = true;
      const fx = normalizeFx(look.fx);
      if (fx) out.fx = fx;
      if (Object.keys(out).length > 0) item.look = out;
    }
    if (MOTIONS.includes(r.motion as MotionId) && r.motion !== "none") {
      item.motion = r.motion as MotionId;
      if (isNum(r.motionStrength)) item.motionStrength = clampStrength(r.motionStrength);
    }
    return item.look || item.motion ? [item] : [];
  });
}
