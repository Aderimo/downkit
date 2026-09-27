import { create } from "zustand";
import type { Shape } from "../lib/annotate";
import type { ShotFile, SnipImage } from "../types/snip";

export interface SnipError {
  message: string;
  detail?: string | null;
}

interface SnipStoreState {
  /** Düzenleyicide açık görüntü; yoksa sayfa yakalama ekranını gösterir. */
  image: SnipImage | null;
  /** Açılınca hemen görsel çeviri yapılsın (hızlı çeviri kısayolu). */
  translateOnOpen: boolean;
  /** Görüntü açma isteği her geldiğinde artar: uygulama Ekran Görüntüsü sayfasına geçer. */
  openSeq: number;
  /** Kayıt klasörü (ayarlardaki ya da Resimler\DownKit). */
  outputDir: string | null;
  shots: ShotFile[];
  shotsLoaded: boolean;
  /** Küçük resim adresleri; null: üretilemedi. */
  thumbs: Record<string, string | null>;
  lastSaved: string | null;
  notice: string | null;
  error: SnipError | null;
  /** Yalnızca geliştirmede (README görüntüleri): düzenleyici bu şekillerle açılır. */
  demoShapes: Shape[] | null;
  patch: (p: Partial<Omit<SnipStoreState, "patch">>) => void;
}

export const useSnipStore = create<SnipStoreState>((set) => ({
  image: null,
  translateOnOpen: false,
  openSeq: 0,
  outputDir: null,
  shots: [],
  shotsLoaded: false,
  thumbs: {},
  lastSaved: null,
  notice: null,
  error: null,
  demoShapes: null,
  patch: (p) => set(p),
}));
