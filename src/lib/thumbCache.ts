import { create } from "zustand";
import { onEditorThumb, requestEditorThumbnails } from "./tauri-api";

// Zaman çizelgesi kareleri (YouTube dışındaki kaynaklar): yakınlaştırdıkça görünen
// aralık için yeni kareler istenir; alınanlar saklanır, en yakını gösterilir.

interface ThumbState {
  token: string | null;
  /** Kaynak saniyesi (2 ondalık) → JPEG veri adresi. */
  entries: Record<string, string>;
}

export const useThumbStore = create<ThumbState>(() => ({ token: null, entries: {} }));

const MAX_BATCH = 48;
const batches = new Map<string, { token: string; keys: number[] }>();
let pending = new Set<number>();
let queue: number[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening: Promise<unknown> | null = null;

const round = (t: number) => Math.round(t * 100) / 100;

function listen() {
  listening ??= onEditorThumb((payload) => {
    const batch = batches.get(payload.requestId);
    if (!batch || !payload.dataUrl) return;
    const key = batch.keys[payload.index];
    if (key === undefined || useThumbStore.getState().token !== batch.token) return;
    pending.delete(key);
    useThumbStore.setState((s) => ({
      entries: { ...s.entries, [key.toFixed(2)]: payload.dataUrl as string },
    }));
  });
}

/** `times` anlarının karelerini ister (eksik olanları); istekler kısa süre
 * biriktirilip tek seferde gönderilir. Yeni istek eskisinin kalanını iptal eder. */
export function requestThumbs(token: string, times: number[]) {
  listen();
  if (useThumbStore.getState().token !== token) {
    useThumbStore.setState({ token, entries: {} });
    pending = new Set();
    queue = [];
  }
  const { entries } = useThumbStore.getState();
  for (const t of times) {
    const key = round(Math.max(0, t));
    if (entries[key.toFixed(2)] || pending.has(key) || queue.includes(key)) continue;
    queue.push(key);
  }
  if (queue.length === 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const keys = queue.slice(0, MAX_BATCH);
    queue = [];
    pending = new Set(keys);
    const requestId = crypto.randomUUID();
    batches.set(requestId, { token, keys });
    requestEditorThumbnails(token, keys, 90, requestId).catch(() => {});
  }, 200);
}

/** Sıralı anahtarlar üzerinde ikili arama ile en yakın kare. */
export function nearestFromEntries(
  entries: Record<string, string>,
  sortedKeys: number[],
  t: number,
): string | null {
  if (sortedKeys.length === 0) return null;
  let lo = 0;
  let hi = sortedKeys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [sortedKeys[lo], sortedKeys[lo - 1]].filter((k) => k !== undefined);
  const best = candidates.reduce((a, b) => (Math.abs(a - t) <= Math.abs(b - t) ? a : b));
  return entries[best.toFixed(2)] ?? null;
}
