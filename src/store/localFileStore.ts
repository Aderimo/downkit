import { create } from "zustand";
import type { LocalMediaInfo } from "../types/convert";
import { probeLocalFile } from "../lib/tauri-api";
import { localizeError } from "../lib/errors";

export type LocalFilePhase = "idle" | "probing" | "ready" | "error";

interface LocalFileState {
  phase: LocalFilePhase;
  info: LocalMediaInfo | null;
  errorMessage: string | null;
  errorDetail: string | null;
  /** Bu ekrandan en son başlatılan işin kuyruk kimliği (canlı satırı göstermek için). */
  lastJobId: string | null;
  load: (path: string) => Promise<void>;
  setLastJobId: (id: string | null) => void;
  reset: () => void;
}

// Her yerel araç (Dönüştür, Sıkıştır, Boyutlandır, Platforma Hazırla) kendi seçili
// dosyasını tutar; sayfalar arasında gezinince seçim kaybolmaz.
function createLocalFileStore() {
  return create<LocalFileState>((set) => ({
    phase: "idle",
    info: null,
    errorMessage: null,
    errorDetail: null,
    lastJobId: null,
    load: async (path) => {
      set({ phase: "probing", errorMessage: null, errorDetail: null, lastJobId: null });
      try {
        const info = await probeLocalFile(path);
        set({ phase: "ready", info });
      } catch (err) {
        const error = localizeError(err, "error.probeFailed");
        set({ phase: "error", info: null, errorMessage: error.message, errorDetail: error.detail });
      }
    },
    setLastJobId: (lastJobId) => set({ lastJobId }),
    reset: () =>
      set({ phase: "idle", info: null, errorMessage: null, errorDetail: null, lastJobId: null }),
  }));
}

export const useConvertFile = createLocalFileStore();
export const useCompressFile = createLocalFileStore();
export const useResizeFile = createLocalFileStore();

export type LocalFileStore = typeof useConvertFile;
