// Ayardaki temayı ve özel arka planı sayfaya, temanın açık/koyu kipini pencerenin
// başlık çubuğuna uygular.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "./appSettings";
import { applyBackground, loadBackgroundImage, useBackgroundImage } from "./background";
import { applyTheme, type ThemeMode } from "./themes";

let last: unknown[] = [];
let mode: ThemeMode | null = null;

function apply() {
  const { theme, customColors, background } = useSettingsStore.getState();
  const { image } = useBackgroundImage.getState();
  const next = [theme, customColors, background, image];
  if (next.every((v, i) => v === last[i])) return;
  last = next;
  const withImage = applyBackground(image, background);
  const applied = applyTheme(theme, document.documentElement, {
    custom: customColors,
    panelAlpha: withImage ? background.panelAlpha : 1,
  });
  if (applied.mode === mode) return;
  mode = applied.mode;
  // Başlık çubuğu da açık/koyu kipe uyar. Tauri dışında (tarayıcı önizlemesi) pencere yok.
  if (!("__TAURI_INTERNALS__" in window)) return;
  getCurrentWindow()
    .setTheme(applied.mode)
    .catch(() => {});
}

/** Açılışta (ilk çizimden önce) bir kez: tema uygulanır, değişince yenilenir.
 * Arka plan resmi diskten gelince ayrıca uygulanır. */
export function initTheme(): void {
  apply();
  useSettingsStore.subscribe(apply);
  useBackgroundImage.subscribe(apply);
  void loadBackgroundImage();
}
