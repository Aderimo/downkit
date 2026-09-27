// Ayardaki temayı sayfaya ve pencerenin başlık çubuğuna uygular.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "./appSettings";
import { applyTheme } from "./themes";

let current = "";

function apply(id: string) {
  if (id === current) return;
  current = id;
  const theme = applyTheme(id);
  // Başlık çubuğu da açık/koyu kipe uyar. Tauri dışında (tarayıcı önizlemesi) pencere yok.
  if (!("__TAURI_INTERNALS__" in window)) return;
  getCurrentWindow()
    .setTheme(theme.mode)
    .catch(() => {});
}

/** Açılışta (ilk çizimden önce) bir kez: tema uygulanır, değişince yenilenir. */
export function initTheme(): void {
  apply(useSettingsStore.getState().theme);
  useSettingsStore.subscribe((s) => apply(s.theme));
}
