import { musicLane, type BlurItem, type ImageItem, type MusicItem } from "./layers";
import type { EffectItem } from "./effectLane";

// Zaman çizelgesindeki katman blokları (logo, gizleme, müzik): ölçüler ve taşıma/kırpma.

export const LANE_H = 26;
/** Ses izi yüksekliği: dalga formu okunsun diye diğer şeritlerden yüksek. */
export const MUSIC_H = 46;

export type LaneKind = "effect" | "image" | "blur" | "music";
export type LaneItem = ImageItem | BlurItem | MusicItem | EffectItem;
export type LaneDragMode = "move" | "start" | "end";

export const laneStart = (item: LaneItem) => item.start;
export const laneEnd = (item: LaneItem) => ("length" in item ? item.start + item.length : item.end);

export interface Lane {
  kind: LaneKind;
  top: number;
  height: number;
  items: LaneItem[];
  /** Çakışan bloklar alt satırlara dizilir (üst üste binmesin): öğe kimliği → satır. */
  rows?: Map<string, number>;
  rowCount?: number;
  /** Yalnızca ses izlerinde: 0 = A1, 1 = A2… */
  audioLane?: number;
}

/**
 * Zamanda çakışan blokları satırlara dağıtır (üst üste binip birbirini örtmesin): her
 * blok, sığdığı ilk satıra konur. Satır sayısı ve öğe → satır eşlemesi döner.
 */
export function packRows(items: readonly { id: string; start: number; end: number }[]): {
  rows: Map<string, number>;
  count: number;
} {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let row = ends.findIndex((end) => end <= item.start + 1e-6);
    if (row < 0) {
      row = ends.length;
      ends.push(item.end);
    } else {
      ends[row] = item.end;
    }
    rows.set(item.id, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}

/** Gösterilecek ses izleri: A1'den kullanılan en alttaki ize kadar (aradaki boş izler de). */
export function audioLaneNumbers(music: readonly MusicItem[]): number[] {
  if (music.length === 0) return [];
  const max = Math.max(...music.map(musicLane));
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/** Ses düzeyi (0–2) desibel olarak: 1 = 0 dB. */
export function volumeDb(volume: number): string {
  if (volume <= 0.001) return "−∞ dB";
  const db = 20 * Math.log10(volume);
  const rounded = Math.round(db * 10) / 10;
  if (Math.abs(rounded) < 0.05) return "0 dB";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1).replace(/\.0$/, "")} dB`;
}

/** Hareket ve kırpma: sonuç her zaman geçerli (en az 0.2 sn, kaynağın dışına taşmaz). */
export function moveLaneItem<T extends LaneItem>(
  item: T,
  mode: LaneDragMode,
  origin: T,
  delta: number,
): T {
  const MIN = 0.2;
  if ("length" in origin) {
    const m = origin as MusicItem;
    if (mode === "move") return { ...item, start: Math.max(0, m.start + delta) };
    if (mode === "end") {
      const max = m.sourceDuration - m.srcStart;
      return { ...item, length: Math.min(max, Math.max(MIN, m.length + delta)) };
    }
    // Baştan kırpma: dosyada da ileri gider, bitiş yerinde kalır.
    const d = Math.min(m.length - MIN, Math.max(-m.srcStart, Math.max(-m.start, delta)));
    return { ...item, start: m.start + d, srcStart: m.srcStart + d, length: m.length - d };
  }
  const o = origin as ImageItem | BlurItem | EffectItem;
  const length = o.end - o.start;
  if (mode === "move") {
    const start = Math.max(0, o.start + delta);
    return { ...item, start, end: start + length };
  }
  if (mode === "end") return { ...item, end: Math.max(o.start + MIN, o.end + delta) };
  return { ...item, start: Math.max(0, Math.min(o.end - MIN, o.start + delta)) };
}
