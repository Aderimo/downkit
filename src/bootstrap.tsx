import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "@fontsource/nunito/latin-800.css";
import "@fontsource/nunito/latin-900.css";
import "./styles/globals.css";
import { initJobEngine } from "./lib/jobEngine";
import { initTray } from "./lib/tray";
import { initUpdateCheck } from "./lib/updateCheck";
import { initWhatsNew } from "./lib/whatsNew";
import { initCounter } from "./lib/counter";
import { initToolDownloads } from "./lib/toolDownloads";
import { initRecorder } from "./lib/recorder";
import { initSnip } from "./lib/snipActions";
import { initLogging } from "./lib/log";
import { getAppVersion } from "./lib/tauri-api";
import { installBrowserKeyGuard } from "./lib/browserKeys";
import { initTheme } from "./lib/themeSync";

/** Ana pencere: iş olayları, tepsi, kayıt kısayolları ve arayüz. */
export function start() {
  // Tema ilk çizimden önce uygulanır (açık temada koyu bir an görünmesin).
  initTheme();
  installBrowserKeyGuard();
  // İş olaylarına uygulama başında bir kez abone olunur (StrictMode'un çift
  // çalıştırdığı efektlerin dışında), böylece sayfa değişse de hiçbir olay kaçmaz.
  initJobEngine().catch((err: unknown) => {
    // Yalnızca Tauri dışında (tarayıcıda arayüz önizlemesi) olur.
    console.warn("İş olaylarına abone olunamadı:", err);
  });
  // Beklenmeyen hatalar ve iş hataları günlüğe (Hatayı bildir raporu son satırları ekler).
  void getAppVersion()
    .catch(() => null)
    .then((version) => initLogging(version));
  void initTray();
  // Kayıt kısayolları ve olayları: hangi sayfa açık olursa olsun çalışır.
  if (!(import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo"))) {
    void initRecorder().catch(() => {
      // Tauri dışında (tarayıcı önizlemesi) kayıt yok.
    });
    // Ekran görüntüsü seçim penceresinden gelen sonuçlar (kopyala/kaydet arka planda).
    void initSnip().catch(() => {});
  }
  void initUpdateCheck();
  void initWhatsNew();
  // Anonim kullanım sayacı (günde bir kez; sunucu kuruluysa ve ayardan kapatılmadıysa).
  void initCounter();
  if (!(import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo"))) {
    void initToolDownloads();
  }

  // README ekran görüntüleri için örnek durum (yalnızca geliştirme sunucusunda).
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const scene = params.get("demo");
    if (scene) void import("./dev/demo").then((demo) => demo.applyDemo(scene, params.get("lang")));
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
