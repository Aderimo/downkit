import type { ExportPiece } from "./sequence";

// Yüz takibiyle dikey kırpma: kaynağın örnek karelerindeki yüz kutularından kırpma
// konumu (0 = sol/üst, 1 = sağ/alt) zaman içinde çıkarılır. Kameraman gibi davranır:
// yüz ortadaki ölü bölgede kaldıkça kadraj durur, çıkınca sınırlı hızla yumuşakça
// kayar. Sonuç az sayıda anahtar kareye sadeleştirilir (dışa aktarmada ifade kısa kalsın).

export type FaceBox = [number, number, number, number];

export interface FaceSample {
  /** Kaynak saniyesi. */
  t: number;
  faces: FaceBox[];
}

/** [zaman, konum] anahtar kareleri, zamana göre sıralı. */
export type Track = [number, number][];

export interface TrackResult {
  track: Track;
  /** Yüz bulunan karelerin oranı (0–1). */
  coverage: number;
}

/** Kırpılan eksen ve kalan bölgenin o eksendeki payı. */
export function cropAxis(sourceAspect: number, targetAspect: number) {
  const horizontal = sourceAspect > targetAspect;
  const share = horizontal ? targetAspect / sourceAspect : sourceAspect / targetAspect;
  return { horizontal, share: Math.min(1, share) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Her örnekte izlenecek yüzün merkezi (eksen boyunca); yüz yoksa null. Büyük yüz
 * seçilir; önceki yüze yakın ve yeterince büyük bir yüz varsa o (kadraj zıplamasın). */
export function faceCenters(
  samples: readonly FaceSample[],
  horizontal: boolean,
): (number | null)[] {
  let previous: number | null = null;
  return samples.map((s) => {
    if (s.faces.length === 0) return null;
    const center = (f: FaceBox) => (horizontal ? f[0] + f[2] / 2 : f[1] + f[3] / 2);
    const area = (f: FaceBox) => f[2] * f[3];
    const largest = s.faces.reduce((a, b) => (area(b) > area(a) ? b : a));
    let chosen = largest;
    if (previous !== null) {
      const near = s.faces
        .filter((f) => area(f) >= area(largest) * 0.6)
        .reduce((a, b) =>
          Math.abs(center(b) - previous!) < Math.abs(center(a) - previous!) ? b : a,
        );
      chosen = near;
    }
    previous = center(chosen);
    return previous;
  });
}

/** Boşlukları doldurur (önceki değer; baştaki boşluk ilk bulunanla) ve kayan medyan uygular. */
export function fillAndMedian(values: readonly (number | null)[], window = 5): number[] | null {
  const first = values.find((v) => v !== null);
  if (first === undefined || first === null) return null;
  let last = first;
  const filled = values.map((v) => (v === null ? last : (last = v)));
  const half = Math.floor(window / 2);
  return filled.map((_, i) => {
    const part = filled.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return part[Math.floor(part.length / 2)];
  });
}

/** Ramer–Douglas–Peucker: doğrudan `eps`ten az sapan noktalar atılır. */
export function simplify(track: Track, eps: number): Track {
  if (track.length <= 2) return [...track];
  const [t0, v0] = track[0];
  const [t1, v1] = track[track.length - 1];
  let worst = -1;
  let dist = 0;
  for (let i = 1; i < track.length - 1; i += 1) {
    const [t, v] = track[i];
    const expected = t1 === t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    const d = Math.abs(v - expected);
    if (d > dist) {
      dist = d;
      worst = i;
    }
  }
  if (dist <= eps) return [track[0], track[track.length - 1]];
  return [
    ...simplify(track.slice(0, worst + 1), eps).slice(0, -1),
    ...simplify(track.slice(worst), eps),
  ];
}

/** Anahtar kare sayısı `max`ı geçmesin diye tolerans büyütülerek sadeleştirilir. */
export function simplifyTo(track: Track, max: number, eps = 0.006): Track {
  let out = simplify(track, eps);
  while (out.length > max) {
    eps *= 1.6;
    out = simplify(track, eps);
  }
  return out;
}

export interface FollowOptions {
  /** Yüz bu kadar kayınca kadraj kımıldar (konum birimi, 0–1). */
  deadZone: number;
  /** Kadrajın en hızlı kayışı (konum birimi / saniye). */
  speed: number;
}

export const DEFAULT_FOLLOW: FollowOptions = { deadZone: 0.08, speed: 0.6 };

/** Örneklerden kırpma konumu izi (kaynak saniyesi). Hiç yüz yoksa null. */
export function buildTrack(
  samples: readonly FaceSample[],
  sourceAspect: number,
  targetAspect: number,
  follow: FollowOptions = DEFAULT_FOLLOW,
): TrackResult | null {
  if (samples.length === 0) return null;
  const { horizontal, share } = cropAxis(sourceAspect, targetAspect);
  if (share >= 0.999) return null;
  const centers = fillAndMedian(faceCenters(samples, horizontal));
  if (!centers) return null;
  // Yüz merkezi kadrajın ortasına gelsin: konum = (merkez − pay/2) / (1 − pay).
  const wanted = centers.map((c) => clamp01((c - share / 2) / (1 - share)));
  let current = wanted[0];
  let target = current;
  const raw: Track = [[samples[0].t, current]];
  for (let i = 1; i < samples.length; i += 1) {
    const dt = Math.max(0, samples[i].t - samples[i - 1].t);
    if (Math.abs(wanted[i] - current) > follow.deadZone) target = wanted[i];
    const step = follow.speed * dt;
    current += Math.max(-step, Math.min(step, target - current));
    raw.push([samples[i].t, current]);
  }
  const found = samples.filter((s) => s.faces.length > 0).length;
  return { track: simplifyTo(raw, 120), coverage: found / samples.length };
}

/** İzin `t` anındaki değeri (doğrusal; uçlarda sabit). */
export function trackAt(track: Track, t: number): number {
  if (track.length === 0) return 0.5;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i += 1) {
    const [t1, v1] = track[i];
    if (t <= t1) {
      const [t0, v0] = track[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return track[track.length - 1][1];
}

/**
 * Dışa aktarılacak parçalar için çıktı saniyesinde iz. Kaynağın izi yoksa o parça
 * `fallback` konumunda sabit; boşlukta önceki değer sürer. Kesimlerde kadraj atlar.
 */
export function outputTrack(
  pieces: readonly ExportPiece[],
  tracks: Readonly<Record<string, Track>>,
  sourceKey: (sourceId: string | undefined) => string | undefined,
  fallback: number,
): Track {
  const out: Track = [];
  let offset = 0;
  let last = fallback;
  for (const p of pieces) {
    const length = p.tEnd - p.tStart;
    if (p.kind === "clip") {
      const s = p.segment;
      const key = sourceKey(s.sourceId);
      const track = key ? tracks[key] : undefined;
      const toOut = (src: number) => offset + (src - s.srcStart) / s.speed;
      if (track && track.length > 0) {
        out.push([offset, trackAt(track, s.srcStart)]);
        for (const [t, v] of track) {
          if (t > s.srcStart && t < s.srcEnd) out.push([toOut(t), v]);
        }
        last = trackAt(track, s.srcEnd);
        out.push([offset + length, last]);
      } else {
        out.push([offset, fallback], [offset + length, fallback]);
        last = fallback;
      }
    } else {
      out.push([offset, last], [offset + length, last]);
    }
    offset += length;
  }
  return simplifyTo(out, 120, 0.002);
}

/**
 * `from` oranlı çıktı için hesaplanmış izi `to` oranına uyarlar: aynı yüz merkezi
 * yeni kırpma payında ortalanır. Kırpılan eksen değişirse ya da yeni biçimde kırpma
 * yoksa null (iz o biçimde anlamsız).
 */
export function retargetTrack(
  track: Track,
  sourceAspect: number,
  from: number,
  to: number,
): Track | null {
  if (Math.abs(from - to) < 1e-6) return track;
  const a = cropAxis(sourceAspect, from);
  const b = cropAxis(sourceAspect, to);
  if (a.horizontal !== b.horizontal || a.share >= 0.999 || b.share >= 0.999) return null;
  return track.map(([t, p]) => {
    const center = p * (1 - a.share) + a.share / 2;
    return [t, clamp01((center - b.share / 2) / (1 - b.share))];
  });
}

/** Kayıttan gelen izleri doğrular (yol → iz). */
export function parseFrameTrack(raw: unknown): Record<string, Track> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, Track> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const track = value.filter(
      (p): p is [number, number] =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === "number" && Number.isFinite(n)),
    );
    if (track.length > 0) out[key] = track.map(([t, v]) => [t, clamp01(v)]);
  }
  return Object.keys(out).length > 0 ? out : null;
}
