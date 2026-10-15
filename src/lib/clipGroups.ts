import { clipEnd, clipLength, MAX_TRACKS, type SeqClip } from "./sequence";

// Çoklu klip işlemleri: dalgalı silme, birlikte taşıma, kopyala/yapıştır, gruplama.
// Saf fonksiyonlar; zaman çizelgesindeki hiçbir klip başka biriyle aynı izde üst üste binmez.

const EPS = 1e-6;

/** Gruptaki tüm klipler: seçim bir grup üyesini içeriyorsa grubun tamamı seçilir. */
export function expandGroups(clips: readonly SeqClip[], ids: readonly string[]): string[] {
  const groups = new Set(clips.filter((c) => ids.includes(c.id) && c.group).map((c) => c.group));
  if (groups.size === 0) return [...ids];
  const out = new Set(ids);
  for (const c of clips) if (c.group && groups.has(c.group)) out.add(c.id);
  return clips.filter((c) => out.has(c.id)).map((c) => c.id);
}

export function groupClips(
  clips: readonly SeqClip[],
  ids: readonly string[],
  group: string,
): SeqClip[] {
  if (ids.length < 2) return [...clips];
  return clips.map((c) => (ids.includes(c.id) ? { ...c, group } : c));
}

export function ungroupClips(clips: readonly SeqClip[], ids: readonly string[]): SeqClip[] {
  const groups = new Set(clips.filter((c) => ids.includes(c.id) && c.group).map((c) => c.group));
  return clips.map((c) => {
    if (!c.group || !groups.has(c.group)) return c;
    const next = { ...c };
    delete next.group;
    return next;
  });
}

/**
 * Dalgalı silme: klipler silinir, aynı izde arkalarından gelenler boşluğu kapatacak
 * kadar sola kayar. Diğer izlere dokunulmaz.
 */
export function rippleDelete(clips: readonly SeqClip[], ids: readonly string[]): SeqClip[] {
  const removed = clips.filter((c) => ids.includes(c.id));
  if (removed.length === 0) return [...clips];
  return clips
    .filter((c) => !ids.includes(c.id))
    .map((c) => {
      // Bu klipten önce biten, aynı izdeki silinenlerin toplam süresi kadar kayar.
      let shift = 0;
      for (const r of removed) {
        if (r.track === c.track && clipEnd(r) <= c.start + EPS) shift += clipLength(r);
      }
      return shift > 0 ? { ...c, start: Math.max(0, c.start - shift) } : c;
    });
}

function overlaps(a: SeqClip, b: SeqClip): boolean {
  return a.track === b.track && a.start < clipEnd(b) - EPS && b.start < clipEnd(a) - EPS;
}

/** Hareket eden kliplerin `delta` kaydırılmış hâli diğerleriyle çakışmıyor mu. */
function fits(
  moving: readonly SeqClip[],
  fixed: readonly SeqClip[],
  delta: number,
  trackDelta: number,
): boolean {
  for (const m of moving) {
    const track = m.track + trackDelta;
    if (m.start + delta < -EPS || track < 0 || track >= MAX_TRACKS) return false;
    const placed = { ...m, start: m.start + delta, track };
    if (fixed.some((f) => overlaps(placed, f))) return false;
  }
  return true;
}

/**
 * Birden çok klibi birlikte taşır (aralarındaki düzen korunur). İstenen yer doluysa
 * en yakın boş yere oturur; hiç yer yoksa klipler yerinde kalır.
 */
export function moveClips(
  clips: readonly SeqClip[],
  ids: readonly string[],
  delta: number,
  trackDelta = 0,
): SeqClip[] {
  const moving = clips.filter((c) => ids.includes(c.id));
  const fixed = clips.filter((c) => !ids.includes(c.id));
  if (moving.length === 0) return [...clips];
  const best = nearestFit(moving, fixed, delta, trackDelta);
  if (best === null) return [...clips];
  return clips.map((c) =>
    ids.includes(c.id)
      ? { ...c, start: Math.max(0, c.start + best), track: c.track + trackDelta }
      : c,
  );
}

/** İstenen kaydırmaya en yakın geçerli kaydırma (yoksa null). */
function nearestFit(
  moving: readonly SeqClip[],
  fixed: readonly SeqClip[],
  delta: number,
  trackDelta: number,
): number | null {
  if (fits(moving, fixed, delta, trackDelta)) return delta;
  // Adaylar: hareket eden her klibin, hedef izdeki her sabit klibe değdiği kaydırmalar ve 0'a yaslanma.
  const candidates = new Set<number>();
  for (const m of moving) {
    candidates.add(-m.start);
    for (const f of fixed) {
      if (f.track !== m.track + trackDelta) continue;
      candidates.add(clipEnd(f) - m.start);
      candidates.add(f.start - clipEnd(m));
    }
  }
  let best: number | null = null;
  for (const c of candidates) {
    if (!fits(moving, fixed, c, trackDelta)) continue;
    if (best === null || Math.abs(c - delta) < Math.abs(best - delta)) best = c;
  }
  return best;
}

/** Panoya alınan klipler: ilk klibin başına göre göreli konumlarıyla. */
export function copyClips(clips: readonly SeqClip[], ids: readonly string[]): SeqClip[] {
  const picked = clips.filter((c) => ids.includes(c.id));
  if (picked.length === 0) return [];
  const origin = Math.min(...picked.map((c) => c.start));
  return picked.map((c) => ({ ...c, start: c.start - origin }));
}

/**
 * Panodaki klipleri `at` anına yapıştırır; orası doluysa ileride ilk boş yere.
 * Yeni kimlikler verilir, grup bağı yeni bir grupla korunur. Eklenen kimlikler döner.
 */
export function pasteClips(
  clips: readonly SeqClip[],
  copied: readonly SeqClip[],
  at: number,
  newId: () => string,
): { clips: SeqClip[]; ids: string[] } {
  if (copied.length === 0) return { clips: [...clips], ids: [] };
  const groupMap = new Map<string, string>();
  const fresh = copied.map((c) => {
    const next: SeqClip = { ...c, id: newId(), start: c.start + Math.max(0, at) };
    if (c.group) {
      if (!groupMap.has(c.group)) groupMap.set(c.group, newId());
      next.group = groupMap.get(c.group);
    }
    return next;
  });
  // İleriye doğru ilk boş yer: istenen kaydırma 0, yalnızca sağa kaydırma kabul edilir.
  let shift = 0;
  for (let i = 0; i < 400 && !fits(fresh, clips, shift, 0); i += 1) {
    const blockers = clips.filter((f) =>
      fresh.some((m) => overlaps({ ...m, start: m.start + shift }, f)),
    );
    shift = Math.max(
      ...blockers.map(
        (f) =>
          clipEnd(f) - Math.min(...fresh.filter((m) => m.track === f.track).map((m) => m.start)),
      ),
    );
  }
  const placed = fresh.map((c) => ({ ...c, start: c.start + shift }));
  return { clips: [...clips, ...placed], ids: placed.map((c) => c.id) };
}
