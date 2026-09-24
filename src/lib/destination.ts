import { getSettings, useSettingsStore } from "./appSettings";
import { chooseDownloadDir } from "./tauri-api";

/** Kayıt klasörünü döner; hiç seçilmemişse bir kez sorar ve ekranda görünen
 * varsayılan klasör olarak saklar (her yerde "Değiştir" ile değiştirilebilir). */
export async function ensureDestination(): Promise<string | null> {
  const current = getSettings().defaultDownloadDir;
  if (current) return current;
  return changeDestination();
}

export async function changeDestination(): Promise<string | null> {
  const dir = await chooseDownloadDir();
  if (dir) useSettingsStore.getState().update({ defaultDownloadDir: dir });
  return dir;
}
