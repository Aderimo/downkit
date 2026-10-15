// Arayüz boyutu (Ayarlar → Görünüm): yazılar, düğmeler ve boşluklar birlikte
// büyür. Tauri'de WebView'in kendi yakınlaştırması kullanılır (Ctrl ile
// büyütmek gibi; çizim ve fare koordinatları doğru kalır), tarayıcıda CSS zoom.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useSettingsStore } from "./appSettings";

let applied: number | null = null;

export function applyUiScale(scale: number): void {
  if (scale === applied) return;
  applied = scale;
  if ("__TAURI_INTERNALS__" in window) {
    getCurrentWebview()
      .setZoom(scale)
      .catch(() => {
        document.documentElement.style.zoom = String(scale);
      });
  } else {
    document.documentElement.style.zoom = String(scale);
  }
}

/** Açılışta bir kez: ayardaki boyut uygulanır, değişince yenilenir. */
export function initUiScale(): void {
  applyUiScale(useSettingsStore.getState().uiScale);
  useSettingsStore.subscribe((s) => applyUiScale(s.uiScale));
}
