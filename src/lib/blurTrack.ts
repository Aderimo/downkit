import { create } from "zustand";
import { useEditorStore } from "../store/editorStore";
import type { BlurItem, BlurKey } from "./layers";
import { flatten } from "./sequence";
import { detectFaces, onFaceProgress } from "./tauri-api";

// Gizleme kutusu yüzü takip eder: kutunun süresindeki parçalarda yüzler bulunur, kutuya
// en yakın yüz kareden kareye izlenir ve konum anahtarları yazılır. Önizleme ve dışa
// aktarma aynı anahtarları kullanır.

/** Zaman çizelgesi anındaki yüz kutuları ([x, y, w, h], kaynak karesinin oranı). */
export interface FacePoint {
  t: number;
  faces: readonly (readonly [number, number, number, number])[];
}

/** Bir kareden ötekine yüz en çok bu kadar kayabilir (karenin oranı); fazlası başka yüz. */
const MAX_JUMP = 0.3;

/**
 * Kutunun ortasına en yakın yüzden başlayıp onu izler. Kutu ilk bulunan yüzü biraz
 * pay bırakarak örter. Yüz bulunamazsa `null`.
 */
export function followFace(
  box: Pick<BlurItem, "start" | "end" | "x" | "y" | "w" | "h">,
  points: readonly FacePoint[],
): { w: number; h: number; keys: BlurKey[] } | null {
  let cx = box.x + box.w / 2;
  let cy = box.y + box.h / 2;
  let size: { w: number; h: number } | null = null;
  const centers: { t: number; cx: number; cy: number }[] = [];
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    if (p.t < box.start - 1e-6 || p.t > box.end + 1e-6) continue;
    let best: readonly [number, number, number, number] | null = null;
    let bestDist = Infinity;
    for (const f of p.faces) {
      const d = Math.hypot(f[0] + f[2] / 2 - cx, f[1] + f[3] / 2 - cy);
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    // İlk yüz uzakta olabilir (kutu kabaca konmuştur); sonrakiler sıçramamalı.
    if (!best || (size && bestDist > MAX_JUMP)) continue;
    cx = best[0] + best[2] / 2;
    cy = best[1] + best[3] / 2;
    size ??= {
      w: Math.min(1, Math.max(0.05, best[2] * 1.5)),
      h: Math.min(1, Math.max(0.05, best[3] * 1.5)),
    };
    centers.push({ t: p.t - box.start, cx, cy });
  }
  if (!size || centers.length === 0) return null;
  const { w, h } = size;
  // Titremesin diye komşularla yumuşatılır.
  const keys = centers.map((c, i) => {
    const near = centers.slice(Math.max(0, i - 1), i + 2);
    const mx = near.reduce((n, k) => n + k.cx, 0) / near.length;
    const my = near.reduce((n, k) => n + k.cy, 0) / near.length;
    return {
      t: c.t,
      x: Math.min(1 - w, Math.max(0, mx - w / 2)),
      y: Math.min(1 - h, Math.max(0, my - h / 2)),
    };
  });
  return { w, h, keys };
}

export const useBlurTrack = create<{ id: string | null; progress: number; failed: boolean }>(
  () => ({ id: null, progress: 0, failed: false }),
);

/** Kutunun süresinde yüzü bulup izler; bulunduysa kutu ve anahtarlar güncellenir. */
export async function trackBlurFace(id: string): Promise<boolean> {
  const s = useEditorStore.getState();
  const box = s.blurs.find((b) => b.id === id);
  if (!box || useBlurTrack.getState().id) return false;
  const first = s.sources[0];
  const parts = flatten(s.clips, s.tracks)
    .filter((seg) => seg.tEnd > box.start && seg.tStart < box.end && seg.freezeAt === undefined)
    .flatMap((seg) => {
      const entry = s.sources.find((x) => x.id === seg.sourceId) ?? first;
      const info = entry?.source.info;
      if (!entry || !info?.width || !info.height) return [];
      const a = Math.max(box.start, seg.tStart);
      const e = Math.min(box.end, seg.tEnd);
      const toSrc = (t: number) =>
        seg.reverse
          ? seg.srcEnd - (t - seg.tStart) * seg.speed
          : seg.srcStart + (t - seg.tStart) * seg.speed;
      const range: [number, number] = [Math.min(toSrc(a), toSrc(e)), Math.max(toSrc(a), toSrc(e))];
      const toTimeline = (src: number) =>
        seg.reverse
          ? seg.tStart + (seg.srcEnd - src) / seg.speed
          : seg.tStart + (src - seg.srcStart) / seg.speed;
      return [{ path: entry.source.path, w: info.width, h: info.height, range, toTimeline }];
    });
  if (parts.length === 0) return false;
  useBlurTrack.setState({ id, progress: 0, failed: false });
  const unlisten = await onFaceProgress((done, total) =>
    useBlurTrack.setState({ progress: Math.min(1, done / Math.max(1, total)) }),
  ).catch(() => null);
  try {
    const points: FacePoint[] = [];
    for (const part of parts) {
      const samples = await detectFaces(part.path, [part.range], part.w, part.h);
      for (const sample of samples)
        points.push({ t: part.toTimeline(sample.t), faces: sample.faces });
    }
    // Takip sürerken kutu değişmiş ya da silinmiş olabilir.
    const now = useEditorStore.getState().blurs.find((b) => b.id === id);
    const result = now ? followFace(now, points) : null;
    if (!now || !result) {
      useBlurTrack.setState({ failed: true });
      return false;
    }
    const first = result.keys[0]!;
    useEditorStore.getState().applyLayers({
      blurs: useEditorStore
        .getState()
        .blurs.map((b) =>
          b.id === id
            ? { ...b, w: result.w, h: result.h, x: first.x, y: first.y, keys: result.keys }
            : b,
        ),
    });
    return true;
  } catch {
    useBlurTrack.setState({ failed: true });
    return false;
  } finally {
    useBlurTrack.setState({ id: null, progress: 1 });
    try {
      unlisten?.();
    } catch {
      // Dinleyici zaten kapanmış olabilir.
    }
  }
}
