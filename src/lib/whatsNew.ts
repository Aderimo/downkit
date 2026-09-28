// "Yenilikler" penceresi: program güncellendiğinde (ya da ilk kez kurulduğunda)
// ilk açılışta o sürümün yama notlarını gösterir. Gösterilen sürüm ayarlara
// yazılır; aynı sürümde bir daha açılmaz. Notlar Ayarlar → Yama notları'ndan
// her zaman okunabilir.

import { create } from "zustand";
import i18n from "../i18n";
import { getAppVersion } from "./tauri-api";
import { getSettings, useSettingsStore } from "./appSettings";
import { notesFor, type LocalizedNotes } from "./releaseNotes";

interface WhatsNewState {
  /** null: pencere kapalı. */
  version: string | null;
  notes: LocalizedNotes | null;
  close: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  version: null,
  notes: null,
  close: () => {
    const version = useWhatsNewStore.getState().version;
    if (version) useSettingsStore.getState().update({ lastSeenVersion: version });
    set({ version: null, notes: null });
  },
}));

/** Açılışta bir kez: bu sürümün notları daha önce gösterilmediyse pencereyi aç. */
export async function initWhatsNew(): Promise<void> {
  try {
    const version = await getAppVersion();
    if (getSettings().lastSeenVersion === version) return;
    useWhatsNewStore.setState({ version, notes: notesFor(version, i18n.language) });
  } catch {
    // Tauri dışında (tarayıcı önizlemesi) sürüm okunamaz; pencere açılmaz.
  }
}
