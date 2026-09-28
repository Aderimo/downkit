import { useEffect } from "react";
import { create } from "zustand";
import { getEditorWaveform, onEditorThumb, requestEditorThumbnails } from "./tauri-api";

// Kaynak başına kare ve dalga formu önbelleği. Her önizleme oturumunun (token)
// kendi kareleri, kuyruğu ve bekleyen istekleri var: bir kaynağın isteği başka
// kaynağın önbelleğini ASLA silmez. Zaman çizelgesindeki her klip kendi
// kaynağının (clip.sourceId → kaynak → token) karelerini ve dalga formunu
// gösterir; önizlemede hangi kaynağın oynadığı (activeSourceId) bunu etkilemez.

interface ThumbState {
  /** token → (kaynak saniyesi, 2 ondalık) → JPEG veri adresi. */
  byToken: Record<string, Record<string, string>>;
}

export const useThumbStore = create<ThumbState>(() => ({ byToken: {} }));

const MAX_BATCH = 48;
/** Kaynak başına en fazla bu kadar kare saklanır; eskiler atılır. */
const MAX_ENTRIES_PER_TOKEN = 600;
/** Bellek sınırı: en fazla bu kadar kaynağın karesi tutulur (en eski atılır). */
const MAX_TOKENS = 8;

interface Batch {
  token: string;
  keys: number[];
  /** Gelen yük sayısı; sıfıra inince kayıt silinir (memory leak olmaz). */
  remaining: number;
}

interface Lane {
  pending: Set<number>;
  queue: number[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Eklenme sırası (LRU çıkarması için). */
  order: string[];
  lastUsed: number;
}

const batches = new Map<string, Batch>();
const lanes = new Map<string, Lane>();
let listening: Promise<unknown> | null = null;

const round = (t: number) => Math.round(t * 100) / 100;

function laneOf(token: string): Lane {
  let lane = lanes.get(token);
  if (!lane) {
    lane = { pending: new Set(), queue: [], timer: null, order: [], lastUsed: 0 };
    lanes.set(token, lane);
  }
  lane.lastUsed = Date.now();
  return lane;
}

/** Kaynak sayısı sınırı aşılınca en uzun süredir kullanılmayanı atar. */
function evictOldTokens() {
  const { byToken } = useThumbStore.getState();
  const tokens = Object.keys(byToken);
  if (tokens.length <= MAX_TOKENS) return;
  const idle = tokens
    .filter((t) => {
      const lane = lanes.get(t);
      return lane && lane.pending.size === 0 && lane.queue.length === 0;
    })
    .sort((a, b) => (lanes.get(a)?.lastUsed ?? 0) - (lanes.get(b)?.lastUsed ?? 0));
  const drop = idle.slice(0, tokens.length - MAX_TOKENS);
  if (drop.length === 0) return;
  for (const token of drop) lanes.delete(token);
  useThumbStore.setState((s) => {
    const byToken = { ...s.byToken };
    for (const token of drop) delete byToken[token];
    return { byToken };
  });
}

function listen() {
  listening ??= onEditorThumb((payload) => {
    const batch = batches.get(payload.requestId);
    if (!batch) return;
    // Her istenen kare için tam bir yük gelir (dataUrl None olabilir);
    // batch bitince kaydı silinir.
    batch.remaining -= 1;
    if (batch.remaining <= 0) batches.delete(payload.requestId);
    if (!payload.dataUrl) return;
    const key = batch.keys[payload.index];
    if (key === undefined) return;
    const lane = lanes.get(batch.token);
    lane?.pending.delete(key);
    useThumbStore.setState((s) => {
      const entries = { ...(s.byToken[batch.token] ?? {}) };
      const label = key.toFixed(2);
      if (!(label in entries)) lane?.order.push(label);
      entries[label] = payload.dataUrl as string;
      // Kaynak başına üst sınır: en eski kareler atılır.
      if (lane) {
        while (lane.order.length > MAX_ENTRIES_PER_TOKEN) {
          const oldest = lane.order.shift();
          if (oldest !== undefined) delete entries[oldest];
        }
      }
      return { byToken: { ...s.byToken, [batch.token]: entries } };
    });
    // Yeni karelerle kaynak sayısı sınırı aşıldıysa en eski boş kaynak atılır.
    evictOldTokens();
  });
}

/** `times` anlarının karelerini ister (eksik olanları); istekler kısa süre
 * biriktirilip tek seferde gönderilir. Yalnızca bu kaynağın kuyruğu etkilenir. */
export function requestThumbs(token: string, times: number[]) {
  listen();
  const lane = laneOf(token);
  const entries = useThumbStore.getState().byToken[token] ?? {};
  for (const t of times) {
    const key = round(Math.max(0, t));
    if (entries[key.toFixed(2)] || lane.pending.has(key) || lane.queue.includes(key)) continue;
    lane.queue.push(key);
  }
  if (lane.queue.length === 0) return;
  evictOldTokens();
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = setTimeout(() => {
    const keys = lane.queue.slice(0, MAX_BATCH);
    lane.queue = [];
    for (const key of keys) lane.pending.add(key);
    const requestId = crypto.randomUUID();
    batches.set(requestId, { token, keys, remaining: keys.length });
    requestEditorThumbnails(token, keys, 90, requestId).catch(() => {
      // İstek gönderilemediyse kayıtları temizle ki tekrar denenebilsin.
      batches.delete(requestId);
      for (const key of keys) lane.pending.delete(key);
    });
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

// ——— Dalga formu (kaynak başına) ———

interface WaveState {
  byToken: Record<string, number[]>;
}

export const useWaveStore = create<WaveState>(() => ({ byToken: {} }));

const wavePending = new Set<string>();

/** Kaynağın dalga formunu ürettirir; önbellekte ya da üretimdeyse hiçbir şey yapmaz. */
export function ensureWaveform(token: string, duration: number) {
  if (duration <= 0) return;
  if (useWaveStore.getState().byToken[token] !== undefined || wavePending.has(token)) return;
  wavePending.add(token);
  // Saniyede 8 kova; 1 saatlik videoda üst sınır 24 bin.
  getEditorWaveform(token, duration, Math.min(24000, Math.ceil(duration * 8)))
    .then((result) => {
      if (result.length > 0) {
        useWaveStore.setState((s) => ({ byToken: { ...s.byToken, [token]: result } }));
      }
    })
    .catch(() => {})
    .finally(() => wavePending.delete(token));
}

/** Kaynağın dalga formunu ürettirir (varsa hiçbir şey yapmaz) ve önbellekteki
 * değeri döner. Zaman çizelgesi her klip için kendi kaynağınınkini çağırır. */
export function useWaveform(token: string | null, duration: number): number[] | null {
  const peaks = useWaveStore((s) => (token ? s.byToken[token] : undefined));
  useEffect(() => {
    if (token) ensureWaveform(token, duration);
  }, [token, duration]);
  return peaks ?? null;
}
