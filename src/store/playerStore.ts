import { create } from "zustand";
import type { ClipLook } from "../lib/clipLook";

/** Oynatıcıya dışarıdan (zaman çizelgesi, kısayollar) komut vermek için. */
export interface PlayerApi {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  getTime: () => number;
}

interface PlayerState {
  api: PlayerApi | null;
  currentTime: number;
  playing: boolean;
  /** Önizleme ara belleğe alırken (ağ yavaşsa) true. */
  waiting: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  /** Doluysa oynatma bu anda durur (seçimi/klibi oynat). */
  stopAt: number | null;
  /** Oynatma imleci zaman çizelgesinde bir boşlukta (klip yok). */
  inGap: boolean;
  /** Boşluk oynatılıyor: ekran siyah, saat kendi ilerliyor (medya duraklatılmış). */
  gapPlaying: boolean;
  /** İmleçteki klibin ses kazancı (düzey × geçiş) ve görüntü görünürlüğü. */
  clipGain: number;
  clipOpacity: number;
  /** İmleçteki klibin görünümü (önizlemede CSS filtresiyle) ve geçiş rengi. */
  clipLook: ClipLook | null;
  clipFadeWhite: boolean;
  setApi: (api: PlayerApi | null) => void;
  patch: (patch: Partial<Omit<PlayerState, "setApi" | "patch">>) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  api: null,
  currentTime: 0,
  playing: false,
  waiting: false,
  rate: 1,
  volume: 1,
  muted: false,
  stopAt: null,
  inGap: false,
  gapPlaying: false,
  clipGain: 1,
  clipOpacity: 1,
  clipLook: null,
  clipFadeWhite: false,
  setApi: (api) => set({ api }),
  patch: (patch) => set(patch),
}));

export function player(): PlayerApi | null {
  return usePlayerStore.getState().api;
}

/** Oynatıcıyı `seconds` anına götürür; oynatıcı henüz hazır değilse imleç yine taşınır. */
export function seekTo(seconds: number) {
  usePlayerStore.getState().patch({ currentTime: seconds });
  player()?.seek(seconds);
}

/** [start, end) aralığını oynatır ve sonunda durur. */
export function playRange(start: number, end: number) {
  const state = usePlayerStore.getState();
  state.patch({ stopAt: end, currentTime: start });
  state.api?.seek(start);
  state.api?.play();
}
