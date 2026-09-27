import { create } from "zustand";

export type DownloadsView = "queue" | "history";

/** İndirme ve Geçmiş sayfasının hangi sekmede açılacağı; sayfa dışından
 * (ör. Ana Sayfa'daki son aramalar) "Geçmiş" sekmesi açılabilsin diye. */
export const useDownloadsView = create<{
  view: DownloadsView;
  setView: (view: DownloadsView) => void;
}>((set) => ({
  view: "queue",
  setView: (view) => set({ view }),
}));
