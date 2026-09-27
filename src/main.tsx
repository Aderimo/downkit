// DownKit — © 2026 aderimo — MIT — https://github.com/Aderimo/downkit
import { initPrefsFile } from "./lib/prefsFile";

// Aynı sayfa üç pencerede açılır: ana pencere, köşedeki bilgi penceresi (?hud) ve
// ekran görüntüsünde bölge seçme penceresi (?snip). Yan pencereler uygulamanın
// açılış işlerini (iş motoru, tepsi, kısayollar) çalıştırmamalı; bu yüzden
// hangisi olduğu en başta ayrılır.
const params = new URLSearchParams(window.location.search);
if (params.has("hud")) {
  void import("./hud/mount").then(({ mountHud }) => mountHud());
} else if (params.has("snip")) {
  void import("./snip/mount").then(({ mountSnip }) => mountSnip());
} else {
  // Ayarlar önce dosyadan yüklenir: ayar okuyan modüller ancak ondan sonra içe aktarılır.
  void initPrefsFile()
    .catch(() => {})
    .then(() => import("./bootstrap"))
    .then(({ start }) => start());
}
