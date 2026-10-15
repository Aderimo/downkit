// Sayfa değiştirme istekleri: bir sayfa ya da arka planda biten bir iş başka bir
// sayfayı açmak istediğinde (ör. "İndir ve düzenle" bitince düzenleyici) buraya
// yazar; uygulama kabuğu (App) dinleyip sayfayı değiştirir.

import { create } from "zustand";
import type { ConvertTab, Route } from "../types/route";

export interface NavRequest {
  route: Route;
  /** Düzenleyicide açılacak dosya. */
  editPath?: string;
  /** Dönüştür sayfasında seçilecek sekme ve (varsa) açılacak dosya. */
  convertTab?: ConvertTab;
  filePath?: string;
  /** Her istekte artar: aynı istek iki kez gelse de işlenir. */
  seq: number;
}

interface NavState {
  request: NavRequest | null;
  go: (request: Omit<NavRequest, "seq">) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  request: null,
  go: (request) => set({ request: { ...request, seq: (get().request?.seq ?? 0) + 1 } }),
}));

export const openInEditorPath = (path: string) =>
  useNavStore.getState().go({ route: "editor", editPath: path });

export const openConvertTab = (tab: ConvertTab, filePath?: string) =>
  useNavStore.getState().go({ route: "convert", convertTab: tab, filePath });
