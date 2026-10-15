import { create } from "zustand";
import { textFileRead, textFileWrite } from "./tauri-api";

// "An işareti": kayıt ya da anlık tekrar sürerken kısayola basınca o an işaretlenir.
// Kayıt kaydedilince işaretler videonun yanına `<video>.markers.json` olarak yazılır;
// düzenleyici bu dosyayı okuyup zaman çizelgesinde gösterir (uzun kayıtta güzel anı
// aramak gerekmesin). Saf yardımcılar + küçük modül durumu.

/** Videonun yanındaki işaret dosyası. */
export const markersPath = (video: string) => `${video}.markers.json`;

export interface MarkerFile {
  version: 1;
  /** Videodaki saniyeler, sıralı. */
  markers: number[];
}

/** Dosya içeriğini doğrular; bozuksa boş liste. */
export function parseMarkers(raw: string): number[] {
  try {
    const data = JSON.parse(raw) as Partial<MarkerFile>;
    if (!Array.isArray(data.markers)) return [];
    return [...new Set(data.markers.filter((m) => Number.isFinite(m) && m >= 0))]
      .map((m) => Math.round(m * 100) / 100)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function markerFile(markers: readonly number[]): string {
  const clean = [...markers].filter((m) => Number.isFinite(m) && m >= 0).sort((a, b) => a - b);
  return JSON.stringify({ version: 1, markers: clean.map((m) => Math.round(m * 100) / 100) });
}

/** Anlık tekrar kaydedildiğinde, kaydedilen pencereye düşen işaretlerin videodaki saniyesi.
 * `savedAt`: kaydetme isteğinin anı (ms), `seconds`: kaydedilen uzunluk. */
export function replayOffsets(
  marks: readonly number[],
  savedAt: number,
  seconds: number,
): number[] {
  const from = savedAt - seconds * 1000;
  return marks
    .filter((m) => m >= from && m <= savedAt + 250)
    .map((m) => Math.min(seconds, Math.max(0, (m - from) / 1000)));
}

/** Birbirine çok yakın basışlar (tuşa iki kez basma) tek işaret sayılır. */
const MIN_GAP_MS = 700;

let recordingMarks: number[] = [];
let replayMarks: number[] = [];
let lastMarkAt = 0;

export function resetRecordingMarkers() {
  recordingMarks = [];
}

/** Kayıt sürerken: kaydın kaçıncı saniyesi. */
export function markRecording(elapsedSeconds: number, now = Date.now()): boolean {
  if (now - lastMarkAt < MIN_GAP_MS) return false;
  lastMarkAt = now;
  recordingMarks.push(Math.max(0, elapsedSeconds));
  return true;
}

/** Anlık tekrar açıkken: duvar saati (ms). Arabellekten taşan eski işaretler atılır. */
export function markReplay(now = Date.now(), bufferSeconds = 600): boolean {
  if (now - lastMarkAt < MIN_GAP_MS) return false;
  lastMarkAt = now;
  replayMarks = replayMarks.filter((m) => now - m <= bufferSeconds * 1000 + 5000);
  replayMarks.push(now);
  return true;
}

export function takeRecordingMarkers(): number[] {
  const out = recordingMarks;
  recordingMarks = [];
  return out;
}

export function replayMarkersFor(savedAt: number, seconds: number): number[] {
  return replayOffsets(replayMarks, savedAt, seconds);
}

// ——— Düzenleyici: kaynakların işaretleri ———

/** Kaynak dosya yolu → işaretler (kaynak saniyesi). Yoksa boş. */
interface MarkersState {
  byPath: Record<string, number[]>;
  load: (path: string) => void;
}

const loading = new Set<string>();

export const useMarkersStore = create<MarkersState>((set, get) => ({
  byPath: {},
  load: (path) => {
    if (path in get().byPath || loading.has(path)) return;
    loading.add(path);
    void textFileRead(markersPath(path))
      .then(parseMarkers)
      .catch(() => [] as number[])
      .then((marks) => {
        loading.delete(path);
        set({ byPath: { ...get().byPath, [path]: marks } });
      });
  },
}));

/** Kaynak saniyesindeki işaretin zaman çizelgesindeki yerleri (işareti içeren her klipte). */
export function markerTimes(
  clips: readonly {
    sourceId?: string;
    start: number;
    srcStart: number;
    srcEnd: number;
    speed: number;
  }[],
  sourceId: string,
  firstSourceId: string | undefined,
  marks: readonly number[],
): number[] {
  const out: number[] = [];
  for (const c of clips) {
    if ((c.sourceId ?? firstSourceId) !== sourceId) continue;
    for (const m of marks) {
      if (m >= c.srcStart && m < c.srcEnd) out.push(c.start + (m - c.srcStart) / c.speed);
    }
  }
  return [...new Set(out.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
}

/** Heyecanlı anlar: sesin çevresine göre birden yükseldiği yerler (bağırma, patlama,
 * ekip sesi). `peaks`: kaynağın 0–1 dalga formu, `duration`: saniye. En güçlü
 * `limit` an, aralarında en az `gap` saniye olacak şekilde döner. */
export function findHighlights(
  peaks: readonly number[],
  duration: number,
  limit = 12,
  gap = 10,
): number[] {
  if (peaks.length < 8 || duration <= 0) return [];
  const step = duration / peaks.length;
  // 1 sn'lik kayan ortalama: tek tık sesleri değil, süren yükselişler sayılsın.
  const win = Math.max(1, Math.round(1 / step));
  const smooth = peaks.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(peaks.length - 1, i + win); j += 1) {
      sum += peaks[j];
      n += 1;
    }
    return sum / n;
  });
  const sorted = [...smooth].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(0.2, median * 1.8);
  const candidates: { t: number; score: number }[] = [];
  for (let i = 1; i < smooth.length - 1; i += 1) {
    const v = smooth[i];
    if (v >= threshold && v >= smooth[i - 1] && v >= smooth[i + 1]) {
      candidates.push({ t: i * step, score: v - median });
    }
  }
  const chosen: number[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= limit) break;
    if (chosen.every((t) => Math.abs(t - c.t) >= gap)) chosen.push(c.t);
  }
  return chosen.sort((a, b) => a - b).map((t) => Math.round(t * 100) / 100);
}

/** Kaynağın işaretlerine yenilerini ekler ve dosyasına yazar (yakın olanlar tekrarlanmaz). */
export function addMarkers(path: string, marks: readonly number[]): number {
  const current = useMarkersStore.getState().byPath[path] ?? [];
  const fresh = marks.filter((m) => current.every((c) => Math.abs(c - m) > 2));
  if (fresh.length === 0) return 0;
  const merged = [...current, ...fresh].sort((a, b) => a - b);
  useMarkersStore.setState((s) => ({ byPath: { ...s.byPath, [path]: merged } }));
  void textFileWrite(markersPath(path), markerFile(merged)).catch(() => {});
  return fresh.length;
}
